import { SettingGroupComponent, SettingRowComponent } from '../../../shared/components/setting-row/setting-row.component';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { ApiService } from '../../../core/services/api.service';
import { Branch } from '../../../shared/models/tenant.model';
import { SkeletonRowsComponent } from '../../../shared/primitives/skeleton-kit.component';
import { LAB_SPACES_PATH, LAB_SPACES_QUERY } from '../../../shared/utils/lab-settings-pages';

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
  imports: [SettingRowComponent, SettingGroupComponent, RouterLink, SkeletonRowsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <pf-setting-group class="pf-sp" data-testid="space-prefixes" id="prefixes" label="Prefixes" scope="per branch"
                      [hint]="'A sample ID starts with its lab space code; departments without a space share the default Lab code (blank = ' + defaultPrefix + ').'">
      <a group-tools class="pf-sp__link" [routerLink]="spacesPath" [queryParams]="spacesQuery" data-testid="space-prefixes-link">Edit lab spaces</a>
      @if (loading()) {
        <pf-skeleton-rows [rows]="2" [avatar]="false" label="Loading lab spaces…"></pf-skeleton-rows>
      } @else {
        @for (b of groups(); track b.branchId) {
          <pf-setting-row class="pf-sp__branch" data-testid="space-branch" [label]="b.branchName">
            <ul class="pf-sp__list" role="list">
              @for (r of b.rows; track r.key) {
                <li class="pf-sp__row">
                  <span class="pf-sp__name">{{ r.name }}</span>
                  @if (r.code) { <span class="pf-sp__code pf-num" data-testid="space-code">{{ r.code }}</span> }
                  @else { <span class="pf-sp__code pf-sp__code--none" title="Uses the department code">—</span> }
                </li>
              }
            </ul>
          </pf-setting-row>
        } @empty {
          <pf-setting-row label="No branches yet"></pf-setting-row>
        }
      }
    </pf-setting-group>
  `,
  styles: [`
    :host { display: block; }
    .pf-sp__list { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
    .pf-sp__row { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 4px 0 10px; border: 1px solid var(--pf-line); border-radius: 8px; background: var(--pf-card-bg); }
    .pf-sp__name { font-size: 12.5px; color: var(--text-secondary); white-space: nowrap; }
    .pf-sp__code { min-width: 22px; text-align: center; font-size: 11.5px; font-weight: 600; padding: 1px 6px; border-radius: 6px; background: var(--pf-chip-bg); color: var(--text-primary); }
    .pf-sp__code--none { color: var(--text-tertiary); font-weight: 500; }
    .pf-sp__link { font-size: 12.5px; font-weight: 600; color: var(--violet-text, #7c3aed); text-decoration: underline; text-underline-offset: 3px; }
  `],
})
export class SpacePrefixesCardComponent implements OnInit {
  private readonly api = inject(ApiService);
  protected readonly spacesPath = LAB_SPACES_PATH;
  protected readonly spacesQuery = LAB_SPACES_QUERY;
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
