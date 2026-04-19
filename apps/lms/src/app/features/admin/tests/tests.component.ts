import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { CurrencyInrPipe } from '../../../shared/pipes/currency-inr.pipe';
import { Department } from '../../../shared/models/tenant.model';
import { Test } from '../../../shared/models/test.model';
import { ChipComponent } from '../../../shared/primitives/chip.component';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { SegmentedComponent, SegmentedOption } from '../../../shared/primitives/segmented.component';
import { PfSelectOption, SelectComponent } from '../../../shared/primitives/select.component';
import { TileComponent } from '../../../shared/primitives/tile.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';

type Tab = 'individual' | 'package';

@Component({
  selector: 'pf-tests',
  standalone: true,
  imports: [
    FormsModule,
    CurrencyInrPipe,
    ChipComponent,
    ScreenHeaderComponent,
    SegmentedComponent,
    SelectComponent,
    TileComponent,
    TouchButtonComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="px-4 md:px-8 pt-6 pb-10 max-w-7xl mx-auto">
      <pf-screen-header
        eyebrow="Admin"
        title="Tests"
        subtitle="Master test catalog and packages. Parameters, reference ranges, and TAT per test.">
        <pf-touch-btn actions size="sm" variant="primary" (pressed)="openCreate()">
          <span icon-left aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 5v14"/>
              <path d="M5 12h14"/>
            </svg>
          </span>
          Create test
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

      <div class="flex flex-wrap gap-2 items-center mb-4">
        <input type="text" class="pf-input max-w-xs" placeholder="Search test name…"
               [ngModel]="search()" (ngModelChange)="onSearch($event)" />
        @if (tab() === 'individual') {
          <div class="max-w-xs w-full sm:w-60">
            <pf-select
              [options]="deptOptions()"
              [value]="deptFilter()"
              placeholder="All departments"
              size="md"
              (valueChange)="deptFilter.set($any($event))"></pf-select>
          </div>
        }
        <p class="text-[12px] font-mono ml-auto" style="color: var(--text-muted);">
          {{ visible().length }} / {{ allForTab().length }}
        </p>
      </div>

      @if (visible().length === 0) {
        <pf-tile tone="default" padding="xl">
          <div class="text-center py-6">
            <p class="text-[14px]" style="color: var(--text-secondary);">No tests match.</p>
          </div>
        </pf-tile>
      } @else {
        <div class="space-y-2.5">
          @for (t of visible(); track t.id) {
            <pf-tile [tone]="t.isActive ? 'default' : 'default'" padding="md">
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
                      {{ t.department?.name ?? '—' }}
                      · {{ t.sampleType ?? 'no sample' }}
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
  private readonly _departments = signal<Department[]>([]);
  private readonly _search = signal('');
  readonly deptFilter = signal('');

  readonly tab = this._tab.asReadonly();
  readonly tests = this._tests.asReadonly();
  readonly departments = this._departments.asReadonly();

  readonly deptOptions = computed<PfSelectOption<string>[]>(() => [
    { value: '', label: 'All departments' },
    ...this._departments().map(d => ({ value: d.id, label: d.name }))
  ]);
  readonly search = this._search.asReadonly();

  readonly allForTab = computed(() =>
    this._tests().filter(t => t.type === this._tab())
  );
  readonly visible = computed(() => {
    const s = this._search().toLowerCase();
    const dep = this.deptFilter();
    return this.allForTab().filter(t =>
      (!s || t.name.toLowerCase().includes(s)) &&
      (!dep || t.departmentId === dep)
    );
  });

  ngOnInit() {
    this.loadTests();
    this.api.get<Department[]>('/api/tenants/departments').subscribe({ next: l => this._departments.set(l ?? []) });
  }

  setTab(t: Tab) { this._tab.set(t); }
  onSearch(v: string) { this._search.set(v); }
  packageItemCount(t: Test): number {
    try {
      const blob = JSON.parse(t.parameters ?? '{}');
      return (blob.items?.length as number) ?? 0;
    } catch { return 0; }
  }

  private loadTests() {
    this.api.get<Test[]>('/api/tests/').subscribe({ next: l => this._tests.set(l ?? []) });
  }

  openCreate() { this.router.navigateByUrl('/admin/tests/new'); }
  openEdit(t: Test) { this.router.navigate(['/admin/tests', t.id, 'edit']); }
}
