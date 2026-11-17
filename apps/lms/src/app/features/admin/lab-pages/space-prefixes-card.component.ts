import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { ApiService } from '../../../core/services/api.service';
import { Branch } from '../../../shared/models/tenant.model';
import { SkeletonRowsComponent } from '../../../shared/primitives/skeleton-kit.component';
import { LAB_SPACES_PATH } from '../../../shared/utils/lab-settings-pages';

interface LabSpace { id: string; branchId: string; name: string; code?: string | null; order: number; }

export interface PrefixRow { key: string; name: string; code: string; isDefault: boolean; }
export interface BranchPrefixes { branchId: string; branchName: string; rows: PrefixRow[]; }

/** "LAB" is the prefix of the default lab space when its code is blank. */
export const DEFAULT_LAB_PREFIX = 'LAB';

/** Group each branch's default Lab + its named spaces with the prefix they print. */
export function buildBranchPrefixes(branches: readonly Branch[], spaces: readonly LabSpace[]): BranchPrefixes[] {
  return branches
    .filter(b => (b as { isActive?: boolean }).isActive !== false)
    .map(b => ({
      branchId: b.id,
      branchName: b.name,
      rows: [
        { key: `${b.id}:default`, name: 'Lab (default space)', code: (b.defaultLabCode ?? '').trim().toUpperCase() || DEFAULT_LAB_PREFIX, isDefault: true },
        ...spaces
          .filter(s => s.branchId === b.id)
          .sort((x, y) => x.order - y.order)
          .map(s => ({ key: s.id, name: s.name, code: (s.code ?? '').trim().toUpperCase(), isDefault: false })),
      ],
    }));
}

/**
 * Prefix per lab space — read-only here. A tube's sample ID starts with its
 * lab space's code; the codes are edited on the Departments and lab spaces
 * page (one home), this lists what each branch's spaces print today.
 */
@Component({
  selector: 'pf-space-prefixes-card',
  standalone: true,
  imports: [RouterLink, SkeletonRowsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-card pf-sp" data-testid="space-prefixes">
      <div class="pf-card__head">
        <span class="pf-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/></svg></span>
        <h3 class="pf-card__label pf-sp__title">Prefix per lab space</h3>
        <span class="pf-sp__scope">Each branch</span>
      </div>
      <div class="pf-sp__body">
        <p class="pf-sp__hint">
          A sample ID starts with its lab space's code. Departments with no space of their own share the default <strong>Lab</strong> code
          (leave it blank for <span class="pf-num">{{ defaultPrefix }}</span>). Codes are set where the lab spaces are.
        </p>
        @if (loading()) {
          <pf-skeleton-rows [rows]="3" [avatar]="false" label="Loading lab spaces…"></pf-skeleton-rows>
        } @else {
          @for (b of groups(); track b.branchId) {
            <div class="pf-sp__branch" data-testid="space-branch">
              <p class="pf-sp__bname">{{ b.branchName }}</p>
              <ul class="pf-sp__list" role="list">
                @for (r of b.rows; track r.key) {
                  <li class="pf-sp__row">
                    <span class="pf-sp__name">{{ r.name }}</span>
                    @if (r.code) { <span class="pf-chip pf-chip--static pf-num" data-testid="space-code">{{ r.code }}</span> }
                    @else { <span class="pf-sp__none">No prefix — uses the department code</span> }
                  </li>
                }
              </ul>
            </div>
          } @empty {
            <p class="pf-sp__hint">No branches yet.</p>
          }
        }
        <a class="pf-btn pf-btn--secondary pf-sp__link" [routerLink]="spacesPath" data-testid="space-prefixes-link">Edit lab spaces and codes</a>
      </div>
    </section>
  `,
  styles: [`
    :host { display: block; }
    .pf-sp { margin-bottom: 16px; overflow: visible; }
    .pf-sp__title { margin: 0; font-size: 13px; }
    .pf-sp__scope { margin-left: 8px; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--pf-line); background: var(--pf-chip-bg); font-size: 11px; font-weight: 600; color: var(--text-secondary); white-space: nowrap; }
    .pf-sp__body { display: flex; flex-direction: column; gap: 14px; padding: 14px 18px 18px; }
    .pf-sp__hint { margin: 0; font-size: 12.5px; color: var(--text-tertiary); line-height: 1.55; }
    .pf-sp__branch { border: 1px solid var(--pf-line); border-radius: var(--pf-radius); background: var(--pf-card-bg); padding: 10px 14px; }
    .pf-sp__bname { margin: 0 0 6px; font-size: 13.5px; font-weight: 600; color: var(--text-primary); }
    .pf-sp__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
    .pf-sp__row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 7px 0; border-top: 1px solid var(--pf-line); }
    .pf-sp__row:first-child { border-top: 0; }
    .pf-sp__name { font-size: 13px; color: var(--text-secondary); min-width: 0; overflow-wrap: anywhere; }
    .pf-sp__none { font-size: 12px; color: var(--text-tertiary); font-style: italic; }
    .pf-sp__link { align-self: flex-start; min-height: 40px; }
  `],
})
export class SpacePrefixesCardComponent implements OnInit {
  private readonly api = inject(ApiService);
  protected readonly spacesPath = LAB_SPACES_PATH;
  protected readonly defaultPrefix = DEFAULT_LAB_PREFIX;
  private readonly _branches = signal<Branch[]>([]);
  private readonly _spaces = signal<LabSpace[]>([]);
  readonly loading = signal(true);
  readonly groups = computed(() => buildBranchPrefixes(this._branches(), this._spaces()));

  ngOnInit() {
    forkJoin({
      branches: this.api.get<Branch[]>('/api/tenants/branches').pipe(catchError(() => of([] as Branch[]))),
      spaces: this.api.get<LabSpace[]>('/api/tenants/lab-spaces').pipe(catchError(() => of([] as LabSpace[]))),
    }).subscribe(({ branches, spaces }) => {
      this._branches.set(branches ?? []);
      this._spaces.set(spaces ?? []);
      this.loading.set(false);
    });
  }
}
