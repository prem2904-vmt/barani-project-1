import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { Department } from '../../../shared/models/tenant.model';
import { Role, User } from '../../../shared/models/user.model';
import { BranchCache, SettingAdapter, branchHeader } from './adapter';

interface AutoAssignRow {
  departmentId: string;
  assigneeUserIdsJson?: string | null;
  autoAssignRoleIdsJson?: string | null;
  validatorUserIdsJson?: string | null;
  validatorRoleIdsJson?: string | null;
}
interface Pools { assigneeUserIds: string[]; roleIds: string[]; validatorUserIds: string[]; validatorRoleIds: string[] }
interface BranchData { departments: Department[]; rows: AutoAssignRow[] }

/** Picker value prefixes: one list mixes people and roles (owner's merge of
 *  the People + Roles pickers). */
export const PERSON = 'u:';
export const ROLE = 'r:';

/**
 * Auto-assign pools per department (PUT /api/tenants/auto-assign-configs).
 * The PUT replaces the WHOLE row, so every write sends all four pools —
 * otherwise changing the technicians would wipe the validators (logic lifted
 * from the Lab settings page's `upsert`). Keys: `tech:<deptId>` and
 * `validator:<deptId>`; values are `u:<userId>` / `r:<roleId>` lists.
 */
@Injectable({ providedIn: 'root' })
export class AutoAssignAdapter implements SettingAdapter {
  private readonly api = inject(ApiService);
  private readonly cache = new BranchCache<BranchData>();
  private readonly _users = signal<User[]>([]);
  private readonly _roles = signal<Role[]>([]);
  private peopleRequested = false;

  /** People first, then roles ("any free person" in that role). */
  readonly options = computed(() => [
    ...this._users().map((u) => ({ value: PERSON + u.id, label: u.displayName || u.firstName || u.email })),
    ...this._roles().map((r) => ({ value: ROLE + r.id, label: `${r.name} · any free person` })),
  ]);

  ensure(branchId: string | null): void {
    if (!this.peopleRequested) {
      this.peopleRequested = true;
      this.api.get<User[]>('/api/users/').subscribe({ next: (l) => this._users.set((l ?? []).filter((u) => u.isActive !== false)), error: () => undefined });
      this.api.get<Role[]>('/api/roles/').subscribe({ next: (l) => this._roles.set(l ?? []), error: () => undefined });
    }
    this.loadBranch(branchId);
  }

  private readonly branchRequested = new Set<string>();
  private loadBranch(branchId: string | null): void {
    const k = branchId ?? '~';
    if (this.branchRequested.has(k)) return;
    this.branchRequested.add(k);
    const deptUrl = branchId ? `/api/tenants/departments?branchId=${branchId}` : '/api/tenants/departments';
    Promise.all([
      firstValueFrom(this.api.get<Department[]>(deptUrl, branchHeader(branchId))).catch(() => [] as Department[]),
      firstValueFrom(this.api.get<AutoAssignRow[]>('/api/tenants/auto-assign-configs', branchHeader(branchId))).catch(() => [] as AutoAssignRow[]),
    ]).then(([departments, rows]) => this.cache.set(branchId, {
      departments: (departments ?? []).filter((d) => d.isActive !== false), rows: rows ?? [],
    }));
  }

  loaded(branchId: string | null): boolean { return this.cache.get(branchId) !== null; }

  departments(branchId: string | null): Department[] { return this.cache.get(branchId)?.departments ?? []; }

  read(key: string, branchId: string | null): unknown {
    const [leg, deptId] = key.split(':');
    const p = this.pools(branchId, deptId);
    return leg === 'validator'
      ? [...p.validatorUserIds.map((id) => PERSON + id), ...p.validatorRoleIds.map((id) => ROLE + id)]
      : [...p.assigneeUserIds.map((id) => PERSON + id), ...p.roleIds.map((id) => ROLE + id)];
  }

  async write(key: string, value: unknown, branchId: string | null): Promise<void> {
    const [leg, deptId] = key.split(':');
    const picked = Array.isArray(value) ? value.map(String) : [];
    const users = picked.filter((v) => v.startsWith(PERSON)).map((v) => v.slice(PERSON.length));
    const roles = picked.filter((v) => v.startsWith(ROLE)).map((v) => v.slice(ROLE.length));
    const cur = this.pools(branchId, deptId);
    const body = {
      departmentId: deptId,
      assigneeUserIds: leg === 'tech' ? users : cur.assigneeUserIds,
      roleIds: leg === 'tech' ? roles : cur.roleIds,
      validatorUserIds: leg === 'validator' ? users : cur.validatorUserIds,
      validatorRoleIds: leg === 'validator' ? roles : cur.validatorRoleIds,
    };
    await firstValueFrom(this.api.put<unknown>('/api/tenants/auto-assign-configs', body, branchHeader(branchId)));
    const data = this.cache.get(branchId) ?? { departments: [], rows: [] };
    const row: AutoAssignRow = {
      departmentId: deptId,
      assigneeUserIdsJson: JSON.stringify(body.assigneeUserIds),
      autoAssignRoleIdsJson: JSON.stringify(body.roleIds),
      validatorUserIdsJson: JSON.stringify(body.validatorUserIds),
      validatorRoleIdsJson: JSON.stringify(body.validatorRoleIds),
    };
    const rows = data.rows.some((r) => r.departmentId === deptId)
      ? data.rows.map((r) => (r.departmentId === deptId ? { ...r, ...row } : r))
      : [...data.rows, row];
    this.cache.set(branchId, { ...data, rows });
  }

  private pools(branchId: string | null, deptId: string): Pools {
    const r = this.cache.get(branchId)?.rows.find((x) => x.departmentId === deptId);
    return {
      assigneeUserIds: ids(r?.assigneeUserIdsJson),
      roleIds: ids(r?.autoAssignRoleIdsJson),
      validatorUserIds: ids(r?.validatorUserIdsJson),
      validatorRoleIds: ids(r?.validatorRoleIdsJson),
    };
  }
}

function ids(json?: string | null): string[] {
  if (!json) return [];
  try { const v = JSON.parse(json); return Array.isArray(v) ? v.map(String) : []; }
  catch { return []; }
}
