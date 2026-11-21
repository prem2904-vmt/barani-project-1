/**
 * Collect — the merge motion (owner-approved mock tube-pour-v1, "Pour" style). Web Animations only, on the
 * ghost tube (in <body>), a transient stream layer in <body>, and the cards. Every function resolves at once
 * under reduced motion (the same toasts follow). Timings are the mock's:
 *  - slide (not drawn): fly above the target 300 ms, slide down into it and vanish 380 ms (~680 ms);
 *  - pour (drawn): fly above + tip over 520 ms, the stream 240 ms while the target's liquid rises with a
 *    wobble 620 ms, the empty tube spins away 300 ms (~1.4 s);
 *  - fly back (dropped elsewhere / Keep apart) 280 ms;
 *  - fold the poured card away, then FLIP the others 320 ms; the kept card glows once; the chip pops.
 */
export const EASE = 'cubic-bezier(.2,.8,.2,1)';

/** Web Animations available (not in jsdom / very old engines)? Without it every motion is skipped. */
const can = (el: Element | null | undefined): el is HTMLElement => !!el && typeof (el as HTMLElement).animate === 'function';
const done = (a: Animation | null | undefined) => (a ? a.finished.then(() => undefined, () => undefined) : Promise.resolve());

function baseTransform(el: HTMLElement): string {
  const t = getComputedStyle(el).transform;
  return t && t !== 'none' ? t : '';
}

/** Offset (screen px) from the ghost's current box to "standing just above" the target's tube. */
function aboveTarget(ghost: HTMLElement, target: HTMLElement): { dx: number; dy: number; g: DOMRect; t: DOMRect } {
  const g = ghost.getBoundingClientRect();
  const tube = (target.querySelector('svg') as Element | null)?.getBoundingClientRect() ?? target.getBoundingClientRect();
  return { dx: tube.left + tube.width / 2 - (g.left + g.width / 2), dy: tube.top - 14 - g.bottom, g, t: tube };
}

/** The ghost glides back to its own card. */
export async function flyBack(ghost: HTMLElement | null, home: HTMLElement | null, reduced: boolean): Promise<void> {
  if (!can(ghost) || !home || reduced) return;
  const base = baseTransform(ghost);
  const g = ghost.getBoundingClientRect(), h = home.getBoundingClientRect();
  const dx = h.left + h.width / 2 - (g.left + g.width / 2), dy = h.top + h.height * 0.35 - (g.top + g.height / 2);
  await done(ghost.animate([{ transform: base, opacity: 1 }, { transform: `translate(${dx}px, ${dy}px) ${base} rotate(6deg)`, opacity: 0.4 }],
    { duration: 280, easing: EASE, fill: 'forwards' }));
}

/** While the inline "Different additive" question is open the ghost waits above the target. */
export async function hoverAbove(ghost: HTMLElement | null, target: HTMLElement | null, reduced: boolean): Promise<void> {
  if (!can(ghost) || !target) return;
  const base = baseTransform(ghost);
  const { dx, dy } = aboveTarget(ghost, target);
  await done(ghost.animate([{ transform: base }, { transform: `translate(${dx}px, ${dy}px) ${base} rotate(6deg)` }],
    { duration: reduced ? 0 : 250, easing: 'ease', fill: 'forwards' }));
}

/** Not drawn yet: the tube slides down into the target and is gone (~680 ms). */
export async function slideIn(ghost: HTMLElement | null, target: HTMLElement | null, reduced: boolean): Promise<void> {
  if (!can(ghost) || !target || reduced) return;
  const base = baseTransform(ghost);
  const { dx, dy, g } = aboveTarget(ghost, target);
  const above = `translate(${dx}px, ${dy}px) ${base} rotate(6deg)`;
  await done(ghost.animate([{ transform: base }, { transform: above }], { duration: 300, easing: 'cubic-bezier(.3,.7,.2,1)', fill: 'forwards' }));
  await done(ghost.animate([{ transform: above, opacity: 1 }, { transform: `translate(${dx}px, ${dy + g.height * 0.9}px) ${base} rotate(6deg) scale(.55,.35)`, opacity: 0 }],
    { duration: 380, easing: 'cubic-bezier(.6,0,.4,1)', fill: 'forwards' }));
}

