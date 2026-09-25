/**
 * Patient registration — NEW DESIGN styles (ND-PATTERN §15: one single
 * form, no tabs, keyboard-first). Everything is scoped under `.pf-reg`,
 * which only renders in the new design, so the classic page is untouched.
 * The section cards themselves (3 / 2 / 1 columns, card-body scroll) are
 * laid out by pf-workflow-renderer's nd mode; this file only makes the
 * form fill the band body at ≥1200px (no page scroll) and handles phones.
 */
export const PATIENT_REGISTER_ND_STYLES = `
  /* The pill: the patient's name, nothing else. */
  .pf-reg-ctx.nd-ctx { flex-wrap: nowrap; padding: 2px 0; }
  .pf-reg-ctx__name { flex: 0 1 auto; min-width: 0; }
  .pf-reg-ctx__nametext { min-width: 0; }

  .pf-reg-savestate__t { white-space: nowrap; }

  .pf-reg-form { display: block; }
  /* Desktop: the cards sit side by side and FILL the body — only a card
     body scrolls if a tenant adds more fields; the page never does. */
  @media (min-width: 1200px) {
    .pf-reg-body { display: flex; flex-direction: column; overflow: hidden; }
    .pf-reg-form { flex: 1 1 auto; min-height: 0; }
  }

  /* Phones: one column that scrolls naturally under the pinned band;
     Cancel goes (the back chevron is the same move); the save state keeps
     only its mark; the band's actions are 44px icons (pf-hero-band). */
  @media (max-width: 640px) {
    .pf-reg-cancel { display: none !important; }
    .pf-reg-savestate__t { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  }
`;
