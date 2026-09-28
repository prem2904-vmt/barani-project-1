/**
 * Patient registration — NEW DESIGN styles (ND-PATTERN §15: one single
 * form, no tabs, keyboard-first). Everything is scoped under `.pf-reg`,
 * which only renders in the new design, so the classic page is untouched.
 * The section cards themselves (3 / 2 / 1 columns, card-body scroll) are
 * laid out by pf-workflow-renderer's nd mode; this file only makes the
 * form fill the band body at ≥1200px (no page scroll) and handles phones.
 */
export const PATIENT_REGISTER_ND_STYLES = `
  /* The pill (standard band-pill size via pf-hero-band [standardPill]):
     the name ✎ on the left, the ABHA helpers pushed to the right. */
  .pf-reg-ctx.nd-ctx { flex-wrap: nowrap; gap: 12px; padding: 2px 0; }
  .pf-reg-ctx__name { flex: 1 1 auto; min-width: 0; }
  .pf-reg-ctx__nametext { min-width: 0; }
  .pf-reg-ctx__abha { flex: none; display: inline-flex; align-items: center; gap: 6px; margin-left: auto; }

  .pf-reg-savestate__t { white-space: nowrap; }

  .pf-reg-form { display: block; }
  /* Desktop: the cards sit side by side and FILL the body — only a card
     body scrolls if a tenant adds more fields; the page never does. */
  @media (min-width: 1200px) {
    .pf-reg-body { display: flex; flex-direction: column; overflow: hidden; }
    .pf-reg-form { flex: 1 1 auto; min-height: 0; }
  }

  /* Tablets — pf-workflow-renderer's TWO-column tier (768–1199px; phones
     are 1 column below 768, desktop 3 columns from 1200): Patient identity
     holds the left column; Contact & IDs sits top-right with Additional
     details directly under it, so the right column isn't left empty.
     Placement only (no markup moved): DOM, focus and Enter order stay
     identity → contact → additional. Row 2 is 1fr so a taller identity
     card leaves its slack BELOW Additional details, never between cards. */
  @media (min-width: 768px) and (max-width: 1199px) {
    .pf-reg-form ::ng-deep .pf-wr-cards:has(> [data-step$="__identity"]) { grid-template-rows: auto 1fr; }
    .pf-reg-form ::ng-deep .pf-wr-cards > [data-step$="__identity"] { grid-column: 1; grid-row: 1 / span 2; }
    .pf-reg-form ::ng-deep .pf-wr-cards > [data-step$="__contact"] { grid-column: 2; grid-row: 1; }
  }

  /* Title pills (7 since "Baby of", 2026-09-28): tighter pills so the whole
     set stays ONE row in the 3-column desktop card; 44px tap targets on
     touch (iPad / phones). */
  .pf-reg-form ::ng-deep [data-field="title"] .pf-di-seg .nd-seg__item { min-width: 44px; padding: 0 10px; white-space: nowrap; }
  @media (pointer: coarse) {
    .pf-reg-form ::ng-deep [data-field="title"] .pf-di-seg .nd-seg__item { min-height: 44px; }
  }
  /* A card too narrow for one row (iPad portrait, phones): balanced rows of
     four (4 + 3) instead of a lone "Baby of" on row two. */
  .pf-reg-form ::ng-deep [data-field="title"] { container-type: inline-size; }
  @container (max-width: 460px) {
    .pf-reg-form ::ng-deep [data-field="title"] .pf-di-seg:not(.pf-di-seg--fill) { display: grid; grid-template-columns: repeat(4, 1fr); width: 100%; }
  }

  /* Phones: one column that scrolls naturally under the pinned band;
     Cancel goes (the back chevron is the same move); the save state keeps
     only its mark; the band's actions are 44px icons (pf-hero-band). */
  @media (max-width: 640px) {
    .pf-reg-cancel { display: none !important; }
    /* The pill stays one row: the name wraps, the ABHA helpers are icons. */
    .pf-reg-ctx.nd-ctx { overflow: visible; }
    .pf-reg-ctx__name { max-width: none; flex: 1 1 auto; }
    .pf-reg-abha__t { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
    .pf-reg-ctx__abha .nd-btn--quiet { width: 40px; padding: 0; }
    .pf-reg-savestate__t { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  }
`;
