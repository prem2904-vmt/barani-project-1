import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { ID_DEFAULTS, IdFormatConfig, IdScope, idPreview, padCap } from '../id-format';
import { SettingAdapter, WholeObjectStore } from './adapter';

class IdStore extends WholeObjectStore<IdFormatConfig> {
  constructor(private readonly api: ApiService, private readonly scope: IdScope) { super(); }
  protected fetch(): Observable<IdFormatConfig> { return this.api.get<IdFormatConfig>(`/api/config/${this.scope}-id`); }
  protected save(c: IdFormatConfig): Observable<unknown> {
    const alpha = c.serialMode === 'alpha';
    return this.api.post(`/api/config/${this.scope}-id`, {
      enabled: this.scope === 'patient' ? !!c.enabled : true,
      datePrefix: c.datePrefix,
      separator: c.separator ?? '',
      padding: padCap(c.padding, alpha),
      ...(this.scope === 'patient' ? { prefix: (c.prefix ?? '').trim() || null } : {}),
      serialMode: alpha ? 'alpha' : 'numeric',
      letterCount: Math.min(Math.max(c.letterCount ?? 2, 1), 4),
    });
  }
  protected defaults(): IdFormatConfig { return { ...ID_DEFAULTS[this.scope] }; }
}

/**
 * Patient / tube / order number formats (/api/config/{scope}-id, whole
 * object). Keys are `<scope>.<field>`; `<scope>.letters` is the "Letters"
 * switch (serialMode alpha) and `<scope>.preview` the "Looks like" text.
 * Only NEW numbers change — the rows ask before the editor opens.
 */
@Injectable({ providedIn: 'root' })
export class IdFormatAdapter implements SettingAdapter {
  private readonly api = inject(ApiService);
  private readonly stores: Record<IdScope, IdStore> = {
    patient: new IdStore(this.api, 'patient'),
    sample: new IdStore(this.api, 'sample'),
    order: new IdStore(this.api, 'order'),
  };

  private split(key: string): [IdScope, string] {
    const [scope, field] = key.split('.') as [IdScope, string];
    return [scope, field ?? ''];
  }

  ensure(): void { for (const s of Object.values(this.stores)) s.ensure(null); }
  loaded(): boolean { return Object.values(this.stores).every((s) => s.loaded(null)); }

  read(key: string): unknown {
    const [scope, field] = this.split(key);
    const c = { ...ID_DEFAULTS[scope], ...this.stores[scope].obj(null) } as IdFormatConfig;
    if (field === 'preview') return idPreview(scope, c);
    if (field === 'letters') return c.serialMode === 'alpha';
    if (field === 'enabled') return !!c.enabled;
    return (c as Record<string, unknown>)[field] ?? '';
  }

  write(key: string, value: unknown): Promise<void> {
    const [scope, field] = this.split(key);
    let patch: Partial<IdFormatConfig>;
    if (field === 'letters') patch = { serialMode: value === true ? 'alpha' : 'numeric' };
    else if (field === 'padding') {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 1) return Promise.reject(new Error('Use at least 1 digit.'));
      patch = { padding: n };
    } else patch = { [field]: value } as Partial<IdFormatConfig>;
    return this.stores[scope].mutate(null, (o) => ({ ...ID_DEFAULTS[scope], ...o, ...patch }));
  }
}
