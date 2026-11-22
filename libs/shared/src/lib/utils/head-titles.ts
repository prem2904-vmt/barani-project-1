/**
 * Card heads (owner 2026-11-21): on a narrow head a text action becomes a 44px icon button (CSS, styles.scss
 * `@container pf-head`), so every head action needs a tooltip. `fillHeadTitles` gives each button / link in `root`
 * that has none a `title` (kept in step while its words change: marked `data-head-title`) from its aria-label, else its own words. It never replaces a title a screen set, and it
 * skips elements with a positioned tooltip (`data-tip`). Pure DOM, no framework: called after render.
 */
export function headTitleOf(el: Element): string {
  const aria = el.getAttribute('aria-label')?.trim();
  if (aria) return aria;
  return (el.textContent ?? '').replace(/\s+/g, ' ').trim();
}

export function fillHeadTitles(root: ParentNode | null | undefined): number {
  if (!root) return 0;
  let n = 0;
  root.querySelectorAll<HTMLElement>('button, a[href], [role="button"]').forEach((el) => {
    if (el.hasAttribute('data-tip')) return;
    const ours = el.hasAttribute('data-head-title');
    if (el.hasAttribute('title') && !ours) return;   // a screen's own title wins
    const t = headTitleOf(el);
    if (!t) return;
    if (el.getAttribute('title') !== t) { el.setAttribute('title', t); el.setAttribute('data-head-title', ''); n++; }
  });
  return n;
}
