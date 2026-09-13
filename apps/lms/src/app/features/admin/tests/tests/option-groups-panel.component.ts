import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService } from '../../../../core/services/api.service';
import { ToastService } from '../../../../core/services/toast.service';

interface OgRow { code: string | null; value: string; normal: boolean; active: boolean; }
interface OgLink { testId: string; testCode: string | null; testName: string; paramName: string; paramTitle: string; }
interface OgGroup { code: string; name: string; values: OgRow[]; links: OgLink[]; }

/**
 * The Test Master's OPTION GROUPS view — every shared result vocabulary
 * (Present/Absent, Nil/Few/Moderate/Many, …) shown ONCE, with the tests it is
 * linked into, and editable in one place. Saving rewrites the option rows on
 * every linked parameter (edit once, changes everywhere); the group list is
 * derived live from the tenant's own tests, so it can never drift from what
 * result entry actually renders.
 */
@Component({
  selector: 'pf-option-groups-panel',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pf-og">
      <div class="pf-og__bar">
        <input type="text" class="pf-og__search" placeholder="Search values, tests, parameters…"
               [ngModel]="query()" (ngModelChange)="query.set($event)" />
        <span class="pf-og__count">{{ filtered().length }} option group{{ filtered().length === 1 ? '' : 's' }}</span>
      </div>

      @if (loading()) {
        <div class="pf-og__note">Loading option groups…</div>
      } @else if (filtered().length === 0) {
        <div class="pf-og__note">No option groups — parameters with option tables will appear here.</div>
      }

      @for (g of filtered(); track g.code) {
        <div class="pf-og__card" [class.pf-og__card--open]="expanded() === g.code">
          <button type="button" class="pf-og__head" (click)="toggle(g.code)">
            <div class="pf-og__titles">
              <span class="pf-og__name">{{ g.name }}</span>
              <span class="pf-og__code">{{ g.code }}</span>
            </div>
            <div class="pf-og__chips">
              @for (v of g.values; track v.value) {
                <span class="pf-og__chip" [class.pf-og__chip--normal]="v.normal" [class.pf-og__chip--off]="!v.active">
                  {{ v.value }}
                </span>
              }
            </div>
            <span class="pf-og__usage">{{ testCount(g) }} test{{ testCount(g) === 1 ? '' : 's' }} · {{ g.links.length }} parameter{{ g.links.length === 1 ? '' : 's' }}</span>
            <svg class="pf-og__chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
          </button>

          @if (expanded() === g.code) {
            <div class="pf-og__body">
              @if (editing() === g.code) {
                <!-- ── Edit the vocabulary once; applies everywhere below. ── -->
                <div class="pf-og__editor">
                  @for (r of draft(); track $index) {
                    <div class="pf-og__row">
                      <span class="pf-og__rowcode">{{ r.code || '—' }}</span>
                      <input type="text" class="pf-og__rowval" [ngModel]="r.value"
                             (ngModelChange)="patchRow($index, { value: $event })" placeholder="Value" />
                      <label class="pf-og__flag"><input type="checkbox" [checked]="r.normal"
                             (change)="patchRow($index, { normal: !r.normal })" /> Normal</label>
                      <label class="pf-og__flag"><input type="checkbox" [checked]="r.active"
                             (change)="patchRow($index, { active: !r.active })" /> Active</label>
                      <button type="button" class="pf-og__rowdel" (click)="removeRow($index)" aria-label="Remove value">×</button>
                    </div>
                  }
                  <button type="button" class="pf-og__addrow" (click)="addRow()">+ Add value</button>
                  <div class="pf-og__editact">
                    <span class="pf-og__warn">Saving updates {{ g.links.length }} parameter{{ g.links.length === 1 ? '' : 's' }} across {{ testCount(g) }} test{{ testCount(g) === 1 ? '' : 's' }}.</span>
                    <button type="button" class="pf-og__ghost" (click)="editing.set(null)">Cancel</button>
                    <button type="button" class="pf-og__save" [disabled]="saving() || !draftValid()" (click)="save(g)">
                      {{ saving() ? 'Saving…' : 'Save everywhere' }}
                    </button>
                  </div>
                </div>
              } @else {
                <div class="pf-og__act">
                  <button type="button" class="pf-og__edit" (click)="startEdit(g)">Edit values</button>
                </div>
              }

              <!-- ── Where this vocabulary is used. ── -->
              <table class="pf-og__links">
                <thead><tr><th>Test</th><th>Parameter</th></tr></thead>
                <tbody>
                  @for (l of g.links; track l.testId + l.paramName) {
                    <tr class="pf-og__link" (click)="openTest(l)">
                      <td><span class="pf-og__tcode">{{ l.testCode || '—' }}</span> {{ l.testName }}</td>
                      <td>{{ l.paramTitle }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .pf-og { display: flex; flex-direction: column; gap: 10px; }
    .pf-og__bar { display: flex; align-items: center; gap: 12px; }
    .pf-og__search { flex: 0 1 340px; padding: 9px 12px; border-radius: 10px; font-size: 13px;
      color: var(--text-primary); background: var(--input-bg); border: 1px solid var(--input-border); outline: none; }
    .pf-og__search:focus { border-color: var(--input-border-focus); }
    .pf-og__count { font-size: 12px; font-weight: 600; color: var(--text-tertiary); }
    .pf-og__note { padding: 40px; text-align: center; font-size: 13px; color: var(--text-tertiary); }

    .pf-og__card { border: 1px solid var(--glass-border); border-radius: 14px; background: var(--glass-bg); overflow: hidden; }
    .pf-og__card--open { border-color: rgba(139,92,246,.4); }
    .pf-og__head { display: flex; align-items: center; gap: 14px; width: 100%; padding: 12px 16px;
      background: transparent; border: none; cursor: pointer; text-align: left; }
    .pf-og__titles { flex-shrink: 0; width: 200px; min-width: 0; }
    .pf-og__name { display: block; font-size: 13.5px; font-weight: 700; color: var(--text-primary);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pf-og__code { font-size: 10.5px; font-weight: 600; color: var(--text-tertiary); font-variant-numeric: tabular-nums; }
    .pf-og__chips { flex: 1; display: flex; flex-wrap: wrap; gap: 4px; min-width: 0; }
    .pf-og__chip { font-size: 11.5px; font-weight: 600; padding: 2px 9px; border-radius: 999px;
      color: var(--text-secondary); background: var(--glass-bg); border: 1px solid var(--glass-border); }
    .pf-og__chip--normal { color: #34d399; border-color: rgba(34,197,94,.45); background: rgba(34,197,94,.08); }
    .pf-og__chip--off { opacity: .45; text-decoration: line-through; }
    .pf-og__usage { flex-shrink: 0; font-size: 12px; font-weight: 600; color: var(--text-tertiary); white-space: nowrap; }
    .pf-og__chev { flex-shrink: 0; color: var(--text-tertiary); transition: transform .2s ease; }
    .pf-og__card--open .pf-og__chev { transform: rotate(180deg); }

    .pf-og__body { border-top: 1px solid var(--glass-border); padding: 14px 16px 16px; }
    .pf-og__act { display: flex; justify-content: flex-end; margin-bottom: 10px; }
    .pf-og__edit { padding: 6px 14px; border-radius: 9px; font-size: 12.5px; font-weight: 600; cursor: pointer;
      color: var(--violet-text, #a78bfa); background: rgba(124,58,237,.1); border: 1px solid rgba(124,58,237,.35); }

    .pf-og__editor { margin-bottom: 14px; }
    .pf-og__row { display: flex; align-items: center; gap: 10px; padding: 4px 0; }
    .pf-og__rowcode { flex-shrink: 0; width: 52px; font-size: 11px; font-weight: 600; color: var(--text-tertiary); font-variant-numeric: tabular-nums; }
    .pf-og__rowval { flex: 0 1 280px; padding: 7px 10px; border-radius: 8px; font-size: 13px;
      color: var(--text-primary); background: var(--input-bg); border: 1px solid var(--input-border); outline: none; }
    .pf-og__flag { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--text-secondary); }
    .pf-og__rowdel { flex-shrink: 0; width: 24px; height: 24px; border-radius: 50%; border: none; cursor: pointer;
      color: var(--text-tertiary); background: transparent; font-size: 15px; line-height: 1; }
    .pf-og__rowdel:hover { color: #ef4444; background: rgba(239,68,68,.12); }
    .pf-og__addrow { margin-top: 6px; padding: 5px 12px; border-radius: 999px; font-size: 12px; font-weight: 600; cursor: pointer;
      color: var(--text-secondary); background: transparent; border: 1px dashed var(--glass-border); }
    .pf-og__editact { display: flex; align-items: center; gap: 10px; margin-top: 12px; padding-top: 10px;
      border-top: 1px solid var(--glass-border); }
    .pf-og__warn { flex: 1; font-size: 11.5px; color: var(--text-tertiary); }
    .pf-og__ghost { padding: 7px 14px; border-radius: 9px; font-size: 12.5px; font-weight: 600; cursor: pointer;
      color: var(--text-secondary); background: var(--glass-bg); border: 1px solid var(--glass-border); }
    .pf-og__save { padding: 7px 16px; border-radius: 9px; font-size: 12.5px; font-weight: 700; color: #fff; cursor: pointer;
      background: var(--gradient-primary, linear-gradient(90deg,#a855f7,#ec4899)); border: 1px solid transparent; }
    .pf-og__save:disabled { opacity: .5; cursor: default; }

    .pf-og__links { width: 100%; border-collapse: collapse; }
    .pf-og__links th { text-align: left; font-size: 10.5px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase;
      color: var(--text-tertiary); padding: 6px 10px; border-bottom: 1px solid var(--glass-border); }
    .pf-og__link { cursor: pointer; }
    .pf-og__link:hover { background: rgba(124,58,237,.06); }
    .pf-og__link td { padding: 8px 10px; font-size: 12.5px; color: var(--text-secondary); border-bottom: 1px solid var(--glass-border); }
    .pf-og__link:last-child td { border-bottom: none; }
    .pf-og__tcode { font-weight: 700; color: var(--text-primary); font-variant-numeric: tabular-nums; margin-right: 6px; }
  `],
})
export class OptionGroupsPanelComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly toasts = inject(ToastService);

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly query = signal('');
  readonly groups = signal<OgGroup[]>([]);
  readonly expanded = signal<string | null>(null);
  readonly editing = signal<string | null>(null);
  readonly draft = signal<OgRow[]>([]);

  readonly filtered = computed(() => {
    const q = this.query().trim().toLowerCase();
    if (!q) return this.groups();
    return this.groups().filter(g =>
      g.name.toLowerCase().includes(q)
      || g.values.some(v => v.value.toLowerCase().includes(q))
      || g.links.some(l => l.testName.toLowerCase().includes(q)
        || (l.testCode ?? '').toLowerCase().includes(q)
        || l.paramTitle.toLowerCase().includes(q)));
  });

  ngOnInit() { this.load(); }

  testCount(g: OgGroup): number { return new Set(g.links.map(l => l.testId)).size; }

  toggle(code: string) {
    this.expanded.set(this.expanded() === code ? null : code);
    this.editing.set(null);
  }

  startEdit(g: OgGroup) {
    this.draft.set(g.values.map(v => ({ ...v })));
    this.editing.set(g.code);
  }
  patchRow(ix: number, patch: Partial<OgRow>) {
    this.draft.update(rows => rows.map((r, i) => i === ix ? { ...r, ...patch } : r));
  }
  removeRow(ix: number) { this.draft.update(rows => rows.filter((_, i) => i !== ix)); }
  addRow() { this.draft.update(rows => [...rows, { code: null, value: '', normal: false, active: true }]); }
  draftValid(): boolean { return this.draft().some(r => r.value.trim().length > 0); }

  save(g: OgGroup) {
    this.saving.set(true);
    this.api.put<{ updatedTests: number }>(`/api/option-groups/${g.code}`, {
      values: this.draft().filter(r => r.value.trim()),
    }).subscribe({
      next: res => {
        this.saving.set(false);
        this.editing.set(null);
        this.toasts.success(`Option group updated across ${res.updatedTests} test${res.updatedTests === 1 ? '' : 's'}`);
        this.load();
      },
      error: () => { this.saving.set(false); this.toasts.error('Could not update the option group'); },
    });
  }

  openTest(l: OgLink) {
    this.router.navigate(['/admin/tests', l.testId, 'edit']);
  }

  private load() {
    this.loading.set(true);
    this.api.get<OgGroup[]>('/api/option-groups').subscribe({
      next: gs => { this.groups.set(gs ?? []); this.loading.set(false); },
      error: () => { this.loading.set(false); this.toasts.error('Could not load option groups'); },
    });
  }
}
