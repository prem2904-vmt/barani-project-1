import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ApiService } from '../../../core/services/api.service';
import { NavBackService } from '../../../core/services/nav-back.service';
import { ToastService } from '../../../core/services/toast.service';
import { Branch } from '../../../shared/models/tenant.model';
import { PfSelectOption, SelectComponent } from '../../../shared/primitives/select.component';
import { LoadingLogoComponent } from '../../../shared/components/loading-logo/loading-logo.component';

interface KpiCatalogItem {
  id: string;
  code: string;
  name: string;
  description?: string;
  category: string;
  valueType: string;
  defaultLabel: string;
  defaultIcon?: string;
  defaultColor?: string;
}

interface KpiAssignmentDto {
  id: string;
  branchId: string | null;
  kpiId: string;
  screen: string;
  enabled: boolean;
  sortOrder: number;
}

interface KpiSaveItem {
  kpiId: string;
  enabled: boolean;
  order: number;
}

interface ScreenDef {
  id: string;
  label: string;
  hint: string;
}

const SCREENS: ScreenDef[] = [
  { id: 'admin',              label: 'Admin dashboard',     hint: 'Tenant-wide overview' },
  { id: 'frontdesk_landing',  label: 'Frontdesk landing',   hint: 'Reception home' },
  { id: 'lab_my_work',        label: 'Lab — My Work',       hint: 'Tech queue' },
  { id: 'sample_collection',  label: 'Sample collection',   hint: 'Phlebotomy / counter' },
  { id: 'receive_samples',    label: 'Receive samples',     hint: 'Lab receiving' },
  { id: 'pathologist',        label: 'Pathologist',         hint: 'Validation queue' },
  { id: 'report_queue',       label: 'Report queue',        hint: 'Delivery' },
  { id: 'billing_counter',    label: 'Billing counter',     hint: 'Cashier' },
  { id: 'tat_board',          label: 'TAT board',           hint: 'Ops monitor' }
];

const CATEGORY_LABELS: Record<string, string> = {
  operational: 'Operational',
  tat:         'TAT & SLA',
  financial:   'Financial',
  quality:     'Quality',
  workload:    'Workload'
};