/** Drawn: fly above, tip over, a stream pours in, the target's liquid wobbles up, the empty tube spins away (~1.4 s). */
export async function pourIn(ghost: HTMLElement | null, target: HTMLElement | null, liquid: string, reduced: boolean): Promise<void> {
  if (!can(ghost) || !target || reduced) return;
  const base = baseTransform(ghost);
  const { dx, dy, t } = aboveTarget(ghost, target);
  const tipped = `translate(${dx + 22}px, ${dy + 18}px) ${base} rotate(-112deg)`;
  await done(ghost.animate([
    { transform: base },
    { transform: `translate(${dx + 16}px, ${dy}px) ${base} rotate(6deg)`, offset: 0.55 },
    { transform: tipped },
  ], { duration: 520, easing: 'cubic-bezier(.3,.7,.2,1)', fill: 'forwards' }));

  // The stream: from the tipped tube's mouth to the target tube's opening.
  const ns = 'http://www.w3.org/2000/svg';
  const fx = document.createElementNS(ns, 'svg');
  fx.setAttribute('class', 'pf-pour-fx');
  fx.setAttribute('aria-hidden', 'true');
  fx.setAttribute('data-testid', 'pour-stream');
  Object.assign((fx as unknown as HTMLElement).style, { position: 'fixed', inset: '0', width: '100vw', height: '100vh', zIndex: '1105', pointerEvents: 'none', overflow: 'visible' });
  document.body.appendChild(fx);
  const gr = ghost.getBoundingClientRect();
  const mx = gr.left + 6, my = gr.top + gr.height * 0.45, tx = t.left + t.width / 2, ty = t.top + 10;
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', `M${mx} ${my} C ${mx - 4} ${my + 30}, ${tx} ${ty - 40}, ${tx} ${ty}`);
  path.setAttribute('stroke', liquid);
  path.setAttribute('stroke-width', '5');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke-linecap', 'round');
  fx.appendChild(path);
  const L = (path as SVGPathElement).getTotalLength?.() ?? 200;
  path.style.strokeDasharray = `${L}`;
  path.style.strokeDashoffset = `${L}`;
  void path.animate([{ strokeDashoffset: L }, { strokeDashoffset: 0 }], { duration: 240, easing: 'ease-in', fill: 'forwards' });
  target.classList.add('pf-tube--filling');
  await new Promise(r => setTimeout(r, 620));
  void done(path.animate([{ strokeDashoffset: 0, opacity: 1 }, { strokeDashoffset: -L, opacity: 0.2 }], { duration: 220, fill: 'forwards' }))
    .then(() => fx.remove());
  await done(ghost.animate([{ transform: tipped, opacity: 1 }, { transform: `translate(${dx + 36}px, ${dy}px) ${base} rotate(-150deg) scale(.2)`, opacity: 0 }],
    { duration: 300, easing: 'ease-in', fill: 'forwards' }));
  target.classList.remove('pf-tube--filling');
}

/** The poured card folds away (before the list drops it). */
export async function foldAway(card: HTMLElement | null, reduced: boolean): Promise<void> {
  if (!can(card) || reduced) return;
  await done(card.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(.86)' }], { duration: 180, easing: 'ease-in', fill: 'forwards' }));
}

/** Boxes of the cards before a list change (FLIP "first"). */
export function rectsOf(root: ParentNode | null | undefined, selector = '[data-pour-id]'): Map<string, DOMRect> {
  const m = new Map<string, DOMRect>();
  root?.querySelectorAll<HTMLElement>(selector).forEach(el => {
    const id = el.getAttribute('data-pour-id');
    if (id) m.set(id, el.getBoundingClientRect());
  });
  return m;
}

/** FLIP "play": every card that moved slides from its old box to the new one (320 ms). Returns the moved ids. */
export function flip(root: ParentNode | null | undefined, before: Map<string, DOMRect>, reduced: boolean, selector = '[data-pour-id]'): string[] {
  const moved: string[] = [];
  root?.querySelectorAll<HTMLElement>(selector).forEach(el => {
    const id = el.getAttribute('data-pour-id');
    const b = id ? before.get(id) : undefined;
    if (!id || !b) return;
    const a = el.getBoundingClientRect();
    const dx = b.left - a.left, dy = b.top - a.top;
    if (!dx && !dy) return;
    moved.push(id);
    if (!reduced && can(el)) el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 320, easing: EASE });
  });
  return moved;
}

/** A tube taken back out pops out of the kept one (460 ms). */
export function popOut(card: HTMLElement | null, from: HTMLElement | null, reduced: boolean): void {
  if (!can(card) || reduced) return;
  const c = card.getBoundingClientRect(), f = from?.getBoundingClientRect() ?? c;
  card.animate([{ transform: `translate(${f.left - c.left}px, ${f.top - c.top}px) scale(.3)`, opacity: 0 }, { transform: 'none', opacity: 1 }],
    { duration: 460, easing: 'cubic-bezier(.2,1.2,.4,1)' });
}
