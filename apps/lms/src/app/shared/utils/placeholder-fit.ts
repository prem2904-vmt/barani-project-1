/**
 * Band search placeholders fit their field (owner 2026-11-21: "Search pa…" was clipped on a 390px phone).
 * The placeholder a screen writes stays the full sentence; on a narrow field the band shows the longest SHORTER form
 * that fits — the part before the first " · " / " — " / " - " / ", " / "…", then the first two words, then "Search".
 * Pure (the measure is passed in) so it is unit-tested; `pf-hero-band` applies it to every input in its search.
 */
export function placeholderCandidates(full: string): string[] {
  const f = (full ?? '').trim();
  if (!f) return [''];
  const out: string[] = [f];
  const cut = f.split(/\s[·—–-]\s|,\s|…|\(/)[0].trim();
  if (cut && cut !== f) out.push(cut);
  const words = f.replace(/[·—–,…(].*$/, '').trim().split(/\s+/);
  if (words.length > 2) out.push(words.slice(0, 2).join(' '));
  const first = words[0] || 'Search';
  if (!out.includes(first)) out.push(first);
  return out;
}

export function fitPlaceholder(full: string, room: number, measure: (s: string) => number): string {
  const c = placeholderCandidates(full);
  if (!(room > 0)) return c[0];
  return c.find((s) => measure(s) <= room) ?? c[c.length - 1];
}

/** Fit every `input[placeholder]` inside `root` (the full text is kept in `data-ph-full`). */
export function fitPlaceholdersIn(root: ParentNode | null | undefined): void {
  if (!root || typeof document === 'undefined') return;
  const canvas = (fitPlaceholdersIn as unknown as { c?: HTMLCanvasElement }).c ??= document.createElement('canvas');
  const ctx = canvas.getContext?.('2d');
  root.querySelectorAll<HTMLInputElement>('input[placeholder]').forEach((el) => {
    const attr = el.getAttribute('placeholder') ?? '';
    const known = el.dataset['phFull'];
    // A screen changed its placeholder (it is not one of our short forms): that is the new full text.
    const full = known && placeholderCandidates(known).includes(attr) ? known : attr;
    el.dataset['phFull'] = full;
    const cs = getComputedStyle(el);
    const room = el.clientWidth - parseFloat(cs.paddingLeft || '0') - parseFloat(cs.paddingRight || '0') - 2;
    if (!ctx || room <= 0) return;
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const next = fitPlaceholder(full, room, (s) => ctx.measureText(s).width);
    if (next !== attr) el.setAttribute('placeholder', next);
    if (!el.getAttribute('aria-label') && !el.labels?.length) el.setAttribute('aria-label', full);
  });
}
