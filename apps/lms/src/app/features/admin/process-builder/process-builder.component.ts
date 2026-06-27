import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CdkDragDrop, DragDropModule, moveItemInArray, transferArrayItem } from '@angular/cdk/drag-drop';
import { ToastService } from '../../../core/services/toast.service';
import { ApiService } from '../../../core/services/api.service';
import { ProcessWorkflowService } from '../../../core/services/process-workflow.service';
import { ACTION_CATALOG, ACTION_POLICY, ActionCatalogEntry, KNOWN_ROLES, ProcessCategory, ProcessWorkflowConfig, ProcessWorkflowRecord, catalogFor, coupledTypes, dependentsOf, isLocked, isMandatory, isRepeatable, actionHome, requiresOf } from '../../../shared/models/process-workflow.model';

interface LaneItem { id: string; type: string; label?: string; enabled: boolean; }
interface Lane { cat: ProcessCategory; items: LaneItem[]; }

const PALETTE_COLORS = ['#7c3aed', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#64748b', '#ef4444', '#14b8a6'];

/**
 * Admin process-workflow builder. Drag operations (the action catalogue) into
 * work-area lanes (categories) to shape the navigation. Manage multiple saved
 * workflows: switch, duplicate, set active, save.
 */
@Component({
  selector: 'pf-process-builder',
  standalone: true,
  imports: [FormsModule, DragDropModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pb px-4 md:px-8 lg:px-10 pt-6 pb-12">
      <!-- Toolbar -->
      <header class="pb-bar">
        <div class="min-w-0">
          <p class="pb-eyebrow">Admin · Process workflow</p>
          <h1 class="pb-title">Workflow <span class="pb-title-accent">builder</span></h1>
          <p class="pb-sub">Arrange actions into work-areas — the name becomes the nav, roles set who gets in.</p>
        </div>
        <div class="pb-bar-actions">
          @if (branches().length > 0) {
            <select class="pb-select pb-select--scope" [ngModel]="scope()" (ngModelChange)="setScope($event)" title="Branch this workflow applies to">
              <option [ngValue]="null">⌂ All branches (default)</option>
              @for (b of branches(); track b.id) { <option [ngValue]="b.id">⌥ {{ b.name }}</option> }
            </select>
          }
          <select class="pb-select" [ngModel]="currentId()" (ngModelChange)="selectWorkflow($event)">
            @for (w of scopedWorkflows(); track w.id) {
              <option [value]="w.id">{{ w.name }}{{ w.isActive ? '  ● active' : '' }}</option>
            }
            @if (scopedWorkflows().length === 0) { <option [ngValue]="null">— new draft —</option> }
          </select>
          <button type="button" class="pb-btn" (click)="newWorkflow()" title="New workflow">+ New</button>
          <button type="button" class="pb-btn" [disabled]="!currentId()" (click)="duplicate()">Duplicate</button>
          <button type="button" class="pb-btn" [disabled]="!currentId() || isActive()" (click)="activate()">Set active</button>
          <button type="button" class="pb-btn pb-btn--primary" [disabled]="saving()" (click)="save()">{{ saving() ? 'Saving…' : 'Save' }}</button>
        </div>
      </header>

      <div class="pb-name-row">
        <input class="pb-name" [ngModel]="name()" (ngModelChange)="name.set($event); dirty.set(true)" placeholder="Workflow name" />
        @if (isActive()) { <span class="pb-active">● Active — drives the live navigation</span> }
        @if (dirty()) { <span class="pb-dirty">Unsaved changes</span> }
      </div>
      <p class="pb-hint">Configuring <strong class="pb-scope-tag">{{ branchName(scope()) }}</strong> · work-area names become the navigation · 🔒 actions are locked to their area</p>

      <div cdkDropListGroup class="pb-board">
        <!-- Palette -->
        <aside class="pb-palette">
          <div class="pb-palette-hd">Available actions<br /><span>drag into a work-area</span></div>
          <div cdkDropList id="palette" [cdkDropListData]="palette()" (cdkDropListDropped)="dropToPalette($event)" class="pb-palette-list">
            @for (a of palette(); track a.type) {
              <div class="pb-chip" cdkDrag>
                <svg class="pb-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  @for (p of a.iconPath; track $index) { <path [attr.d]="p" /> }
                </svg>
                <span class="flex-1 truncate">{{ a.label }}</span>
                <span class="pb-grip">⠿</span>
              </div>
            }
            @if (palette().length === 0) { <div class="pb-empty">All actions placed.</div> }
          </div>
        </aside>

        <!-- Lanes -->
        <div class="pb-lanes">
          @for (lane of lanes(); track lane.cat.id; let li = $index) {
            <div class="pb-lane" [style.borderTopColor]="lane.cat.color" [style.--lane]="lane.cat.color">
              <div class="pb-lane-hd">
                <span class="pb-dot" [style.background]="lane.cat.color"></span>
                <input class="pb-lane-name" [ngModel]="lane.cat.name" (ngModelChange)="renameCategory(li, $event)" />
                <div class="pb-lane-tools">
                  <input type="color" class="pb-color" [ngModel]="lane.cat.color" (ngModelChange)="recolor(li, $event)" title="Colour" />
                  <button type="button" class="pb-mini" [disabled]="li === 0" (click)="moveCategory(li, -1)" title="Move left">‹</button>
                  <button type="button" class="pb-mini" [disabled]="li === lanes().length - 1" (click)="moveCategory(li, 1)" title="Move right">›</button>
                  <button type="button" class="pb-mini pb-mini--del" (click)="deleteCategory(li)" title="Delete work-area">×</button>
                </div>
              </div>
              <div class="pb-roles">
                <span class="pb-roles-lbl">Who</span>
                @if (roleMenuLane() === li) {
                  @for (r of roles(); track r) {
                    <button type="button" class="pb-role" [class.pb-role--on]="laneHasRole(li, r)" (click)="toggleRole(li, r)">{{ r }}</button>
                  }
                  <button type="button" class="pb-role-add pb-role-add--done" (click)="roleMenuLane.set(-1)">done</button>
                } @else {
                  @for (r of lane.cat.roles ?? []; track r) {
                    <span class="pb-role pb-role--on">{{ r }}</span>
                  }
                  @if (!(lane.cat.roles?.length)) { <span class="pb-role-all">Anyone with access</span> }
                  <button type="button" class="pb-role-add" (click)="roleMenuLane.set(li)" title="Assign roles">＋ roles</button>
                }
              </div>
              <div cdkDropList [id]="'lane-' + lane.cat.id" [cdkDropListData]="lane.items" (cdkDropListDropped)="dropToLane($event, li)" class="pb-lane-list">
                @for (item of lane.items; track item.id; let ii = $index) {
                  <div class="pb-action" [class.pb-action--off]="!item.enabled" [class.pb-action--locked]="locked(item.type)" cdkDrag [cdkDragDisabled]="locked(item.type)">
                    <svg class="pb-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                      @for (p of iconFor(item.type); track $index) { <path [attr.d]="p" /> }
                    </svg>
                    <span class="flex-1 truncate">{{ labelFor(item) }}</span>
                    <button type="button" class="pb-toggle" [class.on]="item.enabled" [disabled]="mandatory(item.type)" (click)="toggleAction(li, ii)" [title]="mandatory(item.type) ? 'Required — always on' : (item.enabled ? 'Enabled' : 'Hidden')"></button>
                    @if (locked(item.type)) {
                      <svg class="pb-lock" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" [attr.title]="'Locked to this area'">
                        <rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>
                      </svg>
                    } @else {
                      <span class="pb-grip">⠿</span>
                    }
                  </div>
                }
                @if (lane.items.length === 0) { <div class="pb-empty">Drop actions here</div> }
              </div>
            </div>
          }
          <button type="button" class="pb-add-lane" (click)="addCategory()">＋ Add work-area</button>
        </div>
      </div>

      <!-- Live nav preview -->
      <div class="pb-preview">
        <span class="pb-preview-lbl">Navigation preview</span>
        @for (lane of lanes(); track lane.cat.id) {
          @if (enabledCount(lane) > 0) {
            <span class="pb-preview-item"><span class="pb-dot" [style.background]="lane.cat.color"></span>{{ lane.cat.name }} <em>{{ enabledCount(lane) }}</em></span>
          }
        }
      </div>
    </section>
  `,
  styles: [`
    .pb { position: relative; }
    .pb::before { content: ''; position: absolute; inset: 0 0 auto 0; height: 320px; pointer-events: none;
      background: radial-gradient(900px 320px at 18% -10%, rgba(124,58,237,0.10), transparent 70%); z-index: 0; }
    .pb > * { position: relative; z-index: 1; }

    .pb-bar { display: flex; align-items: flex-start; gap: 14px; flex-wrap: wrap; }
    .pb-bar .min-w-0 { flex: 1; }
    .pb-eyebrow { margin: 0; font-size: 10.5px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--text-tertiary); font-family: 'JetBrains Mono', ui-monospace, monospace; }
    .pb-title { margin: 5px 0 0; font-size: 26px; font-weight: 800; letter-spacing: -0.01em; color: var(--text-primary); line-height: 1.1; }
    .pb-title-accent { background: linear-gradient(100deg, #a78bfa, #7c3aed 60%, #6366f1); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }
    .pb-sub { margin: 6px 0 0; font-size: 12.5px; color: var(--text-tertiary); max-width: 52ch; }
    .pb-bar-actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .pb-select { padding: 9px 11px; border-radius: 10px; background: var(--glass-bg); border: 1px solid var(--glass-border); color: var(--text-primary); font-size: 13px; font-weight: 600; max-width: 240px; cursor: pointer; transition: border-color .15s; }
    .pb-select:hover { border-color: var(--text-tertiary); }
    .pb-btn { padding: 9px 14px; border-radius: 10px; background: var(--glass-bg); border: 1px solid var(--glass-border); color: var(--text-secondary); font-size: 13px; font-weight: 600; cursor: pointer; transition: transform .12s, border-color .15s, color .15s, background .15s; }
    .pb-btn:hover:not(:disabled) { color: var(--text-primary); border-color: var(--text-tertiary); transform: translateY(-1px); }
    .pb-btn:active:not(:disabled) { transform: translateY(0); }
    .pb-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .pb-btn--primary { background: linear-gradient(180deg, #8b5cf6, #7c3aed); color: #fff; border-color: transparent; box-shadow: 0 6px 16px -6px rgba(124,58,237,0.7); }
    .pb-btn--primary:hover:not(:disabled) { color: #fff; box-shadow: 0 9px 22px -7px rgba(124,58,237,0.85); }
    .pb-name-row { display: flex; align-items: center; gap: 12px; margin: 18px 0 8px; flex-wrap: wrap; }
    .pb-name { padding: 10px 14px; border-radius: 11px; background: var(--glass-bg); border: 1px solid var(--glass-border); color: var(--text-primary); font-size: 15.5px; font-weight: 700; min-width: 240px; transition: border-color .15s, box-shadow .15s; }
    .pb-name:focus { outline: none; border-color: #7c3aed; box-shadow: 0 0 0 3px rgba(124,58,237,0.18); }
    .pb-active { display: inline-flex; align-items: center; font-size: 11.5px; font-weight: 700; color: #6ee7b7; padding: 4px 10px; border-radius: 999px; background: rgba(16,185,129,0.12); border: 1px solid rgba(16,185,129,0.3); }
    .pb-dirty { font-size: 11.5px; font-weight: 700; color: #fbbf24; padding: 4px 10px; border-radius: 999px; background: rgba(251,191,36,0.1); border: 1px solid rgba(251,191,36,0.28); }
    .pb-hint { margin: 0 0 16px; font-size: 11.5px; color: var(--text-tertiary); }
    .pb-scope-tag { color: #c4b5fd; font-weight: 700; }
    .pb-select--scope { border-color: rgba(124,58,237,0.45); color: #c4b5fd; font-weight: 700; }

    .pb-board { display: flex; gap: 16px; align-items: stretch; }
    @media (max-width: 820px) { .pb-board { flex-direction: column; } }

    .pb-palette { width: 206px; flex-shrink: 0; border: 1px solid var(--glass-border); border-radius: 16px; background: linear-gradient(180deg, rgba(255,255,255,0.03), transparent); padding: 12px; align-self: flex-start; position: sticky; top: 8px; box-shadow: 0 1px 2px rgba(0,0,0,0.2); }
    @media (max-width: 820px) { .pb-palette { width: 100%; position: static; } }
    .pb-palette-hd { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em; color: var(--text-secondary); margin-bottom: 10px; line-height: 1.5; }
    .pb-palette-hd span { font-weight: 400; color: var(--text-tertiary); }
    .pb-palette-list { display: flex; flex-direction: column; gap: 7px; min-height: 60px; }
    @media (max-width: 820px) { .pb-palette-list { flex-direction: row; flex-wrap: wrap; } .pb-palette-list .pb-chip { flex: 0 1 auto; } }
    .pb-chip { display: flex; align-items: center; gap: 8px; padding: 9px 11px; border-radius: 10px; background: var(--bg-card-solid, rgba(255,255,255,0.04)); border: 1px solid var(--glass-border); color: var(--text-secondary); font-size: 12.5px; font-weight: 600; cursor: grab; transition: transform .12s, border-color .15s, color .15s; }
    .pb-chip:hover { color: var(--text-primary); border-color: #7c3aed; transform: translateY(-1px); }
    .pb-chip:active { cursor: grabbing; }

    .pb-lanes { flex: 1; min-width: 0; display: flex; gap: 14px; overflow-x: auto; padding-bottom: 10px; align-items: stretch; }
    @media (max-width: 820px) { .pb-lanes { flex-direction: column; overflow-x: visible; } }
    .pb-lane { flex: 1 1 226px; min-width: 214px; max-width: 300px; border: 1px solid var(--glass-border); border-top: 3px solid; border-radius: 16px; background: var(--glass-bg); display: flex; flex-direction: column; box-shadow: 0 1px 2px rgba(0,0,0,0.25), 0 18px 40px -28px rgba(0,0,0,0.7); transition: transform .15s, box-shadow .15s; overflow: hidden; }
    .pb-lane:hover { transform: translateY(-2px); box-shadow: 0 2px 4px rgba(0,0,0,0.3), 0 26px 50px -28px rgba(0,0,0,0.8); }
    @media (max-width: 820px) { .pb-lane { max-width: none; width: 100%; } }
    .pb-lane-hd { display: flex; align-items: center; gap: 8px; padding: 11px 11px; border-bottom: 1px solid var(--glass-border);
      background: linear-gradient(180deg, color-mix(in srgb, var(--lane, #7c3aed) 16%, transparent), transparent); }
    .pb-dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; box-shadow: 0 0 0 3px color-mix(in srgb, var(--lane, #7c3aed) 22%, transparent); }
    .pb-lane-name { flex: 1; min-width: 0; background: transparent; border: none; color: var(--text-primary); font-size: 14px; font-weight: 700; padding: 2px 4px; border-radius: 6px; transition: background .15s; }
    .pb-lane-name:hover, .pb-lane-name:focus { background: rgba(255,255,255,0.05); outline: none; }
    .pb-lane-tools { display: flex; align-items: center; gap: 3px; }
    .pb-color { width: 22px; height: 22px; padding: 0; border: none; background: none; cursor: pointer; border-radius: 6px; }
    .pb-mini { width: 23px; height: 23px; border-radius: 7px; border: 1px solid transparent; background: transparent; color: var(--text-tertiary); cursor: pointer; font-size: 13px; line-height: 1; transition: background .15s, color .15s; }
    .pb-mini:hover:not(:disabled) { background: rgba(255,255,255,0.07); color: var(--text-primary); }
    .pb-mini:disabled { opacity: 0.3; cursor: not-allowed; }
    .pb-mini--del:hover:not(:disabled) { color: #fca5a5; background: rgba(239,68,68,0.12); }
    .pb-roles { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; padding: 7px 9px; border-bottom: 1px solid var(--glass-border); }
    .pb-roles-lbl { font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-tertiary); margin-right: 2px; }
    .pb-role { padding: 2px 8px; border-radius: 999px; font-size: 10px; font-weight: 600; border: 1px solid var(--glass-border); background: transparent; color: var(--text-tertiary); cursor: pointer; }
    .pb-role--on { border-color: #7c3aed; background: rgba(124,58,237,0.18); color: #c4b5fd; }
    .pb-role-all { font-size: 10px; color: var(--text-tertiary); font-style: italic; }
    .pb-role-add { padding: 2px 8px; border-radius: 999px; font-size: 10px; font-weight: 700; border: 1px dashed var(--glass-border); background: transparent; color: var(--text-secondary); cursor: pointer; }
    .pb-role-add:hover { color: var(--text-primary); border-color: var(--text-tertiary); }
    .pb-role-add--done { border-style: solid; border-color: #7c3aed; color: #c4b5fd; background: rgba(124,58,237,0.12); }
    .pb-lane-list { flex: 1; display: flex; flex-direction: column; gap: 7px; padding: 10px; min-height: 64px; }
    .pb-action { display: flex; align-items: center; gap: 9px; padding: 9px 10px; border-radius: 10px; background: var(--bg-card-solid, rgba(255,255,255,0.05)); border: 1px solid var(--glass-border); color: var(--text-primary); font-size: 12.5px; font-weight: 600; cursor: grab; transition: transform .12s, border-color .15s, background .15s; }
    .pb-action:hover { border-color: color-mix(in srgb, var(--lane, #7c3aed) 50%, var(--glass-border)); transform: translateX(2px); }
    .pb-action.cdk-drag-dragging { cursor: grabbing; }
    .pb-action--off { opacity: 0.45; }
    .pb-ic { width: 16px; height: 16px; flex-shrink: 0; color: var(--lane, var(--text-tertiary)); }
    .pb-grip { color: var(--text-tertiary); font-size: 12px; cursor: grab; }
    .pb-action--locked { opacity: 0.92; cursor: default; }
    .pb-action--locked .pb-ic { color: #c4b5fd; }
    .pb-lock { width: 13px; height: 13px; color: var(--text-tertiary); flex-shrink: 0; }
    .pb-toggle:disabled { opacity: 0.6; cursor: not-allowed; }
    .pb-toggle { width: 30px; height: 17px; border-radius: 9px; border: none; background: rgba(255,255,255,0.15); position: relative; cursor: pointer; flex-shrink: 0; transition: background 0.15s; }
    .pb-toggle::after { content: ''; position: absolute; top: 2px; left: 2px; width: 13px; height: 13px; border-radius: 50%; background: #fff; transition: transform 0.15s; }
    .pb-toggle.on { background: #10b981; }
    .pb-toggle.on::after { transform: translateX(13px); }
    .pb-empty { font-size: 11.5px; color: var(--text-tertiary); text-align: center; padding: 14px 4px; border: 1px dashed var(--glass-border); border-radius: 10px; }
    .pb-add-lane { width: 56px; flex-shrink: 0; align-self: stretch; border: 1.5px dashed var(--glass-border); border-radius: 16px; background: transparent; color: var(--text-tertiary); font-size: 12px; font-weight: 700; cursor: pointer; writing-mode: vertical-rl; text-orientation: mixed; letter-spacing: 0.05em; transition: border-color .15s, color .15s, background .15s; }
    .pb-add-lane:hover { border-color: #7c3aed; color: #c4b5fd; background: rgba(124,58,237,0.07); }
    @media (max-width: 820px) { .pb-add-lane { width: 100%; writing-mode: horizontal-tb; min-height: 50px; } }

    .pb-preview { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 20px; padding: 14px 16px; border-radius: 14px; background: linear-gradient(180deg, rgba(255,255,255,0.03), transparent); border: 1px solid var(--glass-border); }
    .pb-preview-lbl { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-tertiary); margin-right: 2px; }
    .pb-preview-item { display: inline-flex; align-items: center; gap: 7px; font-size: 13px; font-weight: 600; color: var(--text-secondary); padding: 5px 11px; border-radius: 999px; background: var(--bg-card-solid, rgba(255,255,255,0.04)); border: 1px solid var(--glass-border); }
    .pb-preview-item em { font-style: normal; font-size: 10px; padding: 1px 6px; border-radius: 999px; background: rgba(124,58,237,0.18); color: #c4b5fd; font-weight: 700; }

    /* CDK drag visuals */
    .cdk-drag-preview { border-radius: 9px; box-shadow: 0 8px 24px rgba(0,0,0,0.4); }
    .cdk-drag-placeholder { opacity: 0.4; }
    .cdk-drag-animating { transition: transform 220ms cubic-bezier(0.2,0.8,0.2,1); }
    .pb-lane-list.cdk-drop-list-dragging .pb-action:not(.cdk-drag-placeholder),
    .pb-palette-list.cdk-drop-list-dragging .pb-chip:not(.cdk-drag-placeholder) { transition: transform 220ms cubic-bezier(0.2,0.8,0.2,1); }

    /* ───────────────────────────────────────────────────────────────
       CROSS-PLATFORM OVERRIDES (additive only — desktop-web >=1280px
       and the existing <=820px column layout are left untouched).
       ─────────────────────────────────────────────────────────────── */

    /* Touch pointers: suppress hover-only transforms so taps don't leave
       elements stuck in a hovered/translated state on mobile + tablet. */
    @media (hover: none) {
      .pb-lane:hover { transform: none; box-shadow: 0 1px 2px rgba(0,0,0,0.25), 0 18px 40px -28px rgba(0,0,0,0.7); }
      .pb-chip:hover { transform: none; }
      .pb-action:hover { transform: none; }
      .pb-btn:hover:not(:disabled) { transform: none; }
      .pb-btn--primary:hover:not(:disabled) { box-shadow: 0 6px 16px -6px rgba(124,58,237,0.7); }
    }

    /* Coarse pointers (touch): grow the small icon controls to a >=44px
       tappable area without changing their visual footprint on desktop. */
    @media (pointer: coarse) {
      /* lane header icon controls: full 44px hit area; let the row wrap so the
         enlarged controls never clip the lane-name input on a narrow lane. */
      .pb-lane-hd { flex-wrap: wrap; }
      .pb-lane-tools { gap: 4px; }
      .pb-mini { min-width: 44px; min-height: 44px; width: 44px; height: 44px; flex-shrink: 0; }
      .pb-color { width: 44px; height: 44px; }
      .pb-toggle { min-width: 44px; min-height: 28px; width: 44px; height: 26px; border-radius: 13px; }
      .pb-toggle::after { width: 20px; height: 20px; top: 3px; left: 3px; }
      .pb-toggle.on::after { transform: translateX(18px); }
      /* role pills become toggle buttons in edit mode — give them the full
         44px touch floor (they sit in a wrap-flow so height grows gracefully). */
      .pb-role, .pb-role-add, .pb-role-add--done { min-height: 44px; display: inline-flex; align-items: center; padding-top: 8px; padding-bottom: 8px; }
      /* grip is a drag affordance, not a tap target, but give it a real touch
         box so it's draggable on touch; flex-shrink so it never collapses. */
      .pb-grip { padding: 8px 4px; flex-shrink: 0; }
      /* toolbar + name-row controls: full 44px tappable height. */
      .pb-btn, .pb-select, .pb-name { min-height: 44px; }
    }

    /* iPad / tablet (641–1279px): put the Available-actions palette on top as
       a horizontal strip (covers iPad portrait widths like 810–834 that the
       820px breakpoint missed), then tile the work-area lanes into a grid that
       auto-fills the full width (2-up portrait, 3-up landscape) instead of a
       side-rail + uneven flex-wrap. Desktop (>=1280) keeps its side-rail board. */
    @media (min-width: 641px) and (max-width: 1279px) {
      .pb-board { flex-direction: column; }
      .pb-palette { width: 100%; position: static; }
      .pb-palette-list { flex-direction: row; flex-wrap: wrap; }
      .pb-palette-list .pb-chip { flex: 0 1 auto; }
      .pb-lanes {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
        gap: 14px;
        flex: initial;
        overflow-x: visible;
      }
      .pb-lane { flex: initial; min-width: 0; max-width: none; width: auto; }
      .pb-add-lane { width: auto; writing-mode: horizontal-tb; min-height: 56px; }
    }

    /* Phone (<=640px): single-column board, no horizontal overflow,
       16px form fields to stop iOS auto-zoom, and clearance for the
       floating bottom-nav pill so the preview isn't hidden behind it. */
    @media (max-width: 640px) {
      .pb { padding-bottom: calc(48px + var(--tab-nav-total-height, 0px)); }
      .pb-bar-actions { width: 100%; }
      .pb-bar-actions .pb-btn { flex: 1 1 auto; text-align: center; min-height: 44px; }
      .pb-select, .pb-select--scope { max-width: none; flex: 1 1 100%; min-height: 44px; font-size: 16px; }
      .pb-name { width: 100%; min-width: 0; font-size: 16px; }
      .pb-lane-name { font-size: 16px; }
      .pb-board { gap: 12px; }
      .pb-lanes { gap: 12px; }
      .pb-preview { padding: 12px; }
    }

    /* Capacitor native: the sticky palette is the only page-owned chrome
       that can ride under the device top inset; nudge it clear of the
       status bar / notch (global body inset covers the page body). */
    :host-context(html.cap-native) .pb-palette { top: calc(8px + env(safe-area-inset-top)); }
  `]
})
export class ProcessBuilderComponent implements OnInit {
  private readonly svc = inject(ProcessWorkflowService);
  private readonly toasts = inject(ToastService);
  private readonly api = inject(ApiService);

  readonly roles = signal<string[]>(KNOWN_ROLES);
  readonly roleMenuLane = signal(-1);
  readonly workflows = signal<ProcessWorkflowRecord[]>([]);
  readonly branches = signal<{ id: string; name: string }[]>([]);
  /** Branch scope being configured. null = the tenant-wide default that applies
   *  to every branch without its own. Users see the workflow for their branch. */
  readonly scope = signal<string | null>(null);
  readonly currentId = signal<string | null>(null);
  readonly name = signal('');
  readonly lanes = signal<Lane[]>([]);
  readonly palette = signal<ActionCatalogEntry[]>([]);
  readonly dirty = signal(false);
  readonly saving = signal(false);

  /** Workflows in the currently-selected branch scope. */
  readonly scopedWorkflows = computed(() => this.workflows().filter(w => (w.branchId ?? null) === this.scope()));
  readonly isActive = computed(() => this.workflows().find(w => w.id === this.currentId())?.isActive ?? false);

  ngOnInit() {
    this.reload();
    this.api.get<{ id: string; name: string }[]>('/api/tenants/branches').subscribe({
      next: bs => this.branches.set((bs ?? []).map(b => ({ id: b.id, name: b.name }))),
      error: () => { /* single-branch / no access — scope selector stays default-only */ },
    });
    this.api.get<{ name: string }[]>('/api/roles').subscribe({
      next: rs => { const names = (rs ?? []).map(r => r.name).filter(Boolean); if (names.length) this.roles.set(names); },
      error: () => { /* keep KNOWN_ROLES fallback */ },
    });
  }

  branchName(id: string | null): string {
    return id === null ? 'All branches (default)' : (this.branches().find(b => b.id === id)?.name ?? 'Branch');
  }

  /** Switch the branch scope: load that scope's active/first workflow, or start a
   *  draft from the tenant default so the admin can Save a branch-specific one. */
  setScope(branchId: string | null) {
    if (this.scope() === branchId) return;
    this.scope.set(branchId);
    const scoped = this.scopedWorkflows();
    const pick = scoped.find(w => w.isActive) ?? scoped[0];
    if (pick) { this.loadInto(pick); return; }
    const base = this.workflows().find(w => (w.branchId ?? null) === null) ?? this.workflows()[0];
    this.applyConfig(base?.configJson ?? '{"categories":[],"actions":[]}', `${this.branchName(branchId)} workflow`, null, true);
  }

  laneHasRole(i: number, role: string): boolean { return !!this.lanes()[i]?.cat.roles?.includes(role); }
  toggleRole(i: number, role: string) {
    this.lanes.update(l => l.map((ln, k) => {
      if (k !== i) return ln;
      const cur = ln.cat.roles ?? [];
      const roles = cur.includes(role) ? cur.filter(r => r !== role) : [...cur, role];
      return { ...ln, cat: { ...ln.cat, roles } };
    }));
    this.dirty.set(true);
  }

  private reload(selectId?: string) {
    this.svc.list().subscribe(list => {
      this.workflows.set(list ?? []);
      const scoped = (list ?? []).filter(w => (w.branchId ?? null) === this.scope());
      const pick = (selectId && scoped.find(w => w.id === selectId))
        || scoped.find(w => w.isActive) || scoped[0];
      if (pick) { this.loadInto(pick); return; }
      // No workflow in this scope — start a draft from the tenant default.
      const base = (list ?? []).find(w => (w.branchId ?? null) === null) ?? (list ?? [])[0];
      this.applyConfig(base?.configJson ?? '{"categories":[],"actions":[]}', `${this.branchName(this.scope())} workflow`, null, true);
    });
  }

  private loadInto(rec: ProcessWorkflowRecord) {
    this.applyConfig(rec.configJson, rec.name, rec.id, false);
  }

  /** Build the lane/palette state from a config JSON. `id` null + dirty=true marks
   *  an unsaved draft (e.g. a new branch scope cloned from the tenant default). */
  private applyConfig(json: string, name: string, id: string | null, dirty: boolean) {
    this.currentId.set(id);
    this.name.set(name);
    let cfg: ProcessWorkflowConfig = { categories: [], actions: [] };
    try { cfg = JSON.parse(json); } catch { /* */ }
    const cats = [...(cfg.categories ?? [])].sort((a, b) => a.order - b.order);
    const lanes: Lane[] = cats.map(cat => ({
      cat,
      items: (cfg.actions ?? []).filter(a => a.categoryId === cat.id).sort((a, b) => a.order - b.order)
        .map(a => ({ id: a.id, type: a.type, label: a.label, enabled: a.enabled })),
    }));
    this.healLocks(lanes);
    this.healDeps(lanes);
    const placed = new Set(lanes.flatMap(l => l.items.map(i => i.type)));
    // Repeatable actions stay in the palette even once placed, so they can be
    // dropped into several work-areas.
    this.palette.set(ACTION_CATALOG.filter(a => isRepeatable(a.type) || !placed.has(a.type)));
    this.lanes.set(lanes);
    this.dirty.set(dirty);
  }

  /** Enforce the lock policy on a loaded config: every locked action sits exactly
   *  once in its home area, and mandatory ones are enabled. Repairs older / hand-
   *  edited workflows so the builder always shows a valid, professional layout. */
  private healLocks(lanes: Lane[]) {
    for (const [type, pol] of Object.entries(ACTION_POLICY)) {
      if (!pol.locked) continue;
      const home = lanes.find(l => l.cat.id === pol.home);
      // Pull any stray copies out of non-home areas (capture one to reuse).
      let stray: LaneItem | undefined;
      for (const ln of lanes) {
        if (home && ln.cat.id === pol.home) continue;
        for (let k = ln.items.length - 1; k >= 0; k--) {
          if (ln.items[k].type === type) { stray = stray ?? ln.items[k]; ln.items.splice(k, 1); }
        }
      }
      if (!home) continue;                 // no home area in this workflow — leave as-is
      const inHome = home.items.find(it => it.type === type);
      if (inHome) { if (pol.mandatory) inHome.enabled = true; }
      else {
        const it = stray ?? { id: crypto.randomUUID(), type, enabled: true };
        if (pol.mandatory) it.enabled = true;
        home.items.push(it);
      }
    }
  }

  /** Keep couplings + prerequisites consistent on load: an enabled action whose
   *  coupled partner or a prerequisite is off/missing is switched off too (runs to
   *  a fixed point so cascades settle). Matches dispatch↔intake + the requires graph. */
  private healDeps(lanes: Lane[]) {
    let changed = true;
    while (changed) {
      changed = false;
      const on = new Set(lanes.flatMap(l => l.items).filter(i => i.enabled).map(i => i.type));
      for (const ln of lanes) for (const it of ln.items) {
        if (!it.enabled || isMandatory(it.type)) continue;
        const partnerOff = coupledTypes(it.type).some(p => !on.has(p));
        const reqOff = requiresOf(it.type).some(r => !on.has(r));
        if (partnerOff || reqOff) { it.enabled = false; changed = true; }
      }
    }
  }

  private buildConfig(): ProcessWorkflowConfig {
    const lanes = this.lanes();
    return {
      categories: lanes.map((l, i) => ({ ...l.cat, order: i })),
      actions: lanes.flatMap(l => l.items.map((it, i) => ({ id: it.id, type: it.type, label: it.label, categoryId: l.cat.id, order: i, enabled: it.enabled }))),
    };
  }

  // ── Drag-drop ────────────────────────────────────────────────────
  dropToLane(ev: CdkDragDrop<LaneItem[]>, laneIdx: number) {
    let addedType: string | null = null;
    if (ev.previousContainer === ev.container) {
      moveItemInArray(ev.container.data, ev.previousIndex, ev.currentIndex);
    } else if (ev.previousContainer.id === 'palette') {
      const entry = this.palette()[ev.previousIndex];
      ev.container.data.splice(ev.currentIndex, 0, { id: crypto.randomUUID(), type: entry.type, enabled: true });
      // Repeatable actions remain available in the palette for another placement.
      if (!isRepeatable(entry.type)) this.palette.update(p => p.filter((_, i) => i !== ev.previousIndex));
      addedType = entry.type;
    } else {
      const moving = (ev.previousContainer.data as LaneItem[])[ev.previousIndex];
      const targetId = this.lanes()[laneIdx]?.cat.id;
      if (isLocked(moving.type) && actionHome(moving.type) !== targetId) {
        this.toasts.info(`${this.labelFor(moving)} is locked to its area`);
        return;
      }
      transferArrayItem(ev.previousContainer.data as LaneItem[], ev.container.data, ev.previousIndex, ev.currentIndex);
    }
    this.lanes.update(l => [...l]);
    if (addedType) this.applyEnabled(addedType, true);   // pull in prerequisites
    this.dirty.set(true);
  }
  dropToPalette(ev: CdkDragDrop<ActionCatalogEntry[]>) {
    if (ev.previousContainer.id === 'palette') return;        // reorder palette — ignore
    const prev = ev.previousContainer.data as unknown as LaneItem[];
    const item = prev[ev.previousIndex];
    if (isLocked(item.type)) { this.toasts.info(`${this.labelFor(item)} can't be removed`); return; }
    prev.splice(ev.previousIndex, 1);
    const entry = catalogFor(item.type);
    // Repeatable types are already kept in the palette — don't add a duplicate.
    if (entry && !isRepeatable(item.type)) this.palette.update(p => [...p, entry]);
    // Removing an action cascades off its dependents + coupled partner (e.g. drop
    // dispatch → lab intake off; drop collection → dispatch/results off).
    const { desired } = this.cascade(item.type, false);
    this.lanes.update(l => l.map(ln => ({
      ...ln,
      items: ln.items.map(it => {
        const d = desired.get(it.type);
        return d === undefined || isMandatory(it.type) ? it : { ...it, enabled: d };
      }),
    })));
    this.dirty.set(true);
  }

  // ── Category ops ─────────────────────────────────────────────────
  addCategory() {
    const color = PALETTE_COLORS[this.lanes().length % PALETTE_COLORS.length];
    this.lanes.update(l => [...l, { cat: { id: crypto.randomUUID(), name: 'New area', icon: 'folder', color, order: l.length }, items: [] }]);
    this.dirty.set(true);
  }
  renameCategory(i: number, name: string) { this.lanes.update(l => l.map((ln, k) => k === i ? { ...ln, cat: { ...ln.cat, name } } : ln)); this.dirty.set(true); }
  recolor(i: number, color: string) { this.lanes.update(l => l.map((ln, k) => k === i ? { ...ln, cat: { ...ln.cat, color } } : ln)); this.dirty.set(true); }
  moveCategory(i: number, dir: number) {
    this.lanes.update(l => { const a = [...l]; const j = i + dir; if (j < 0 || j >= a.length) return a; [a[i], a[j]] = [a[j], a[i]]; return a; });
    this.dirty.set(true);
  }
  deleteCategory(i: number) {
    const lane = this.lanes()[i];
    if (lane.items.some(it => isLocked(it.type) && actionHome(it.type) === lane.cat.id)) {
      this.toasts.info('This work-area holds locked actions and can’t be deleted');
      return;
    }
    const back = lane.items.map(it => catalogFor(it.type)).filter((e): e is ActionCatalogEntry => !!e);
    this.palette.update(p => [...p, ...back]);
    this.lanes.update(l => l.filter((_, k) => k !== i));
    this.dirty.set(true);
  }
  toggleAction(laneIdx: number, itemIdx: number) {
    const cur = this.lanes()[laneIdx]?.items[itemIdx];
    if (!cur || isMandatory(cur.type)) return;
    this.applyEnabled(cur.type, !cur.enabled);
  }

  /** Resolve every action-type to flip when `type` changes to `enabled`,
   *  following couplings (both ways), prerequisites (when enabling) and
   *  dependents (when disabling). Also reports prerequisites that aren't placed
   *  anywhere so the caller can warn. */
  private cascade(type: string, enabled: boolean): { desired: Map<string, boolean>; missing: string[] } {
    const desired = new Map<string, boolean>();
    const missing: string[] = [];
    const placed = new Set(this.lanes().flatMap(l => l.items.map(i => i.type)));
    const visit = (t: string, en: boolean) => {
      if (desired.get(t) === en) return;
      desired.set(t, en);
      for (const p of coupledTypes(t)) visit(p, en);
      if (en) {
        for (const req of requiresOf(t)) {
          if (placed.has(req)) visit(req, true);
          else if (!missing.includes(req)) missing.push(req);
        }
      } else {
        for (const dep of dependentsOf(t)) if (placed.has(dep)) visit(dep, false);
      }
    };
    visit(type, enabled);
    return { desired, missing };
  }

  /** Apply a cascade to the lanes (mandatory actions stay on); warn on any
   *  prerequisite that isn't placed in a work-area. */
  private applyEnabled(type: string, enabled: boolean) {
    const { desired, missing } = this.cascade(type, enabled);
    this.lanes.update(l => l.map(ln => ({
      ...ln,
      items: ln.items.map(it => {
        const d = desired.get(it.type);
        if (d === undefined) return it;
        return { ...it, enabled: isMandatory(it.type) ? true : d };
      }),
    })));
    if (missing.length) {
      this.toasts.info(`Also needs ${missing.map(m => catalogFor(m)?.label ?? m).join(', ')} — add it to a work-area`);
    }
    this.dirty.set(true);
  }

  // ── Display ──────────────────────────────────────────────────────
  iconFor(type: string): string[] { return catalogFor(type)?.iconPath ?? ['M12 2v20M2 12h20']; }
  labelFor(it: LaneItem): string { return it.label || catalogFor(it.type)?.label || it.type; }
  enabledCount(lane: Lane): number { return lane.items.filter(i => i.enabled).length; }
  locked(type: string): boolean { return isLocked(type); }
  mandatory(type: string): boolean { return isMandatory(type); }

  // ── Workflow ops ─────────────────────────────────────────────────
  selectWorkflow(id: string) { const w = this.workflows().find(x => x.id === id); if (w) this.loadInto(w); }
  newWorkflow() {
    // Seed from the tenant default so the new (branch-scoped) workflow is valid
    // (carries the mandatory/locked core actions) rather than an empty config.
    const base = this.workflows().find(w => (w.branchId ?? null) === null) ?? this.workflows()[0];
    let cfg: ProcessWorkflowConfig = { categories: [], actions: [] };
    try { cfg = JSON.parse(base?.configJson ?? '{}'); } catch { /* */ }
    this.svc.create('New workflow', cfg, this.scope()).subscribe(w => { this.reload(w.id); this.toasts.success('Workflow created'); });
  }
  duplicate() {
    const id = this.currentId(); if (!id) return;
    this.svc.duplicate(id).subscribe(w => { this.reload(w.id); this.toasts.success('Duplicated'); });
  }
  activate() {
    const id = this.currentId(); if (!id) return;
    this.svc.activate(id).subscribe(() => { this.svc.refreshActive(); this.reload(id); this.toasts.success('Workflow activated — navigation updated'); });
  }
  save() {
    const id = this.currentId(); const cfg = this.buildConfig(); const nm = this.name().trim() || 'Workflow';
    this.saving.set(true);
    const done = (w: ProcessWorkflowRecord) => { this.saving.set(false); if (this.isActive()) this.svc.refreshActive(); this.reload(w.id); this.toasts.success('Saved'); };
    const fail = () => { this.saving.set(false); this.toasts.error('Save failed'); };
    if (id) this.svc.update(id, nm, cfg).subscribe({ next: done, error: fail });
    else this.svc.create(nm, cfg, this.scope()).subscribe({ next: done, error: fail });
  }
}
