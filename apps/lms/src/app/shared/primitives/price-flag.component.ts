/**
 * "Not offered here" tag for a test this tenant / branch doesn't offer
 * (Test Master grid rows). A plain DOM node so AG Grid cell renderers can
 * use it; styles live in the global stylesheet (`.pf-price-flag--off`).
 *
 * There is NO "not priced yet" marker any more (owner, 2026-09-26): a test
 * still at the ₹1 default shows just its price, "₹1".
 */
export function notOfferedElement(): HTMLElement {
  return flagElement('Not offered here');
}

/** "Inactive" tag for a Test Master row whose Active/Inactive switch is off
 *  (clone: the row is inactive; reference: not offered here) — same quiet
 *  pill, the switch's own word. */
export function inactiveElement(): HTMLElement {
  const tag = flagElement('Inactive');
  tag.classList.add('pf-price-flag--inactive');
  return tag;
}

function flagElement(label: string): HTMLElement {
  const tag = document.createElement('span');
  tag.className = 'pf-price-flag pf-price-flag--off';
  tag.innerHTML =
    '<svg class="pf-price-flag__icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
    + 'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/></svg>';
  const text = document.createElement('span');
  text.textContent = label;
  tag.appendChild(text);
  return tag;
}