@Component({
  selector: 'pf-kpi-config',
  standalone: true,
  imports: [CommonModule, SelectComponent, LoadingLogoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pf-kpi-page">
      <header class="pf-kpi-hdr items-center md:items-start">
        @if (navBack.showBack()) {
          <button type="button" class="pf-hdr-back md:hidden shrink-0 inline-flex items-center justify-center" (click)="navBack.back()" aria-label="Go back">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
          </button>
        }
        <div>
          <h1>KPI configuration</h1>
          <p>Pick which KPI cards appear on each screen. Configure tenant-wide for everyone, or per-branch for that branch only — both layers stack.</p>
        </div>
      </header>

      <section class="pf-kpi-controls">
        <label class="pf-kpi-control">
          <span class="pf-kpi-control__lbl">Configure for</span>
          <pf-select
            [options]="scopeOptions()"
            [value]="selectedScope()"
            (valueChange)="onScopeChange($event)"></pf-select>
        </label>

        <div class="pf-kpi-screens" role="tablist" aria-label="Screen">
          @for (s of screens; track s.id) {
            <button type="button"
                    class="pf-kpi-screen-tab"
                    [class.pf-kpi-screen-tab--on]="selectedScreen() === s.id"
                    (click)="selectScreen(s.id)">
              <span class="pf-kpi-screen-tab__label">{{ s.label }}</span>
              <span class="pf-kpi-screen-tab__hint">{{ s.hint }}</span>
              @if (assignedCountForScreen(s.id) > 0) {
                <span class="pf-kpi-screen-tab__count">{{ assignedCountForScreen(s.id) }}</span>
              }
            </button>
          }
        </div>
      </section>

      @if (loading()) {
        <div class="pf-kpi-loading flex justify-center py-12">
          <pf-loading-logo size="xl" color="purple" [showDna]="true"
                           [showText]="true" text="Loading KPI configuration…"></pf-loading-logo>
        </div>
      } @else {
        <section class="pf-kpi-workshop">
          <!-- Catalog -->
          <aside class="pf-kpi-catalog">
            <header class="pf-kpi-catalog__hdr">
              <h2>Available KPIs</h2>
              <input type="search"
                     class="pf-kpi-search"
                     placeholder="Filter…"
                     [value]="filterQuery()"
                     (input)="filterQuery.set($any($event.target).value)" />
            </header>

            @for (group of filteredCatalog(); track group.category) {
              <div class="pf-kpi-cat">
                <h3>{{ group.label }}</h3>
                <ul>
                  @for (k of group.items; track k.id) {
                    <li>
                      <button type="button"
                              class="pf-kpi-cat__row"
                              [class.pf-kpi-cat__row--assigned]="isAssigned(k.id)"
                              [disabled]="isAssigned(k.id)"
                              (click)="addToScreen(k)">
                        <span class="pf-kpi-cat__name">{{ k.defaultLabel || k.name }}</span>
                        @if (k.description) {
                          <span class="pf-kpi-cat__desc">{{ k.description }}</span>
                        }
                        <span class="pf-kpi-cat__type">{{ k.valueType }}</span>
                        @if (isAssigned(k.id)) {
                          <span class="pf-kpi-cat__pill">added</span>
                        } @else {
                          <span class="pf-kpi-cat__add">＋ Add</span>
                        }
                      </button>
                    </li>
                  }
                </ul>
              </div>
            } @empty {
              <p class="pf-kpi-empty">No KPIs match "{{ filterQuery() }}".</p>
            }
          </aside>

          <!-- Assigned column -->
          <main class="pf-kpi-assigned">
            <header class="pf-kpi-assigned__hdr">
              <div>
                <h2>{{ currentScreenLabel() }}</h2>
                <p class="pf-kpi-assigned__sub">
                  {{ scopeLabel() }} · {{ assigned().length }} card{{ assigned().length === 1 ? '' : 's' }}
                </p>
              </div>
              <div class="pf-kpi-assigned__actions">
                <button type="button" class="pf-kpi-btn pf-kpi-btn--ghost"
                        [disabled]="!dirty()"
                        (click)="reload()">Discard</button>
                <button type="button" class="pf-kpi-btn pf-kpi-btn--primary"
                        [disabled]="!dirty() || saving()"
                        (click)="save()">
                  {{ saving() ? 'Saving…' : 'Save changes' }}
                </button>
              </div>
            </header>

            @if (assigned().length === 0) {
              <div class="pf-kpi-empty pf-kpi-empty--card">
                <p><strong>No KPIs assigned yet.</strong></p>
                <p>Add cards from the catalog on the left. Drag them to reorder; click × to remove.</p>
              </div>
            } @else {
              <ul class="pf-kpi-assigned__list">
                @for (a of assigned(); track a.kpiId; let i = $index) {
                  <li class="pf-kpi-tile"
                      draggable="true"
                      [class.pf-kpi-tile--dragging]="draggingIndex() === i"
                      [class.pf-kpi-tile--over]="dragOverIndex() === i && draggingIndex() !== i"
                      (dragstart)="onDragStart($event, i)"
                      (dragover)="onDragOver($event, i)"
                      (drop)="onDrop($event, i)"
                      (dragend)="onDragEnd()">
                    <span class="pf-kpi-tile__grip" aria-hidden="true">⋮⋮</span>
                    <span class="pf-kpi-tile__pos">{{ i + 1 }}</span>
                    <div class="pf-kpi-tile__body">
                      <span class="pf-kpi-tile__label">{{ kpiName(a.kpiId) }}</span>
                      <span class="pf-kpi-tile__meta">
                        {{ kpiCategory(a.kpiId) }} · {{ kpiValueType(a.kpiId) }}
                      </span>
                    </div>
                    <label class="pf-kpi-tile__toggle" [title]="a.enabled ? 'Disable' : 'Enable'">
                      <input type="checkbox" [checked]="a.enabled" (change)="toggleEnabled(i)" />
                      <span></span>
                    </label>
                    <button type="button" class="pf-kpi-tile__x"
                            (click)="removeAt(i)" aria-label="Remove">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                           stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
                      </svg>
                    </button>
                  </li>
                }
              </ul>
            }
          </main>
        </section>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }

    .pf-kpi-page {
      max-width: 1280px;
      margin: 0 auto;
      padding: 24px clamp(16px, 3vw, 32px);
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    .pf-kpi-hdr h1 {
      font-size: 22px;
      font-weight: 700;
      letter-spacing: -0.01em;
      color: var(--text-primary);
      margin: 0;
    }
    .pf-kpi-hdr p {
      margin: 6px 0 0;
      font-size: 13.5px;
      color: var(--text-secondary);
      max-width: 72ch;
    }

    .pf-kpi-controls {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .pf-kpi-control {
      display: flex;
      flex-direction: column;
      gap: 6px;
      max-width: 320px;
    }
    .pf-kpi-control__lbl {
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--text-tertiary);
    }

    /* ── Screen tabs ───────────────────────────────────────── */
    .pf-kpi-screens {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
      gap: 8px;
    }
    .pf-kpi-screen-tab {
      position: relative;
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 10px 14px;
      text-align: left;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      border-radius: 12px;
      color: var(--text-secondary);
      cursor: pointer;
      transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
    }
    .pf-kpi-screen-tab:hover {
      color: var(--text-primary);
      background: var(--glass-bg-hover);
    }
    .pf-kpi-screen-tab--on {
      color: white;
      background: linear-gradient(135deg, rgba(139, 92, 246, 0.32), rgba(217, 70, 239, 0.18));
      border-color: rgba(168, 85, 247, 0.5);
      box-shadow: 0 6px 18px rgba(124, 58, 237, 0.18);
    }
    .pf-kpi-screen-tab__label {
      font-size: 13.5px;
      font-weight: 600;
      letter-spacing: -0.005em;
    }
    .pf-kpi-screen-tab__hint {
      font-size: 11.5px;
      color: var(--text-tertiary);
    }
    .pf-kpi-screen-tab--on .pf-kpi-screen-tab__hint { color: rgba(255,255,255,0.7); }
    .pf-kpi-screen-tab__count {
      position: absolute;
      top: 8px;
      right: 8px;
      min-width: 22px;
      height: 22px;
      padding: 0 6px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 9999px;
      background: rgba(168, 85, 247, 0.22);
      border: 1px solid rgba(168, 85, 247, 0.4);
      font-size: 11px;
      font-weight: 600;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      color: #d8b4fe;
    }
    .pf-kpi-screen-tab--on .pf-kpi-screen-tab__count {
      background: rgba(255,255,255,0.18);
      border-color: rgba(255,255,255,0.32);
      color: white;
    }

    /* ── Workshop ──────────────────────────────────────────── */
    .pf-kpi-workshop {
      display: grid;
      grid-template-columns: minmax(280px, 360px) 1fr;
      gap: 20px;
      align-items: flex-start;
    }
    @media (max-width: 900px) {
      .pf-kpi-workshop { grid-template-columns: 1fr; }
    }

    .pf-kpi-catalog,
    .pf-kpi-assigned {
      background: var(--bg-card-solid);
      border: 1px solid var(--glass-border);
      border-radius: 16px;
      overflow: hidden;
    }

    .pf-kpi-catalog__hdr {
      padding: 14px 16px;
      border-bottom: 1px solid var(--glass-border);
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .pf-kpi-catalog__hdr h2 {
      margin: 0;
      font-size: 13px;
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--text-tertiary);
    }
    .pf-kpi-search {
      width: 100%;
      padding: 0.5rem 0.75rem;
      background: var(--input-bg);
      border: 1px solid var(--input-border);
      color: var(--input-text);
      border-radius: 10px;
      font-size: 13px;
      outline: none;
    }
    .pf-kpi-search:focus { border-color: var(--input-border-focus); box-shadow: 0 0 0 3px rgba(139,92,246,0.18); }

    .pf-kpi-cat { padding: 8px 8px 4px; }
    .pf-kpi-cat h3 {
      margin: 0 0 6px;
      padding: 4px 8px;
      font-size: 10.5px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--text-tertiary);
    }
    .pf-kpi-cat ul { list-style: none; margin: 0; padding: 0; }

    .pf-kpi-cat__row {
      width: 100%;
      display: grid;
      grid-template-columns: 1fr auto;
      grid-template-areas: "name action" "desc action" "type action";
      gap: 2px 12px;
      padding: 8px 10px;
      border: 0;
      background: transparent;
      border-radius: 8px;
      cursor: pointer;
      text-align: left;
      transition: background 0.12s ease;
    }
    .pf-kpi-cat__row:hover:not(:disabled) { background: var(--bg-hover); }
    .pf-kpi-cat__row:disabled { opacity: 0.6; cursor: default; }
    .pf-kpi-cat__name {
      grid-area: name;
      font-size: 13px;
      font-weight: 600;
      color: var(--text-primary);
    }
    .pf-kpi-cat__desc {
      grid-area: desc;
      font-size: 11.5px;
      color: var(--text-secondary);
      line-height: 1.35;
    }
    .pf-kpi-cat__type {
      grid-area: type;
      font-size: 10.5px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      color: var(--text-muted);
      letter-spacing: 0.04em;
    }
    .pf-kpi-cat__add, .pf-kpi-cat__pill {
      grid-area: action;
      align-self: center;
      font-size: 11.5px;
      font-weight: 600;
      padding: 4px 8px;
      border-radius: 8px;
    }
    .pf-kpi-cat__add { color: #c4b5fd; background: rgba(168, 85, 247, 0.1); }
    .pf-kpi-cat__pill { color: var(--text-muted); background: rgba(255,255,255,0.04); }

    /* ── Assigned column ───────────────────────────────────── */
    .pf-kpi-assigned__hdr {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 14px 16px;
      border-bottom: 1px solid var(--glass-border);
    }
    .pf-kpi-assigned__hdr h2 {
      margin: 0;
      font-size: 15px;
      font-weight: 600;
      color: var(--text-primary);
    }
    .pf-kpi-assigned__sub {
      margin: 2px 0 0;
      font-size: 12px;
      color: var(--text-tertiary);
    }
    .pf-kpi-assigned__actions { display: flex; gap: 8px; }

    .pf-kpi-btn {
      padding: 0.5rem 0.95rem;
      font-size: 12.5px;
      font-weight: 600;
      border-radius: 9px;
      cursor: pointer;
      border: 1px solid transparent;
      transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
    }
    .pf-kpi-btn[disabled] { opacity: 0.5; cursor: not-allowed; }
    .pf-kpi-btn--ghost {
      background: transparent;
      color: var(--text-secondary);
      border-color: var(--glass-border);
    }
    .pf-kpi-btn--ghost:hover:not([disabled]) {
      background: var(--bg-hover);
      color: var(--text-primary);
    }
    .pf-kpi-btn--primary {
      background: linear-gradient(135deg, #8b5cf6, #ec4899);
      color: white;
      box-shadow: 0 6px 18px rgba(124, 58, 237, 0.32);
    }
    .pf-kpi-btn--primary:hover:not([disabled]) { filter: brightness(1.08); }

    .pf-kpi-assigned__list { list-style: none; margin: 0; padding: 8px; display: flex; flex-direction: column; gap: 6px; }

    .pf-kpi-tile {
      display: grid;
      grid-template-columns: 24px 28px 1fr auto auto;
      align-items: center;
      gap: 10px;
      padding: 10px 12px;
      background: var(--bg-elevated, rgba(255,255,255,0.02));
      border: 1px solid var(--glass-border);
      border-radius: 10px;
      transition: border-color 0.15s ease, background 0.15s ease;
    }
    .pf-kpi-tile:hover { border-color: rgba(168, 85, 247, 0.32); }
    .pf-kpi-tile--dragging { opacity: 0.5; }
    .pf-kpi-tile--over { border-color: rgba(168, 85, 247, 0.7); background: rgba(168,85,247,0.06); }

    .pf-kpi-tile__grip {
      cursor: grab;
      color: var(--text-muted);
      font-family: monospace;
      font-size: 16px;
      letter-spacing: -2px;
      user-select: none;
    }
    .pf-kpi-tile--dragging .pf-kpi-tile__grip { cursor: grabbing; }

    .pf-kpi-tile__pos {
      width: 28px;
      height: 28px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 8px;
      background: rgba(168, 85, 247, 0.14);
      color: #c4b5fd;
      font-size: 11.5px;
      font-weight: 700;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
    }

    .pf-kpi-tile__body { min-width: 0; display: flex; flex-direction: column; }
    .pf-kpi-tile__label { font-size: 13.5px; font-weight: 600; color: var(--text-primary); }
    .pf-kpi-tile__meta { font-size: 11.5px; color: var(--text-tertiary); margin-top: 1px; }

    .pf-kpi-tile__toggle {
      position: relative;
      display: inline-flex;
      width: 36px;
      height: 20px;
      cursor: pointer;
    }
    .pf-kpi-tile__toggle input { opacity: 0; width: 0; height: 0; }
    .pf-kpi-tile__toggle span {
      position: absolute;
      inset: 0;
      background: var(--input-bg);
      border: 1px solid var(--input-border);
      border-radius: 9999px;
      transition: background 0.15s ease, border-color 0.15s ease;
    }
    .pf-kpi-tile__toggle span::after {
      content: '';
      position: absolute;
      top: 2px;
      left: 2px;
      width: 14px;
      height: 14px;
      border-radius: 9999px;
      background: var(--text-muted);
      transition: left 0.18s ease, background 0.18s ease;
    }
    .pf-kpi-tile__toggle input:checked + span {
      background: linear-gradient(135deg, #8b5cf6, #ec4899);
      border-color: transparent;
    }
    .pf-kpi-tile__toggle input:checked + span::after { left: 18px; background: white; }

    .pf-kpi-tile__x {
      width: 28px;
      height: 28px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 8px;
      background: transparent;
      border: 1px solid transparent;
      color: var(--text-muted);
      cursor: pointer;
      transition: background 0.12s ease, color 0.12s ease;
    }
    .pf-kpi-tile__x:hover {
      background: rgba(239, 68, 68, 0.1);
      color: #fca5a5;
    }

    .pf-kpi-empty {
      padding: 32px;
      text-align: center;
      color: var(--text-secondary);
      font-size: 13px;
    }
    .pf-kpi-empty--card { padding: 48px 24px; }
    .pf-kpi-empty p { margin: 4px 0; }

    .pf-kpi-loading {
      padding: 48px;
      text-align: center;
      color: var(--text-tertiary);
      font-size: 13px;
    }

    /* Mobile back chevron — phone-only, additive. Desktop/iPad (>=768px)
       never render the button (md:hidden) and the header layout is unchanged. */
    .pf-hdr-back {
      width: 38px;
      height: 38px;
      margin-left: -8px;
      border-radius: 11px;
      color: var(--text-primary);
      background: transparent;
      border: 0;
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
      transition: background .15s ease, transform .08s ease;
    }
    .pf-hdr-back:active { transform: scale(0.9); background: var(--glass-bg, rgba(255,255,255,0.06)); }
    @media (hover: hover) {
      .pf-hdr-back:hover { background: var(--glass-bg, rgba(255,255,255,0.06)); }
    }
    /* Make the header a row so the chevron sits beside the title, phone-only.
       Above md the chevron is hidden, so this never affects desktop/iPad. */
    @media (max-width: 767.98px) {
      .pf-kpi-hdr { display: flex; gap: 8px; }
    }

    /* ═══════════════════════════════════════════════════════════
       CROSS-PLATFORM OVERRIDES — additive only.
       Desktop-web (>=1280px) is untouched by everything below.
       ═══════════════════════════════════════════════════════════ */

    /* Gate hover affordances so touch devices don't get sticky hover
       states. Desktop (hover-capable) keeps its existing base hovers. */
    @media (hover: none) {
      .pf-kpi-screen-tab:hover { color: var(--text-secondary); background: var(--glass-bg); }
      .pf-kpi-screen-tab--on:hover { color: white; background: linear-gradient(135deg, rgba(139, 92, 246, 0.32), rgba(217, 70, 239, 0.18)); }
      .pf-kpi-cat__row:hover:not(:disabled) { background: transparent; }
      .pf-kpi-tile:hover { border-color: var(--glass-border); }
      .pf-kpi-btn--ghost:hover:not([disabled]) { background: transparent; color: var(--text-secondary); }
      .pf-kpi-btn--primary:hover:not([disabled]) { filter: none; }
      .pf-kpi-tile__x:hover { background: transparent; color: var(--text-muted); }
    }

    /* Coarse pointers (touch): enlarge interactive controls to >=44px. */
    @media (pointer: coarse) {
      .pf-kpi-tile__x { width: 44px; height: 44px; }
      .pf-kpi-tile__toggle { width: 46px; height: 28px; }
      .pf-kpi-tile__toggle span::after { width: 22px; height: 22px; top: 2px; left: 2px; }
      .pf-kpi-tile__toggle input:checked + span::after { left: 20px; }
      .pf-kpi-cat__row { padding-top: 11px; padding-bottom: 11px; }
      .pf-kpi-tile__grip { font-size: 18px; padding: 4px 0; }
    }

    /* Below desktop (<=1279): guard long KPI labels/names from overflowing
       their grid cells. Desktop-web (>=1280) keeps its existing rendering. */
    @media (max-width: 1279px) {
      .pf-kpi-cat__name { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
      .pf-kpi-tile__label,
      .pf-kpi-tile__meta {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    }

    /* iPad / tablet (641–1279): keep the two-column workshop where it fits.
       The base rule collapses to one column below 900px; for the 901–1279
       band the base two-column layout already applies, so nothing extra is
       needed there. Below 900 we tune spacing for the stacked layout. */
    @media (min-width: 641px) and (max-width: 1279px) {
      .pf-kpi-page { padding-top: 20px; }
    }

    /* Phone (<=640): single-column everything, no horizontal overflow,
       16px inputs to stop iOS zoom, comfortable tap targets, and an action
       row that wraps instead of crowding. */
    @media (max-width: 640px) {
      .pf-kpi-page {
        padding: 16px 14px;
        gap: 16px;
      }
      .pf-kpi-control { max-width: none; }

      /* Stack screen tabs full-width so each is an easy tap target.
         Reserve room on the right so the count badge never sits on the text. */
      .pf-kpi-screens { grid-template-columns: 1fr; }
      .pf-kpi-screen-tab { padding: 12px 40px 12px 14px; min-height: 48px; }

      /* Workshop already collapses to one column via the 900px base rule.
         Cap the catalog height so it doesn't push the assigned list far
         down — scroll within itself rather than the whole page. */
      .pf-kpi-workshop { gap: 14px; }
      .pf-kpi-catalog {
        max-height: 50dvh;
        overflow-y: auto;
        -webkit-overflow-scrolling: touch;
      }
      .pf-kpi-catalog__hdr { position: sticky; top: 0; z-index: 1; background: var(--bg-card-solid); }
      .pf-kpi-search { font-size: 16px; }

      /* Assigned header: let title + actions stack and the buttons fill. */
      .pf-kpi-assigned__hdr {
        flex-direction: column;
        align-items: stretch;
        gap: 10px;
      }
      .pf-kpi-assigned__actions { width: 100%; }
      .pf-kpi-assigned__actions .pf-kpi-btn { flex: 1; min-height: 44px; }

      /* Catalog rows comfortable to tap. */
      .pf-kpi-cat__row { min-height: 48px; align-content: center; }
    }
  `]
})
export class KpiConfigComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  protected readonly navBack = inject(NavBackService);

  protected readonly screens = SCREENS;

  // Catalog + branches load once and stay.
  private readonly _catalog = signal<KpiCatalogItem[]>([]);
  private readonly _branches = signal<Branch[]>([]);
  // Assignments are scoped to the currently selected (screen, scope) — they
  // reload whenever either changes.
  private readonly _assigned = signal<KpiAssignmentDto[]>([]);
  // Local edit buffer — what the user is staging. Compared against
  // `_assigned` to detect dirty state.
  private readonly _draft = signal<KpiAssignmentDto[]>([]);
  // Counts per screen (across the current scope) for the screen-tab badges.
  private readonly _screenCounts = signal<Record<string, number>>({});

  private readonly _loading = signal(true);
  private readonly _saving = signal(false);
  protected readonly filterQuery = signal('');

  /**
   * Selected scope encoded as a single string so it fits the pf-select
   * value model. `__tenant` = tenant-wide; otherwise the branch GUID.
   */
  protected readonly selectedScope = signal<string>('__tenant');
  protected readonly selectedScreen = signal<string>(SCREENS[0].id);

  // Drag-and-drop indices.
  protected readonly draggingIndex = signal<number | null>(null);
  protected readonly dragOverIndex = signal<number | null>(null);

  readonly loading = this._loading.asReadonly();
  readonly saving = this._saving.asReadonly();
  readonly assigned = this._draft.asReadonly();

  readonly currentScreenLabel = computed(() =>
    SCREENS.find(s => s.id === this.selectedScreen())?.label ?? this.selectedScreen());

  readonly scopeOptions = computed<PfSelectOption<string>[]>(() => [
    { value: '__tenant', label: 'All branches (tenant-wide)' },
    ...this._branches().map(b => ({ value: b.id, label: b.name }))
  ]);

  readonly scopeLabel = computed(() => {
    const scope = this.selectedScope();
    if (scope === '__tenant') return 'All branches';
    const b = this._branches().find(x => x.id === scope);
    return b ? `Branch · ${b.name}` : 'Branch';
  });

  readonly dirty = computed(() => {
    const a = this._assigned();
    const d = this._draft();
    if (a.length !== d.length) return true;
    for (let i = 0; i < a.length; i++) {
      if (a[i].kpiId !== d[i].kpiId) return true;
      if (a[i].enabled !== d[i].enabled) return true;
      if (a[i].sortOrder !== d[i].sortOrder) return true;
    }
    return false;
  });

  /**
   * Catalog grouped by category, then filtered by the search query. Items
   * already assigned in the draft are kept visible but disabled (so the
   * admin can see they exist; the "added" pill makes the state explicit).
   */
  readonly filteredCatalog = computed(() => {
    const q = this.filterQuery().trim().toLowerCase();
    const matches = (k: KpiCatalogItem) =>
      !q ||
      k.name.toLowerCase().includes(q) ||
      k.code.toLowerCase().includes(q) ||
      (k.description ?? '').toLowerCase().includes(q);

    const grouped = new Map<string, KpiCatalogItem[]>();
    for (const k of this._catalog()) {
      if (!matches(k)) continue;
      const list = grouped.get(k.category) ?? [];
      list.push(k);
      grouped.set(k.category, list);
    }
    return Array.from(grouped.entries()).map(([category, items]) => ({
      category,
      label: CATEGORY_LABELS[category] ?? category,
      items: items.slice().sort((a, b) => a.name.localeCompare(b.name))
    }));
  });

  ngOnInit() {
    this.loadCatalog();
    this.loadBranches();
    this.loadAssignmentsForCurrentScope();
  }

  // ── Scope / screen pickers ─────────────────────────────────
  onScopeChange(value: string) {
    if (value === this.selectedScope()) return;
    if (this.dirty() && !confirm('Discard unsaved changes?')) return;
    this.selectedScope.set(value);
    this.loadAssignmentsForCurrentScope();
  }

  selectScreen(id: string) {
    if (id === this.selectedScreen()) return;
    if (this.dirty() && !confirm('Discard unsaved changes?')) return;
    this.selectedScreen.set(id);
    this.loadAssignmentsForCurrentScope();
  }

  // ── Catalog ↔ assigned ─────────────────────────────────────
  isAssigned(kpiId: string): boolean {
    return this._draft().some(a => a.kpiId === kpiId);
  }

  addToScreen(k: KpiCatalogItem) {
    if (this.isAssigned(k.id)) return;
    const next = this._draft();
    const newRow: KpiAssignmentDto = {
      // Empty id signals "not yet persisted"; backend's bulk save is keyed
      // by (scope, screen, kpiId) so the id round-trip isn't required.
      id: '',
      branchId: this.selectedScope() === '__tenant' ? null : this.selectedScope(),
      kpiId: k.id,
      screen: this.selectedScreen(),
      enabled: true,
      sortOrder: next.length
    };
    this._draft.set([...next, newRow]);
  }

  removeAt(index: number) {
    const next = this._draft().slice();
    next.splice(index, 1);
    next.forEach((a, i) => a.sortOrder = i);
    this._draft.set(next);
  }

  toggleEnabled(index: number) {
    const next = this._draft().slice();
    next[index] = { ...next[index], enabled: !next[index].enabled };
    this._draft.set(next);
  }

  // ── Drag & drop reorder ────────────────────────────────────
  onDragStart(ev: DragEvent, index: number) {
    this.draggingIndex.set(index);
    ev.dataTransfer?.setData('text/plain', String(index));
    if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move';
  }
  onDragOver(ev: DragEvent, index: number) {
    if (this.draggingIndex() === null) return;
    ev.preventDefault();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
    this.dragOverIndex.set(index);
  }
  onDrop(ev: DragEvent, target: number) {
    ev.preventDefault();
    const src = this.draggingIndex();
    this.draggingIndex.set(null);
    this.dragOverIndex.set(null);
    if (src === null || src === target) return;
    const next = this._draft().slice();
    const [moved] = next.splice(src, 1);
    next.splice(target, 0, moved);
    next.forEach((a, i) => a.sortOrder = i);
    this._draft.set(next);
  }
  onDragEnd() {
    this.draggingIndex.set(null);
    this.dragOverIndex.set(null);
  }

  // ── Catalog look-ups ───────────────────────────────────────
  kpiName(kpiId: string): string {
    const k = this._catalog().find(x => x.id === kpiId);
    return k ? (k.defaultLabel || k.name) : kpiId;
  }
  kpiCategory(kpiId: string): string {
    const k = this._catalog().find(x => x.id === kpiId);
    return k ? (CATEGORY_LABELS[k.category] ?? k.category) : '—';
  }
  kpiValueType(kpiId: string): string {
    const k = this._catalog().find(x => x.id === kpiId);
    return k ? k.valueType : '—';
  }

  assignedCountForScreen(screen: string): number {
    if (screen === this.selectedScreen()) return this._draft().length;
    return this._screenCounts()[screen] ?? 0;
  }

  // ── Persist ────────────────────────────────────────────────
  save() {
    const items: KpiSaveItem[] = this._draft().map((a, i) => ({
      kpiId: a.kpiId,
      enabled: a.enabled,
      order: i
    }));
    const branchId = this.selectedScope() === '__tenant' ? null : this.selectedScope();
    this._saving.set(true);
    this.api.post<KpiAssignmentDto[]>('/api/kpis/assignments', {
      screen: this.selectedScreen(),
      branchId,
      items
    }).subscribe({
      next: rows => {
        this._assigned.set(rows ?? []);
        this._draft.set((rows ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder));
        this._saving.set(false);
        this.toasts.success('KPI layout saved');
        this.refreshScreenCounts();
      },
      error: () => {
        this._saving.set(false);
        this.toasts.error('Could not save — check permissions');
      }
    });
  }

  reload() {
    if (this.dirty() && !confirm('Discard unsaved changes?')) return;
    this.loadAssignmentsForCurrentScope();
  }

  // ── Loaders ────────────────────────────────────────────────
  private loadCatalog() {
    this.api.get<KpiCatalogItem[]>('/api/kpis').subscribe({
      next: list => this._catalog.set(list ?? []),
      error: () => this.toasts.error('Could not load KPI catalog')
    });
  }

  private loadBranches() {
    this.api.get<Branch[]>('/api/tenants/branches').subscribe({
      next: list => this._branches.set(list ?? []),
      error: () => this._branches.set([])
    });
  }

  private loadAssignmentsForCurrentScope() {
    this._loading.set(true);
    const scope = this.selectedScope();
    const params = new URLSearchParams({ screen: this.selectedScreen() });
    if (scope !== '__tenant') params.set('branchId', scope);
    this.api.get<KpiAssignmentDto[]>(`/api/kpis/assignments?${params}`).subscribe({
      next: list => {
        const sorted = (list ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder);
        this._assigned.set(sorted);
        this._draft.set(sorted.map(x => ({ ...x })));
        this._loading.set(false);
        this.refreshScreenCounts();
      },
      error: () => {
        this._assigned.set([]);
        this._draft.set([]);
        this._loading.set(false);
      }
    });
  }

  /**
   * Fetch every screen's count so the screen-tab badges stay accurate when
   * the admin moves between screens. We could persist this in a single
   * endpoint later — for now we issue one call per screen which keeps the
   * backend dumb.
   */
  private refreshScreenCounts() {
    const scope = this.selectedScope();
    const branchParam = scope === '__tenant' ? '' : `&branchId=${scope}`;
    const counts: Record<string, number> = {};
    let pending = SCREENS.length;
    for (const s of SCREENS) {
      this.api.get<KpiAssignmentDto[]>(`/api/kpis/assignments?screen=${s.id}${branchParam}`).subscribe({
        next: list => {
          counts[s.id] = (list ?? []).length;
          pending--;
          if (pending === 0) this._screenCounts.set(counts);
        },
        error: () => { pending--; if (pending === 0) this._screenCounts.set(counts); }
      });
    }
  }
}
