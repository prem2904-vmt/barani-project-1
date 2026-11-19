import { dirtySnapshot } from '../../../shared/utils/dirty-snapshot';
import { NO_CHANGES_TITLE } from '../../../shared/utils/save-state';
import { bindSaveShortcut } from '../../../shared/utils/save-shortcut';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CdkDragDrop, DragDropModule, moveItemInArray, transferArrayItem } from '@angular/cdk/drag-drop';
import { ToastService } from '../../../core/services/toast.service';
import { DialogService } from '../../../core/services/dialog.service';
import { ApiService } from '../../../core/services/api.service';
import { NavBackService } from '../../../core/services/nav-back.service';
import { ProcessWorkflowService } from '../../../core/services/process-workflow.service';
import { ApiError } from '../../../shared/models/api-response.model';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { PfSelectOption, SelectComponent } from '../../../shared/primitives/select.component';
import { ThemeService } from '../../../core/services/theme.service';
import { bandMatch } from '../../../shared/utils/band-search';
import { ACTION_CATALOG, ACTION_POLICY, ActionCatalogEntry, KNOWN_ROLES, ProcessCategory, ProcessWorkflowConfig, ProcessWorkflowRecord, WORKAREA_ICONS, catalogFor, coupledTypes, dependentsOf, isAllowedPlacement, isFixedSlotAction, isLockedItem, isMandatoryItem, actionHome, normalizeWorkflow, requiresOf, workAreaIconPath } from '../../../shared/models/process-workflow.model';
import { BusyDirective } from '../../../shared/directives/busy.directive';
import { SettingsSiblingsComponent } from '../settings/settings-siblings.component';

interface LaneItem { id: string; type: string; label?: string; enabled: boolean; }
interface Lane { cat: ProcessCategory; items: LaneItem[]; }

/** Lanes are palette-only (owner, 2026-09-25): there is NO per-lane colour
 *  setting. A new work-area still carries the model's `color` field (the
 *  stored value is untouched for existing areas) — always the one primary. */
const LANE_COLOR = '#7c3aed';

/**
 * Admin process-workflow builder. Drag operations (the action catalogue) into
 * work-area lanes (categories) to shape the navigation. Manage multiple saved
 * workflows: switch, duplicate, set active, save.
 */
