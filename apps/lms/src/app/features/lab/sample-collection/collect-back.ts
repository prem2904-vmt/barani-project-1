/**
 * Where the collect QUEUE's back chevron returns to. An explicit `?from=/…`
 * wins (the work area that opened it); /lab/collect otherwise returns to the
 * Lab (its tree parent); the dedicated /sample-collection page has no back.
 */
export function listBackTarget(routePath: string, from: string | null): string | null {
  if (from && from.startsWith('/') && !from.startsWith('//')) return from;
  return routePath.replace(/\/+$/, '') === '/lab/collect' ? '/lab/my-work' : null;
}
