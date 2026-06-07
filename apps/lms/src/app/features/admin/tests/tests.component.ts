import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { CurrencyInrPipe } from '../../../shared/pipes/currency-inr.pipe';
import { Test } from '../../../shared/models/test.model';
import { ChipComponent } from '../../../shared/primitives/chip.component';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { SegmentedComponent, SegmentedOption } from '../../../shared/primitives/segmented.component';
import { TileComponent } from '../../../shared/primitives/tile.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';

type Tab = 'individual' | 'package';

/** A department derived from the test catalogue (deduped by name). */
interface DeptGroup {
  name: string;
  code: string;
  count: number;
}

const UNASSIGNED = 'Unassigned';

@Component({
  selector: 'pf-tests',
  standalone: true,
  imports: [
    FormsModule,
    CurrencyInrPipe,
    ChipComponent,
    ScreenHeaderComponent,
    SegmentedComponent,
    TileComponent,
    TouchButtonComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="px-4 md:px-8 pt-6 pb-10">
      <pf-screen-header
        eyebrow="Admin"
        title="Tests"
        subtitle="Master test catalog and packages, grouped by department.">
        <pf-touch-btn actions size="sm" variant="primary" (pressed)="openCreate()">
          <span icon-left aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 5v14"/>
              <path d="M5 12h14"/>
            </svg>
          </span>
          {{ tab() === 'package' ? 'Create package' : 'Create test' }}
        </pf-touch-btn>
      </pf-screen-header>

      <div class="mb-4">
        <pf-segmented
          [options]="tabOptions"
          [value]="tab()"
          size="md"
          (valueChange)="setTab($event)">
        </pf-segmented>
      </div>

      <div class="flex flex-col sm:flex-row sm:flex-wrap gap-2 sm:items-center mb-4">
        <input type="text" class="pf-input w-full sm:max-w-xs"
               [placeholder]="tab() === 'package' ? 'Search packages…' : 'Search all tests…'"
               [ngModel]="search()" (ngModelChange)="onSearch($event)" />
        <p class="text-[12px] font-mono sm:ml-auto" style="color: var(--text-muted);">
          @if (showDeptGrid()) {
            {{ departments().length }} departments · {{ allForTab().length }} tests
          } @else {
            {{ visibleTests().length }} {{ tab() === 'package' ? 'packages' : 'tests' }}
          }
        </p>
      </div>

      <!-- Breadcrumb when drilled into a department -->
      @if (tab() === 'individual' && selectedDept() && !searching()) {
        <div class="flex items-center gap-2 mb-3">
          <button type="button"
                  class="text-[13px] font-medium text-violet-400 hover:text-violet-300 flex items-center gap-1"
                  (click)="clearDept()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
            All departments
          </button>
          <span style="color: var(--text-muted);">/</span>
          <span class="text-[14px] font-semibold" style="color: var(--text-primary);">{{ selectedDept() }}</span>
        </div>
      }

      <!-- ── Department grid (individual tab, no search, no drill-in) ── -->
      @if (showDeptGrid()) {
        @if (departments().length === 0) {
          <pf-tile tone="default" padding="xl">
            <div class="text-center py-6">
              <p class="text-[14px]" style="color: var(--text-secondary);">No tests yet.</p>
            </div>
          </pf-tile>
        } @else {
          <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5">
            @for (d of departments(); track d.name) {
              <button type="button" class="text-left w-full" (click)="selectDept(d.name)">
                <pf-tile tone="default" padding="md" class="block h-full transition hover:brightness-110">
                  <div class="flex items-start gap-3">
                    <div class="pf-test-icon">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M3 7h18M3 12h18M3 17h18"/>
                      </svg>
                    </div>
                    <div class="flex-1 min-w-0">
                      <p class="font-semibold text-[14px] truncate" style="color: var(--text-primary);">{{ d.name }}</p>
                      <p class="text-[12px] mt-0.5" style="color: var(--text-tertiary);">
                        {{ d.count }} {{ d.count === 1 ? 'test' : 'tests' }}
                      </p>
                    </div>
                    @if (d.code) {
                      <pf-chip tone="default" size="sm">{{ d.code }}</pf-chip>
                    }
                  </div>
                </pf-tile>
              </button>
            }
          </div>
        }
      } @else if (visibleTests().length === 0) {
        <pf-tile tone="default" padding="xl">
          <div class="text-center py-6">
            <p class="text-[14px]" style="color: var(--text-secondary);">No tests match.</p>
          </div>
        </pf-tile>
      } @else if (tab() === 'package') {
        <!-- Packages: 3-up grid of compact cards -->
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          @for (t of visibleTests(); track t.id) {
            <pf-tile tone="default" padding="md" class="block h-full">
              <div class="flex flex-col h-full gap-2">
                <div class="flex items-start gap-2.5">
                  <div class="pf-test-icon">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                      <path d="M3.27 6.96 12 12.01l8.73-5.05M12 22.08V12"/>
                    </svg>
                  </div>
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2 flex-wrap">
                      <p class="font-semibold text-[14px] truncate" style="color: var(--text-primary);">{{ t.name }}</p>
                      @if (!t.isActive) { <pf-chip tone="default" size="sm">inactive</pf-chip> }
                    </div>
                    <p class="text-[12px] mt-0.5" style="color: var(--text-tertiary);">{{ packageItemCount(t) }} tests</p>
                  </div>
                </div>
                <div class="mt-auto flex items-center justify-between pt-1">
                  <p class="font-semibold text-[15px]" style="color: var(--text-primary);">{{ t.price | inr }}</p>
                  <pf-touch-btn size="sm" variant="secondary" (pressed)="openEdit(t)">Edit</pf-touch-btn>
                </div>
              </div>
            </pf-tile>
          }
        </div>
      } @else {
        <div class="space-y-2.5">
          @for (t of visibleTests(); track t.id) {
            <pf-tile tone="default" padding="md">
              <div class="flex items-center gap-3 flex-wrap md:flex-nowrap">
                <div class="pf-test-icon">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M10 2v7.31"/>
                    <path d="M14 9.31V2"/>
                    <path d="M8.5 2h7"/>
                    <path d="M14 9.3a6.5 6.5 0 1 1-4 0"/>
                  </svg>
                </div>

                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 flex-wrap">
                    <p class="font-semibold text-[15px] truncate" style="color: var(--text-primary);">{{ t.name }}</p>
                    @if (tab() === 'individual') {
                      @if (t.flow === 'direct') {
                        <pf-chip tone="emerald" size="sm">direct</pf-chip>
                      } @else {
                        <pf-chip tone="amber" size="sm">approval</pf-chip>
                      }
                    }
                    @if (!t.isActive) {
                      <pf-chip tone="default" size="sm">inactive</pf-chip>
                    }
                  </div>
                  <p class="text-[12px] mt-0.5 truncate" style="color: var(--text-tertiary);">
                    @if (tab() === 'individual') {
                      @if (searching()) { {{ t.department?.name ?? '—' }} · }
                      {{ t.sampleType ?? 'no sample' }}
                      · TAT {{ t.tatHours }}h
                    } @else {
                      Package · {{ packageItemCount(t) }} tests
                    }
                  </p>
                </div>

                <div class="flex items-center gap-3">
                  <p class="font-semibold text-[15px]" style="color: var(--text-primary);">{{ t.price | inr }}</p>
                  <pf-touch-btn size="sm" variant="secondary" (pressed)="openEdit(t)">Edit</pf-touch-btn>
                </div>
              </div>
            </pf-tile>
          }
        </div>
      }
    </section>
  `,
  styles: [`
    .pf-test-icon {
      width: 40px;
      height: 40px;
      border-radius: 12px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, rgba(124, 58, 237, 0.22), rgba(168, 85, 247, 0.08));
      border: 1px solid rgba(168, 85, 247, 0.3);
      color: #c4b5fd;
      flex-shrink: 0;
    }
  `]
})
export class TestsComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);

  readonly tabOptions: SegmentedOption<Tab>[] = [
    { value: 'individual', label: 'Individual tests' },
    { value: 'package',    label: 'Packages' }
  ];

  private readonly _tab = signal<Tab>('individual');
  private readonly _tests = signal<Test[]>([]);
  private readonly _search = signal('');
  private readonly _selectedDept = signal<string | null>(null);

  readonly tab = this._tab.asReadonly();
  readonly tests = this._tests.asReadonly();
  readonly search = this._search.asReadonly();
  readonly selectedDept = this._selectedDept.asReadonly();

  readonly allForTab = computed(() => this._tests().filter(t => t.type === this._tab()));

  /**
   * Departments derived from the tests themselves and deduped by NAME — so the
   * same department repeated across branches (per-branch department rows)
   * collapses to one entry, and only departments that actually hold tests show.
   */
  readonly departments = computed<DeptGroup[]>(() => {
    const map = new Map<string, DeptGroup>();
    for (const t of this.allForTab()) {
      const name = t.department?.name?.trim() || UNASSIGNED;
      const code = t.department?.code?.trim() || '';
      const g = map.get(name);
      if (g) { g.count++; if (!g.code && code) g.code = code; }
      else map.set(name, { name, code, count: 1 });
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  });

  readonly searching = computed(() => this._search().trim().length > 0);

  /** Tests to show in list mode: packages = flat list; individual = global
   *  search results, or the drilled-into department's tests. */
  readonly visibleTests = computed(() => {
    const s = this._search().trim().toLowerCase();
    const tests = this.allForTab();
    if (this._tab() === 'package') {
      return s ? tests.filter(t => t.name.toLowerCase().includes(s)) : tests;
    }
    if (s) return tests.filter(t => t.name.toLowerCase().includes(s));
    const dep = this._selectedDept();
    if (dep) return tests.filter(t => (t.department?.name?.trim() || UNASSIGNED) === dep);
    return [];
  });

  /** Show the department cards: individual tab, not searching, nothing drilled into. */
  readonly showDeptGrid = computed(() =>
    this._tab() === 'individual' && !this.searching() && !this._selectedDept());

  ngOnInit() {
    this.loadTests();
  }

  setTab(t: Tab) {
    this._tab.set(t);
    this._selectedDept.set(null);
    this._search.set('');
  }
  onSearch(v: string) { this._search.set(v); }
  selectDept(name: string) { this._selectedDept.set(name); }
  clearDept() { this._selectedDept.set(null); }

  packageItemCount(t: Test): number {
    try {
      const blob = JSON.parse(t.parameters ?? '{}');
      return (blob.items?.length as number) ?? 0;
    } catch { return 0; }
  }

  private loadTests() {
    this.api.get<Test[]>('/api/tests/').subscribe({ next: l => this._tests.set(l ?? []) });
  }

  openCreate() {
    this.router.navigate(['/admin/tests/new'], { queryParams: { type: this._tab() } });
  }
  openEdit(t: Test) { this.router.navigate(['/admin/tests', t.id, 'edit']); }
}