@Component({
  selector: 'pf-process-builder',
  standalone: true,
  imports: [SettingsSiblingsComponent, BusyDirective, FormsModule, DragDropModule, HeroBandComponent, SelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pb pf-band-page px-4 md:px-8 lg:px-10 pt-6 pb-12">
      @if (theme.isNewDesign()) {
        <!-- Band pill (owner): search the Available-actions palette; branch
             scope + workflow pickers ride in the pill; New / Duplicate /
             Set active / Save are the band actions. -->
        <pf-hero-band [back]="true" placeholder="Search actions to place — collect, validate, print…"
                      [value]="q()" (valueChange)="q.set($event)">
          <ng-container band-tools>
            <pf-settings-siblings></pf-settings-siblings>
            @if (branches().length > 0) {
              <pf-select class="pb-bandsel" size="sm" [options]="scopeOptions()" [value]="scope() ?? ''"
                         [searchable]="branches().length > 8"
                         (valueChange)="setScope($event || null)" aria-label="Branch this workflow applies to"></pf-select>
            }
            <pf-select class="pb-bandsel" size="sm" [options]="workflowOptions()" [value]="currentId() ?? ''"
                       placeholder="New draft" (valueChange)="selectWorkflow($event)" aria-label="Workflow"></pf-select>
          </ng-container>
          <ng-container band-actions>
            <button type="button" class="pf-hb-btn pf-hb-btn--ghost press" (click)="newWorkflow()" title="New workflow" aria-label="New workflow">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
              New
            </button>
            <button type="button" class="pf-hb-btn pf-hb-btn--ghost press" [disabled]="!currentId()" (click)="duplicate()" title="Duplicate" aria-label="Duplicate">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>
              Duplicate
            </button>
            <button type="button" class="pf-hb-btn pf-hb-btn--ghost press" [disabled]="!currentId() || isActive()" (click)="activate()" title="Set active" aria-label="Set active">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
              Set active
            </button>
            <button type="button" class="pf-hb-btn pf-hb-btn--primary press" data-testid="pb-save" [disabled]="saving() || !changed()" [pfBusyInactive]="saving() || !changed()"
                    [title]="changed() || saving() ? (isSystemDefault() ? 'Customise' : 'Save') : NO_CHANGES" [pfBusy]="saving()" pfBusyLabel="Saving…" (click)="save()">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/></svg>
              {{ saving() ? 'Saving…' : (isSystemDefault() ? 'Customise' : 'Save') }}
            </button>
          </ng-container>
        </pf-hero-band>
      }
      <!-- Toolbar (classic) -->
      <header class="pb-bar pf-classic-only">
        <div class="min-w-0">
          <p class="pb-eyebrow">Admin · Process workflow</p>
          <div class="flex items-center gap-2">
            @if (navBack.showBack()) {
              <button type="button" class="pf-hdr-back shrink-0 inline-flex items-center justify-center" (click)="navBack.back()" aria-label="Go back">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
              </button>
            }
            <h1 class="pb-title">Workflow <span class="pb-title-accent">builder</span></h1>
          </div>
          <p class="pb-sub">Arrange actions into work-areas — the name becomes the nav, roles set who gets in.</p>
        </div>
        <div class="pb-bar-actions">
          @if (branches().length > 0) {
            <pf-select class="pb-select pb-select--scope" [options]="scopeOptions()" [value]="scope() ?? ''"
                       [searchable]="branches().length > 8"
                       (valueChange)="setScope($event || null)" aria-label="Branch this workflow applies to"></pf-select>
          }
          <pf-select class="pb-select" [options]="workflowOptions()" [value]="currentId() ?? ''"
                     placeholder="— new draft —" (valueChange)="selectWorkflow($event)" aria-label="Workflow"></pf-select>
          <button type="button" class="pb-btn" (click)="newWorkflow()" title="New workflow">+ New</button>
          <button type="button" class="pb-btn" [disabled]="!currentId()" (click)="duplicate()">Duplicate</button>
          <button type="button" class="pb-btn" [disabled]="!currentId() || isActive()" (click)="activate()">Set active</button>
          <button type="button" class="pb-btn pb-btn--primary" [disabled]="saving() || !changed()" [pfBusy]="saving()" pfBusyLabel="Saving…" (click)="save()" [pfBusyInactive]="saving() || !changed()" [attr.title]="(!changed() && !saving()) ? 'No changes to save' : null">{{ saving() ? 'Saving…' : (isSystemDefault() ? 'Customise' : 'Save') }}</button>
        </div>
      </header>

      <div class="pf-band-body">
      <div class="pb-name-row">
        <input class="pf-input pb-name" [ngModel]="name()" (ngModelChange)="name.set($event); dirty.set(true)" placeholder="Workflow name" aria-label="Workflow name" />
        @if (isActive()) {
          <span class="pf-chip pf-chip--static pb-active">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
            Active — drives the live navigation
          </span>
        }
        @if (changed()) { <span class="pf-savestate pb-dirty"><span class="pf-savestate__dot" aria-hidden="true"></span>Unsaved changes</span> }
      </div>
      <p class="pb-hint pf-classic-only">Configuring <strong class="pb-scope-tag">{{ branchName(scope()) }}</strong> · work-area names become the navigation · <svg class="pb-hint-lock" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg> actions are locked to their area</p>

      <div cdkDropListGroup class="pb-board">
        <!-- Palette -->
        <aside class="pb-palette">
          <div class="pb-palette-hd">Available actions<br /><span>drag into a work-area</span></div>
          <div cdkDropList id="palette" [cdkDropListData]="palette()" (cdkDropListDropped)="dropToPalette($event)" class="pb-palette-list">
            <!-- Band search HIDES non-matches (class, not a filtered array) so
                 the drop list's indices still map 1:1 onto palette(). -->
            @for (a of palette(); track a.type) {
              <div class="pb-chip" cdkDrag [class.pb-chip--hidden]="!paletteMatch(a)">
                <svg class="pb-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  @for (p of a.iconPath; track $index) { <path [attr.d]="p" /> }
                </svg>
                <span class="pb-label">{{ a.label }}</span>
                <span class="pb-grip" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/></svg></span>
              </div>
            }
            @if (palette().length === 0) { <div class="pb-empty">All actions placed.</div> }
            @else if (q().trim() && paletteMatchCount() === 0) { <div class="pb-empty">No actions match "{{ q() }}".</div> }
          </div>
        </aside>

        <!-- Lanes -->
        <div class="pb-lanes">
          @for (lane of lanes(); track lane.cat.id; let li = $index) {
            <div class="pb-lane" [class.pb-lane--collapsed]="!isExpanded(lane.cat.id)">
              <div class="pb-lane-hd">
                <!-- Single icon = the identity AND the picker: click it to choose. -->
                <div class="pb-icon-wrap">
                  <button type="button" class="pb-iconbtn"
                          (click)="toggleIconMenu(li)" title="Change icon" [attr.aria-expanded]="iconMenuLane() === li">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" width="17" height="17">
                      @for (p of catIconPath(lane.cat.icon); track $index) { <path [attr.d]="p" /> }
                    </svg>
                  </button>
                  @if (iconMenuLane() === li) {
                    <div class="pb-iconmenu" role="menu">
                      @for (ic of workAreaIcons; track ic.key) {
                        <button type="button" class="pb-iconopt" [attr.aria-pressed]="lane.cat.icon === ic.key"
                                (click)="setIcon(li, ic.key)" [title]="ic.label" [attr.aria-label]="ic.label">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" width="18" height="18">
                            @for (p of ic.path; track $index) { <path [attr.d]="p" /> }
                          </svg>
                        </button>
                      }
                    </div>
                  }
                </div>
                <input class="pb-lane-name" [ngModel]="lane.cat.name" (ngModelChange)="renameCategory(li, $event)" />
                <span class="pb-lane-count pf-num">{{ lane.items.length }}</span>
                <div class="pb-lane-tools">
                  <button type="button" class="pb-mini" [disabled]="li === 0" (click)="moveCategory(li, -1)" title="Move left" aria-label="Move left"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg></button>
                  <button type="button" class="pb-mini" [disabled]="li === lanes().length - 1" (click)="moveCategory(li, 1)" title="Move right" aria-label="Move right"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg></button>
                  <button type="button" class="pb-mini pb-mini--del" (click)="deleteCategory(li)" title="Delete work-area" aria-label="Delete work-area"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button>
                </div>
                <button type="button" class="pb-lane-expand" (click)="toggleLane(lane.cat.id)"
                        [attr.aria-expanded]="isExpanded(lane.cat.id)" title="Expand / collapse">
                  <svg class="pb-lane-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><polyline points="6 9 12 15 18 9"/></svg>
                </button>
              </div>
              <div class="pb-roles">
                <span class="pb-roles-lbl">Who</span>
                @if (roleMenuLane() === li) {
                  @for (r of roles(); track r) {
                    <button type="button" class="pb-role" [attr.aria-pressed]="laneHasRole(li, r)" (click)="toggleRole(li, r)">{{ r }}</button>
                  }
                  <button type="button" class="pb-role-add pb-role-add--done" (click)="roleMenuLane.set(-1)">done</button>
                } @else {
                  @for (r of lane.cat.roles ?? []; track r) {
                    <span class="pb-role pb-role--on">{{ r }}</span>
                  }
                  @if (!(lane.cat.roles?.length)) { <span class="pb-role-all">Anyone with access</span> }
                  <button type="button" class="pb-role-add" (click)="roleMenuLane.set(li)" title="Assign roles">+ roles</button>
                }
              </div>
              <div cdkDropList [id]="'lane-' + lane.cat.id" [cdkDropListData]="lane.items" (cdkDropListDropped)="dropToLane($event, li)" class="pb-lane-list">
                @for (item of lane.items; track item.id; let ii = $index) {
                  <div class="pb-action" [class.pb-action--off]="!item.enabled" [class.pb-action--locked]="locked(item.type, lane.cat.id)" cdkDrag [cdkDragDisabled]="locked(item.type, lane.cat.id)">
                    <svg class="pb-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                      @for (p of iconFor(item.type); track $index) { <path [attr.d]="p" /> }
                    </svg>
                    <span class="pb-label">{{ labelFor(item) }}</span>
                    <button type="button" class="pf-toggle pb-toggle" role="switch" [attr.aria-checked]="item.enabled" [disabled]="mandatory(item.type, lane.cat.id)" (click)="toggleAction(li, ii)"
                            [attr.aria-label]="labelFor(item) + (item.enabled ? ' — shown' : ' — hidden')"
                            [title]="toggleTip(item, lane.cat.id)"><span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span></button>
                    @if (locked(item.type, lane.cat.id)) {
                      <svg class="pb-lock" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" [attr.title]="lockTip(item.type)">
                        <rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>
                      </svg>
                    } @else {
                      <span class="pb-grip" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/></svg></span>
                    }
                  </div>
                }
                @if (lane.items.length === 0) { <div class="pb-empty">Drop actions here</div> }
              </div>
            </div>
          }
          <button type="button" class="pb-add-lane" (click)="addCategory()">+ Add work-area</button>
        </div>
      </div>

      <!-- Live nav preview -->
      <div class="pb-preview">
        <span class="pb-preview-lbl">Navigation preview</span>
        @for (lane of lanes(); track lane.cat.id) {
          @if (enabledCount(lane) > 0) {
            <span class="pb-preview-item"><span class="pb-dot"></span>{{ lane.cat.name }} <em class="pf-num">{{ enabledCount(lane) }}</em></span>
          }
        }
      </div>
      </div>
    </section>
  `,
  styles: [`
    @use '../../../shared/styles/device-tier' as dt;
    .pb { position: relative; }
    .pb-chip--hidden { display: none !important; }
    .pb-hint-lock { display: inline-block; vertical-align: -1px; }
    .pb-bandsel { display: block; min-width: 180px; max-width: 240px; }
    @media (max-width: 640px) { .pb-bandsel { min-width: 150px; } }
    .pb::before { content: ''; position: absolute; inset: 0 0 auto 0; height: 320px; pointer-events: none;
      background: radial-gradient(900px 320px at 18% -10%, rgba(124,58,237,0.10), transparent 70%); z-index: 0; }
    .pb > * { position: relative; z-index: 1; }

    .pb-bar { display: flex; align-items: flex-start; gap: 14px; flex-wrap: wrap; }
    .pb-bar .min-w-0 { flex: 1; }
    .pb-eyebrow { margin: 0; font-size: 10.5px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--text-tertiary); font-variant-numeric: tabular-nums; }
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
    .pb-name { width: auto; min-width: 260px; font-size: 15px; font-weight: 600; }
    .pb-active { height: 28px; font-size: 12px; color: var(--text-secondary); }
    .pb-active svg { color: var(--violet-text, #7c3aed); }
    .pb-dirty { font-size: 12px; }
    .pb-hint { margin: 0 0 16px; font-size: 11.5px; color: var(--text-tertiary); }
    .pb-scope-tag { color: var(--violet-text); font-weight: 700; }
    .pb-select--scope { border-color: rgba(124,58,237,0.45); color: #c4b5fd; font-weight: 700; }

    .pb-board { display: flex; gap: 16px; align-items: stretch; }
    @media (max-width: 820px) { .pb-board { flex-direction: column; } }

    .pb-palette { width: 206px; flex-shrink: 0; border: 1px solid var(--pf-line); border-radius: var(--pf-radius-card); background: var(--pf-card-bg); padding: 12px; align-self: flex-start; position: sticky; top: 8px; box-shadow: var(--pf-shadow-sm); }
    @media (max-width: 820px) { .pb-palette { width: 100%; position: static; } }
    .pb-palette-hd { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em; color: var(--text-secondary); margin-bottom: 10px; line-height: 1.5; }
    .pb-palette-hd span { font-weight: 400; color: var(--text-tertiary); }
    .pb-palette-list { display: flex; flex-direction: column; gap: 7px; min-height: 60px; }
    @media (max-width: 820px) { .pb-palette-list { flex-direction: row; flex-wrap: wrap; } .pb-palette-list .pb-chip { flex: 0 1 auto; } }
    .pb-chip { display: flex; align-items: center; gap: 8px; padding: 9px 11px; border-radius: 10px; background: var(--bg-card-solid, rgba(255,255,255,0.04)); border: 1px solid var(--glass-border); color: var(--text-secondary); font-size: 12.5px; font-weight: 600; cursor: grab; transition: transform .12s, border-color .15s, color .15s; }
    .pb-chip:hover { color: var(--text-primary); border-color: var(--pf-sel-border); transform: translateY(-1px); }
    .pb-chip:active { cursor: grabbing; }

    .pb-lanes { flex: 1; min-width: 0; display: flex; gap: 14px; overflow-x: auto; padding-bottom: 10px; align-items: stretch; }
    @media (max-width: 820px) { .pb-lanes { flex-direction: column; overflow-x: visible; } }
    .pb-lane { --lane: var(--color-primary, #7c3aed); flex: 1 1 226px; min-width: 214px; max-width: 300px; border: 1px solid var(--pf-line); border-radius: var(--pf-radius-card); background: var(--pf-card-bg); display: flex; flex-direction: column; box-shadow: var(--pf-shadow-sm); transition: transform var(--pf-dur-fast) var(--pf-spring), box-shadow var(--pf-dur-fast) ease; overflow: hidden; }
    .pb-lane:hover { transform: translateY(-2px); }
    @media (max-width: 820px) { .pb-lane { max-width: none; width: 100%; } }
    .pb-lane-hd { display: flex; align-items: center; gap: 8px; padding: 11px 11px; border-bottom: 1px solid var(--glass-border);
      background: color-mix(in srgb, var(--color-primary, #7c3aed) 3%, var(--pf-card-bg)); }
    .pb-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; background: var(--color-violet-600, #7c3aed); }
    .pb-lane-name { flex: 1; min-width: 0; background: transparent; border: none; color: var(--text-primary); font-size: 14px; font-weight: 700; padding: 2px 4px; border-radius: 6px; transition: background .15s; }
    .pb-lane-name:hover, .pb-lane-name:focus { background: rgba(255,255,255,0.05); outline: none; }
    .pb-lane-tools { display: flex; align-items: center; gap: 3px; }
    /* Icon picker: the leading icon is both the work-area identity and the
       trigger — click it to open a grid of choices. */
    .pb-icon-wrap { position: relative; display: inline-flex; flex-shrink: 0; }
    .pb-iconbtn {
      width: 23px; height: 23px; border-radius: 7px;
      display: inline-flex; align-items: center; justify-content: center;
      border: 0; background: color-mix(in srgb, var(--color-primary, #7c3aed) 14%, transparent); color: var(--violet-text, #7c3aed); cursor: pointer;
      transition: background .15s, border-color .15s;
    }
    .pb-iconbtn:hover { background: rgba(255,255,255,0.07); border-color: var(--text-tertiary); }
    .pb-iconmenu {
      position: absolute; top: calc(100% + 6px); left: 0; z-index: 40;
      display: grid; grid-template-columns: repeat(5, 34px); gap: 4px;
      padding: 8px; border-radius: 12px;
      background: var(--bg-card-solid, #14141f); border: 1px solid var(--glass-border);
      box-shadow: 0 18px 44px rgba(0,0,0,0.5);
    }
    .pb-iconopt {
      width: 34px; height: 34px; border-radius: 8px;
      display: inline-flex; align-items: center; justify-content: center;
      border: 1px solid transparent; background: transparent; color: var(--text-secondary); cursor: pointer;
      transition: background .12s, border-color .12s, color .12s;
    }
    .pb-iconopt:hover { background: rgba(255,255,255,0.07); color: var(--text-primary); }
    .pb-iconopt[aria-pressed='true'] { border-color: var(--pf-sel-border); background: var(--pf-sel-bg); color: var(--violet-text, #7c3aed); }
    .pb-mini { width: 23px; height: 23px; border-radius: 7px; border: 1px solid transparent; background: transparent; color: var(--text-tertiary); cursor: pointer; font-size: 13px; line-height: 1; transition: background .15s, color .15s; }
    .pb-mini:hover:not(:disabled) { background: rgba(255,255,255,0.07); color: var(--text-primary); }
    .pb-mini:disabled { opacity: 0.3; cursor: not-allowed; }
    .pb-mini--del:hover:not(:disabled) { color: #fca5a5; background: rgba(239,68,68,0.12); }
    /* Accordion controls — hidden on desktop (every lane is shown in full); the
       <=640px block surfaces them and drives the collapse. */
    .pb-lane-expand { display: none; width: 34px; height: 34px; align-items: center; justify-content: center; border: 0; background: transparent; color: var(--text-secondary); border-radius: 9px; cursor: pointer; flex-shrink: 0; }
    .pb-lane-chev { transition: transform .18s ease; }
    .pb-lane-count { display: none; min-width: 20px; height: 20px; padding: 0 6px; border-radius: 999px; background: var(--pf-chip-bg); color: var(--text-secondary); font-size: 11.5px; font-weight: 600; align-items: center; justify-content: center; flex-shrink: 0; }
    .pb-roles { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; padding: 7px 9px; border-bottom: 1px solid var(--glass-border); }
    .pb-roles-lbl { font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-tertiary); margin-right: 2px; }
    .pb-role { padding: 2px 8px; border-radius: 999px; font-size: 10px; font-weight: 600; border: 1px solid var(--glass-border); background: transparent; color: var(--text-tertiary); cursor: pointer; }
    .pb-role--on, .pb-role[aria-pressed='true'] { border-color: var(--pf-sel-border); background: var(--pf-sel-bg); color: var(--text-primary); }
    .pb-role-all { font-size: 10px; color: var(--text-tertiary); font-style: italic; }
    .pb-role-add { padding: 2px 8px; border-radius: 999px; font-size: 10px; font-weight: 700; border: 1px dashed var(--glass-border); background: transparent; color: var(--text-secondary); cursor: pointer; }
    .pb-role-add:hover { color: var(--text-primary); border-color: var(--text-tertiary); }
    .pb-role-add--done { border-style: solid; border-color: var(--pf-sel-border); color: var(--text-primary); background: var(--pf-sel-bg); }
    .pb-lane-list { flex: 1; display: flex; flex-direction: column; gap: 7px; padding: 10px; min-height: 64px; }
    .pb-action { display: flex; align-items: center; gap: 9px; padding: 9px 10px; border-radius: 10px; background: var(--bg-card-solid, rgba(255,255,255,0.05)); border: 1px solid var(--glass-border); color: var(--text-primary); font-size: 12.5px; font-weight: 600; cursor: grab; transition: transform .12s, border-color .15s, background .15s; }
    .pb-action:hover { border-color: var(--pf-sel-border); transform: translateX(2px); }
    .pb-action.cdk-drag-dragging { cursor: grabbing; }
    .pb-action--off { opacity: 0.45; }
    .pb-ic { width: 16px; height: 16px; flex-shrink: 0; color: var(--violet-text, #7c3aed); }
    .pb-label { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
    .pb-grip { display: inline-flex; color: var(--text-tertiary); cursor: grab; flex: none; }
    .pb-action--locked { opacity: 0.92; cursor: default; }
    .pb-action--locked .pb-ic { color: var(--violet-text); }
    .pb-lock { width: 13px; height: 13px; color: var(--text-tertiary); flex-shrink: 0; }
    .pb-toggle { flex: none; }   /* kit slate switch (.pf-toggle) */
    .pb-empty { font-size: 11.5px; color: var(--text-tertiary); text-align: center; padding: 14px 4px; border: 1px dashed var(--glass-border); border-radius: 10px; }
    .pb-add-lane { width: 56px; flex-shrink: 0; align-self: stretch; border: 1.5px dashed var(--glass-border); border-radius: 16px; background: transparent; color: var(--text-tertiary); font-size: 12px; font-weight: 700; cursor: pointer; writing-mode: vertical-rl; text-orientation: mixed; letter-spacing: 0.05em; transition: border-color .15s, color .15s, background .15s; }
    .pb-add-lane:hover { border-color: var(--pf-sel-border); color: var(--text-primary); background: var(--pf-sel-bg); }
    @media (max-width: 820px) { .pb-add-lane { width: 100%; writing-mode: horizontal-tb; min-height: 50px; } }

    .pb-preview { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 20px; padding: 14px 16px; border-radius: 14px; background: linear-gradient(180deg, rgba(255,255,255,0.03), transparent); border: 1px solid var(--glass-border); }
    .pb-preview-lbl { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-tertiary); margin-right: 2px; }
    .pb-preview-item { display: inline-flex; align-items: center; gap: 7px; font-size: 13px; font-weight: 600; color: var(--text-secondary); padding: 5px 11px; border-radius: 999px; background: var(--bg-card-solid, rgba(255,255,255,0.04)); border: 1px solid var(--glass-border); }
    .pb-preview-item em { font-style: normal; font-size: 11px; padding: 1px 6px; border-radius: 999px; background: var(--pf-chip-bg); color: var(--text-secondary); font-weight: 600; }

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
      .pb-lane:hover { transform: none; }
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
      .pb-toggle { min-width: 44px; min-height: 44px; justify-content: center; }
      /* role pills become toggle buttons in edit mode — give them the full
         44px touch floor (they sit in a wrap-flow so height grows gracefully). */
      .pb-role, .pb-role-add, .pb-role-add--done { min-height: 44px; display: inline-flex; align-items: center; padding-top: 8px; padding-bottom: 8px; }
      /* grip is a drag affordance, not a tap target, but give it a real touch
         box so it's draggable on touch; flex-shrink so it never collapses. */
      .pb-grip { padding: 8px 4px; flex-shrink: 0; }
      /* toolbar + name-row controls: full 44px tappable height. */
      .pb-btn, .pb-select, .pb-name { min-height: 44px; }
    }

    /* Phone (<=640px): ACCORDION. Only one work-area is expanded at a time; the
       rest collapse to just their header (name + count + chevron) so the long
       config fits a phone. The lane LIST stays rendered as a slim strip even
       when collapsed, so a dragged action can still be dropped straight onto a
       collapsed area (cdkDropListGroup keeps it a live drop target). Tapping the
       chevron expands a lane (and collapses whichever was open). Additive +
       phone-only — desktop/iPad keep every lane fully shown. */
    @media (max-width: 640px) {
      .pb-lane-expand { display: inline-flex; }
      .pb-lane-count { display: inline-flex; }
      /* COLLAPSED = header only. Hide the whole body (edit tools, roles, action
         list) and don't let the card grow — it shrinks to just its header so a
         long flow is a short stack of taps. */
      .pb-lane--collapsed { flex: 0 0 auto; }
      .pb-lane--collapsed .pb-lane-hd { border-bottom: 0; }
      .pb-lane--collapsed .pb-lane-tools,
      .pb-lane--collapsed .pb-roles,
      .pb-lane--collapsed .pb-lane-list { display: none; }
      /* EXPANDED = fills the screen: the one open lane grows tall so its actions
         + drop area dominate. The count badge is redundant once open. */
      .pb-lane:not(.pb-lane--collapsed) { flex: 1 1 auto; min-height: 62vh; }
      .pb-lane:not(.pb-lane--collapsed) .pb-lane-count { display: none; }
      .pb-lane:not(.pb-lane--collapsed) .pb-lane-chev { transform: rotate(180deg); }
    }

    /* iPad / tablet (641–1279px): put the Available-actions palette on top as
       a horizontal strip (covers iPad portrait widths like 810–834 that the
       820px breakpoint missed), then tile the work-area lanes into a grid that
       auto-fills the full width (2-up portrait, 3-up landscape) instead of a
       side-rail + uneven flex-wrap. Desktop (>=1280) keeps its side-rail board. */
    @include dt.tablet-band {
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
      .pb { padding-bottom: 0; }
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

    @media (prefers-reduced-motion: reduce) {
      .pb-lane, .pb-chip, .pb-action, .pb-btn, .pb-lane-chev { transition: none !important; transform: none !important; }
    }

    /* Phone-only back chevron (sits before the page title; hidden at md+). */
    .pf-hdr-back { width:38px; height:38px; margin-left:-8px; border-radius:11px; color:var(--text-primary); background:transparent; border:0; cursor:pointer; -webkit-tap-highlight-color:transparent; transition:background .15s ease, transform .08s ease; }
    .pf-hdr-back:active { transform:scale(0.9); background:var(--glass-bg, rgba(255,255,255,0.06)); }
    @media (hover:hover){ .pf-hdr-back:hover{ background:var(--glass-bg, rgba(255,255,255,0.06)); } }
  `]
})
export class ProcessBuilderComponent implements OnInit {
  private readonly svc = inject(ProcessWorkflowService);
  private readonly toasts = inject(ToastService);
  private readonly dialog = inject(DialogService);
  private readonly api = inject(ApiService);
  protected readonly navBack = inject(NavBackService);
  protected readonly theme = inject(ThemeService);

  /** Band pill search over the Available-actions palette (label / type). */
  readonly q = signal('');
  paletteMatch(a: ActionCatalogEntry): boolean { return bandMatch(this.q(), a.label, a.type, a.hint); }
  readonly paletteMatchCount = computed(() => this.palette().filter(a => this.paletteMatch(a)).length);

  readonly roles = signal<string[]>(KNOWN_ROLES);
  readonly roleMenuLane = signal(-1);
  /** Which lane's icon picker is open (-1 = none). */
  readonly iconMenuLane = signal(-1);
  readonly workAreaIcons = WORKAREA_ICONS;
  /** SVG paths for a work-area icon key (unknown/empty → default folder). */
  catIconPath(key: string | null | undefined): string[] { return workAreaIconPath(key); }
  /** Accordion state (phone): the id of the one expanded work-area, or null
   *  (all collapsed). Only honoured by the <=640px CSS — desktop shows every
   *  lane fully, so this is a no-op there. */
  readonly expandedLane = signal<string | null>(null);
  isExpanded(id: string): boolean { return this.expandedLane() === id; }
  toggleLane(id: string): void {
    this.expandedLane.update(cur => (cur === id ? null : id));
  }
  readonly workflows = signal<ProcessWorkflowRecord[]>([]);
  readonly branches = signal<{ id: string; name: string }[]>([]);
  /** Branch scope being configured. null = the tenant-wide default that applies
   *  to every branch without its own. Users see the workflow for their branch. */
  readonly scope = signal<string | null>(null);
  readonly currentId = signal<string | null>(null);
  readonly name = signal('');
  readonly lanes = signal<Lane[]>([]);
  readonly palette = signal<ActionCatalogEntry[]>([]);
  /** An edit happened (cheap gate); `changed` decides whether Save is enabled. */
  readonly dirty = signal(false);
  /** Owner 2026-11-19: Save only when the workflow differs from the one loaded / last saved. A scope with no workflow
   *  yet opens as an UNSAVED draft (cloned from the tenant default): that one is a change by itself. */
  private readonly snap = dirtySnapshot(() => ({ n: this.name(), l: this.lanes().map(ln => ({ c: ln.cat, i: ln.items })) }));
  private readonly unsavedDraft = signal(false);
  readonly changed = computed(() => this.unsavedDraft() || (this.dirty() && this.snap.dirty()));
  protected readonly NO_CHANGES = NO_CHANGES_TITLE;
  private readonly _saveKey = bindSaveShortcut({ canSave: () => this.changed() && !this.saving(), save: () => { void this.save(); } });
  readonly saving = signal(false);

  /** Workflows in the currently-selected branch scope. */
  readonly scopedWorkflows = computed(() => this.workflows().filter(w => (w.branchId ?? null) === this.scope()));
  /** Pill pickers ('' = the tenant-wide default scope). */
  readonly scopeOptions = computed<PfSelectOption<string>[]>(() => [
    { value: '', label: 'All branches (default)' },
    ...this.branches().map(b => ({ value: b.id, label: b.name })),
  ]);
  readonly workflowOptions = computed<PfSelectOption<string>[]>(() =>
    this.scopedWorkflows().map(w => ({ value: w.id, label: w.isActive ? `${w.name} · active` : w.name })));
  readonly isActive = computed(() => this.workflows().find(w => w.id === this.currentId())?.isActive ?? false);
  /** OURS, not the lab's: shipped, read-only, refreshed by every deploy. Saving
   *  it forks into a tenant-owned copy (the API enforces this), so the button
   *  says Customise — an admin pressing "Save" and getting a different workflow
   *  back would rightly read that as a bug. */
  readonly isSystemDefault = computed(() =>
    this.workflows().find(w => w.id === this.currentId())?.isSystemDefault ?? false);

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
    // Shared normaliser: older workflows gain the system Collect area (or have
    // their dedicated collection menu adopted as it) — Save persists it.
    cfg = normalizeWorkflow(cfg) ?? { categories: [], actions: [] };
    const cats = [...(cfg.categories ?? [])].sort((a, b) => a.order - b.order);
    const lanes: Lane[] = cats.map(cat => ({
      cat,
      items: (cfg.actions ?? []).filter(a => a.categoryId === cat.id).sort((a, b) => a.order - b.order)
        .map(a => ({ id: a.id, type: a.type, label: a.label, enabled: a.enabled })),
    }));
    this.healLocks(lanes);
    this.healDeps(lanes);
    const placed = new Set(lanes.flatMap(l => l.items.map(i => i.type)));
    // Fixed-slot actions (Sample Collection) are never in the palette: they sit
    // only in Collect / Frontdesk / Lab, placed by normalizeWorkflow.
    this.palette.set(ACTION_CATALOG.filter(a => !isFixedSlotAction(a.type) && !placed.has(a.type)));
    this.lanes.set(lanes);
    this.dirty.set(dirty);
    this.unsavedDraft.set(dirty);
    this.snap.mark();
  }

  /** Enforce the lock policy on a loaded config: every locked action sits exactly
   *  once in its home area, and mandatory ones are enabled. Repairs older / hand-
   *  edited workflows so the builder always shows a valid, professional layout.
   *  Fixed-slot actions (sample_collection) are owned by normalizeWorkflow
   *  (run just before): one copy per Collect / Frontdesk / Lab, none elsewhere. */
  private healLocks(lanes: Lane[]) {
    for (const [type, pol] of Object.entries(ACTION_POLICY)) {
      if (!pol.locked || isFixedSlotAction(type)) continue;
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
   *  a fixed point so cascades settle). Matches dispatch↔intake + the requires graph.
   *  Collection placed in the Lab does NOT collapse dispatch + lab intake (owner,
   *  2026-09-26): the patient may give the sample at the lab while the front desk
   *  still collects and dispatches, so the admin's toggles stand. */
  private healDeps(lanes: Lane[]) {
    let changed = true;
    while (changed) {
      changed = false;
      const on = new Set(lanes.flatMap(l => l.items).filter(i => i.enabled).map(i => i.type));
      for (const ln of lanes) for (const it of ln.items) {
        if (!it.enabled || isMandatoryItem(it.type, ln.cat.id)) continue;
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
    let addedId: string | undefined;
    if (ev.previousContainer === ev.container) {
      moveItemInArray(ev.container.data, ev.previousIndex, ev.currentIndex);
    } else if (ev.previousContainer.id === 'palette') {
      const entry = this.palette()[ev.previousIndex];
      if (!entry) return;
      // Defensive: a fixed-slot action is never in the palette, and can't be
      // dropped into any area by drag (its copies are placed by the normaliser).
      if (isFixedSlotAction(entry.type) || !isAllowedPlacement(entry.type, this.lanes()[laneIdx]?.cat.id)) {
        this.toasts.info(`${entry.label} is fixed to Collect, Frontdesk and Lab`);
        return;
      }
      const newId = crypto.randomUUID();
      ev.container.data.splice(ev.currentIndex, 0, { id: newId, type: entry.type, enabled: true });
      this.palette.update(p => p.filter((_, i) => i !== ev.previousIndex));
      addedType = entry.type;
      addedId = newId;
    } else {
      const moving = (ev.previousContainer.data as LaneItem[])[ev.previousIndex];
      // A locked item never changes area: a locked action only sits in its home,
      // and a fixed-slot action's copies sit only in their slots.
      if (!moving || this.locked(moving.type, this.laneIdOf(ev.previousContainer.id))) {
        if (moving) this.toasts.info(isFixedSlotAction(moving.type)
          ? `${this.labelFor(moving)} is fixed here — switch it on or off instead`
          : `${this.labelFor(moving)} is locked to its area`);
        return;
      }
      transferArrayItem(ev.previousContainer.data as LaneItem[], ev.container.data, ev.previousIndex, ev.currentIndex);
    }
    this.lanes.update(l => [...l]);
    if (addedType) this.applyEnabled(addedType, true, addedId);   // pull in prerequisites
    // Settle couplings + prerequisites (e.g. moving the last collection copy).
    this.lanes.update(l => { this.healDeps(l); return [...l]; });
    this.dirty.set(true);
  }
  dropToPalette(ev: CdkDragDrop<ActionCatalogEntry[]>) {
    if (ev.previousContainer.id === 'palette') return;        // reorder palette — ignore
    const prev = ev.previousContainer.data as unknown as LaneItem[];
    const item = prev[ev.previousIndex];
    if (this.locked(item.type, this.laneIdOf(ev.previousContainer.id))) { this.toasts.info(`${this.labelFor(item)} can't be removed`); return; }
    prev.splice(ev.previousIndex, 1);
    const entry = catalogFor(item.type);
    if (entry && !isFixedSlotAction(item.type)) this.palette.update(p => [...p, entry]);
    // Removing an action cascades off its dependents + coupled partner (e.g. drop
    // dispatch → lab intake off). Only removing the LAST enabled copy of a type
    // cascades.
    const stillSatisfied = this.lanes().some(ln =>
      ln.items.some(it => it.type === item.type && it.enabled && it.id !== item.id));
    if (!stillSatisfied) {
      const { desired } = this.cascade(item.type, false);
      this.lanes.update(l => l.map(ln => ({
        ...ln,
        items: ln.items.map(it => {
          const d = desired.get(it.type);
          return d === undefined || isMandatoryItem(it.type, ln.cat.id) ? it : { ...it, enabled: d };
        }),
      })));
    }
    this.dirty.set(true);
  }

  // ── Category ops ─────────────────────────────────────────────────
  addCategory() {
    this.lanes.update(l => [...l, { cat: { id: crypto.randomUUID(), name: 'New area', icon: 'folder', color: LANE_COLOR, order: l.length }, items: [] }]);
    this.dirty.set(true);
  }
  renameCategory(i: number, name: string) { this.lanes.update(l => l.map((ln, k) => k === i ? { ...ln, cat: { ...ln.cat, name } } : ln)); this.dirty.set(true); }
  toggleIconMenu(i: number) { this.iconMenuLane.set(this.iconMenuLane() === i ? -1 : i); }
  setIcon(i: number, icon: string) {
    this.lanes.update(l => l.map((ln, k) => k === i ? { ...ln, cat: { ...ln.cat, icon } } : ln));
    this.iconMenuLane.set(-1);
    this.dirty.set(true);
  }
  moveCategory(i: number, dir: number) {
    this.lanes.update(l => { const a = [...l]; const j = i + dir; if (j < 0 || j >= a.length) return a; [a[i], a[j]] = [a[j], a[i]]; return a; });
    this.dirty.set(true);
  }
  deleteCategory(i: number) {
    const lane = this.lanes()[i];
    // Same rule for every system area (Frontdesk, Collect, Lab, …): an area
    // holding a pinned (home) action can't be deleted.
    if (lane.items.some(it => isLockedItem(it.type, lane.cat.id))) {
      this.toasts.info('This work-area holds locked actions and can’t be deleted');
      return;
    }
    // Fixed-slot actions never return to the palette.
    const back = lane.items.filter(it => !isFixedSlotAction(it.type))
      .map(it => catalogFor(it.type)).filter((e): e is ActionCatalogEntry => !!e);
    this.palette.update(p => [...p, ...back]);
    this.lanes.update(l => l.filter((_, k) => k !== i));
    this.dirty.set(true);
  }
  toggleAction(laneIdx: number, itemIdx: number) {
    const lane = this.lanes()[laneIdx];
    const cur = lane?.items[itemIdx];
    if (!cur || isMandatoryItem(cur.type, lane.cat.id)) return;
    this.applyEnabled(cur.type, !cur.enabled, cur.id);
  }

  /** Resolve every action-type to flip when `type` changes to `enabled`,
   *  following couplings (both ways), prerequisites (when enabling) and
   *  dependents (when disabling). Also reports prerequisites that aren't placed
   *  anywhere so the caller can warn.
   *  FIXED-SLOT types (sample_collection, one copy per slot) are satisfied by ANY
   *  enabled copy: `itemId` is the copy being changed — switching it off while
   *  another copy is on (the Collect copy always is) cascades nothing, and such a
   *  prerequisite that already has an enabled copy is left be. */
  private cascade(type: string, enabled: boolean, itemId?: string): { desired: Map<string, boolean>; missing: string[] } {
    const desired = new Map<string, boolean>();
    const missing: string[] = [];
    const placed = new Set(this.lanes().flatMap(l => l.items.map(i => i.type)));
    const otherCopyOn = (t: string) => this.lanes().some(l =>
      l.items.some(i => i.type === t && i.enabled && !(t === type && i.id === itemId)));
    const visit = (t: string, en: boolean) => {
      if (desired.get(t) === en) return;
      if (isFixedSlotAction(t) && otherCopyOn(t)) {
        // Still live through another copy: flip only the originating copy (if
        // it is this type) and don't cascade further.
        if (t === type) desired.set(t, en);
        return;
      }
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
   *  prerequisite that isn't placed in a work-area. `itemId` = the placed copy
   *  the admin acted on: for a fixed-slot type ONLY that copy flips; one pulled
   *  in as a prerequisite switches on just one copy (its home copy if placed,
   *  else the first) rather than every slot. */
  private applyEnabled(type: string, enabled: boolean, itemId?: string) {
    const { desired, missing } = this.cascade(type, enabled, itemId);
    const pick = new Map<string, string>();   // fixed-slot prerequisite → the one copy to enable
    for (const [t, d] of desired) {
      if (!d || !isFixedSlotAction(t) || (t === type && itemId)) continue;
      const copies = this.lanes().flatMap(l => l.items.filter(i => i.type === t).map(i => ({ i, area: l.cat.id })));
      const chosen = copies.find(c => c.area === actionHome(t)) ?? copies[0];
      if (chosen) pick.set(t, chosen.i.id);
    }
    this.lanes.update(l => l.map(ln => ({
      ...ln,
      items: ln.items.map(it => {
        const d = desired.get(it.type);
        if (d === undefined) return it;
        if (isFixedSlotAction(it.type)) {
          if (it.type === type && itemId) return it.id === itemId ? { ...it, enabled: d } : it;
          if (d && pick.get(it.type) !== it.id) return it;
        }
        return { ...it, enabled: isMandatoryItem(it.type, ln.cat.id) ? true : d };
      }),
    })));
    if (missing.length) {
      this.toasts.info(`Also needs ${missing.map(m => catalogFor(m)?.label ?? m).join(', ')} — add it to a work-area`);
    }
    // Settle couplings + prerequisites after the cascade.
    this.lanes.update(l => { this.healDeps(l); return [...l]; });
    this.dirty.set(true);
  }

  // ── Display ──────────────────────────────────────────────────────
  iconFor(type: string): string[] { return catalogFor(type)?.iconPath ?? ['M12 2v20M2 12h20']; }
  labelFor(it: LaneItem): string { return it.label || catalogFor(it.type)?.label || it.type; }
  enabledCount(lane: Lane): number { return lane.items.filter(i => i.enabled).length; }
  /** Is this placed item pinned (no drag, no removal)? */
  locked(type: string, areaId?: string | null): boolean { return isLockedItem(type, areaId); }
  /** Is this a fixed-slot action (Sample Collection: Collect / Frontdesk / Lab)? */
  fixedSlot(type: string): boolean { return isFixedSlotAction(type); }
  /** The lock icon's tooltip. */
  lockTip(type: string): string {
    return this.fixedSlot(type) ? 'Fixed here — can’t be moved or removed' : 'Locked to this area';
  }
  /** The on/off switch's tooltip. */
  toggleTip(item: LaneItem, areaId: string): string {
    if (this.mandatory(item.type, areaId)) return 'Required — always on';
    if (this.fixedSlot(item.type)) return 'Fixed here — switch on or off';
    return item.enabled ? 'Enabled' : 'Hidden';
  }
  /** 'lane-<areaId>' drop-list id → the area id. */
  private laneIdOf(listId: string): string | null { return listId.startsWith('lane-') ? listId.slice(5) : null; }
  mandatory(type: string, areaId?: string | null): boolean { return isMandatoryItem(type, areaId); }

  // ── Workflow ops ─────────────────────────────────────────────────
  selectWorkflow(id: string) { const w = this.workflows().find(x => x.id === id); if (w) this.loadInto(w); }
  newWorkflow() {
    // Seed from the tenant default so the new (branch-scoped) workflow is valid
    // (carries the mandatory/locked core actions) rather than an empty config.
    const base = this.workflows().find(w => (w.branchId ?? null) === null) ?? this.workflows()[0];
    let cfg: ProcessWorkflowConfig = { categories: [], actions: [] };
    try { cfg = JSON.parse(base?.configJson ?? '{}'); } catch { /* */ }
    cfg = normalizeWorkflow(cfg) ?? cfg;
    this.svc.create('New workflow', cfg, this.scope()).subscribe({
      next: w => { this.reload(w.id); this.toasts.success('Workflow created'); },
      error: e => this.toasts.error(ApiError.from(e).message),
    });
  }
  duplicate() {
    const id = this.currentId(); if (!id) return;
    this.svc.duplicate(id).subscribe({
      next: w => { this.reload(w.id); this.toasts.success('Duplicated'); },
      error: e => this.toasts.error(ApiError.from(e).message),
    });
  }
  activate() {
    const id = this.currentId(); if (!id) return;
    this.svc.activate(id).subscribe({
      next: () => { this.svc.refreshActive(); this.reload(id); this.toasts.success('Workflow activated — navigation updated'); },
      error: e => this.toasts.error(ApiError.from(e).message),
    });
  }
  async save() {
    const id = this.currentId(); const cfg = this.buildConfig(); const nm = this.name().trim() || 'Workflow';

    // Customising the shipped default is not an ordinary save — it produces a
    // SEPARATE workflow and leaves the default alone. Say so before it happens:
    // an admin who thinks they edited the standard flow, and later sees it
    // unchanged after a deploy refreshes it, has every reason to call that a
    // bug. The API forks regardless; this popup is what makes it expected.
    if (this.isSystemDefault()) {
      const ok = await this.dialog.confirm({
        title: 'Customise the standard flow?',
        message: `"${this.name().trim() || 'Standard flow'}" is the standard flow we ship and keep updated. `
          + 'Your changes are saved as a NEW workflow for your lab and become active. '
          + 'The standard flow stays as shipped, so future improvements still reach you.',
        confirmLabel: 'Create my version',
        cancelLabel: 'Cancel',
        tone: 'primary',
      });
      if (!ok) return;
    }

    this.saving.set(true);
    // Saving OUR default forks it: the API returns a NEW tenant-owned workflow
    // and leaves the default untouched, so the toast must say that. "Saved"
    // would leave the admin hunting for changes on a row that never changed.
    const forking = this.isSystemDefault();
    const done = (w: ProcessWorkflowRecord) => {
      this.saving.set(false); if (this.isActive()) this.svc.refreshActive(); this.reload(w.id);
      this.toasts.success(forking
        ? `Created "${w.name}" — the standard flow stays as shipped`
        : 'Saved');
    };
    const fail = (e: unknown) => { this.saving.set(false); this.toasts.error(ApiError.from(e).message); };
    if (id) this.svc.update(id, nm, cfg).subscribe({ next: done, error: fail });
    else this.svc.create(nm, cfg, this.scope()).subscribe({ next: done, error: fail });
  }
}
