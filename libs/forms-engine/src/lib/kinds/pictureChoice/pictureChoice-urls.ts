import { Signal, effect, inject, signal } from '@angular/core';
import { FieldDef } from '../../core/types';
import { FE_ASSETS } from '../../fill/contract';
import { pictureChoiceConfig } from './pictureChoice-model';

/**
 * The showable URLs of a pictureChoice question's pictures (every part's `asset`, and the box's background), by asset
 * id. The host fetches the bytes with the session (no signed links); each id is asked for once. Call in an
 * injection context.
 */
export function pictureUrls(field: () => FieldDef): Signal<Record<string, string>> {
  const assets = inject(FE_ASSETS);
  const urls = signal<Record<string, string>>({});
  const asked = new Set<string>();
  effect(() => {
    const f = field();
    const ids = [...(f.options ?? []).map((o) => o.asset), pictureChoiceConfig(f).background].filter((x): x is string => !!x);
    for (const id of ids) {
      if (asked.has(id) || !assets) continue;
      asked.add(id);
      assets
        .asset(id)
        .then((a) => urls.update((u) => ({ ...u, [id]: a.url })))
        .catch(() => asked.delete(id));
    }
  });
  return urls.asReadonly();
}
