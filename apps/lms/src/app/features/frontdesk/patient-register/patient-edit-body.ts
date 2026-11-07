/** OPS-72: editing a patient PATCHes only the keys present, so a field the
 *  desk EMPTIED used to vanish from the body (empty values are dropped) and
 *  the server kept the old value. For the two identity numbers that live on
 *  the profile (ABHA, Aadhaar last-4) an emptied field is sent as an explicit
 *  "" — the server reads null/absent as "unchanged" and "" as "cleared".
 *  Only fields the registration form actually carries are touched. */
const CLEARABLE: ReadonlyArray<[storageKey: string, bodyKey: string]> = [
  ['abha_id', 'abhaId'],
  ['aadhaar_last4', 'aadhaarLast4'],
];

export function withClearedIdentifiers(
  body: Record<string, unknown>,
  standard: Record<string, unknown>,
  formStorageKeys: Iterable<string>,
): Record<string, unknown> {
  const onForm = new Set(formStorageKeys);
  const out = { ...body };
  for (const [sk, bk] of CLEARABLE) {
    if (!onForm.has(sk)) continue;
    const v = standard[sk];
    if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) out[bk] = '';
  }
  return out;
}
