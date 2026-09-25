/**
 * Patient registration — NEW DESIGN styles (ND-PATTERN §14 + "Patient
 * registration"). Everything is scoped under `.pf-reg`, which only renders
 * in the new design, so the classic page is untouched. Kit classes carry the
 * look (nd-card, nd-input, nd-seg, nd-rowact, nd-savestate); this file only
 * lays them out: the pill (name | sliding section tabs), one section card
 * that fills the body and scrolls inside, and the phone rules.
 */
export const PATIENT_REGISTER_ND_STYLES = `
  /* The pill: [name ✎] | [section tabs] — one line on web; narrower, the
     tabs scroll inside the pill; phones stack the name over the tabs. */
  .pf-reg-ctx.nd-ctx { flex-wrap: nowrap; gap: 12px; padding: 2px 0; overflow: visible; }
  .pf-reg-ctx__name { flex: 0 1 auto; min-width: 120px; max-width: 42%; }
  .pf-reg-ctx__nametext { min-width: 0; }
  .pf-reg-ctx__div { flex: none; width: 1px; align-self: stretch; margin: 4px 0; background: var(--nd-line); }
  .pf-reg-tabs {
    position: relative; flex: 0 1 auto; min-width: 0; display: flex; align-items: center; gap: 2px; padding: 3px;
    border-radius: 12px; background: var(--nd-chip-bg); border: 1px solid var(--nd-line);
    overflow-x: auto; overflow-y: hidden; scrollbar-width: none; -webkit-overflow-scrolling: touch;
  }
  .pf-reg-tabs::-webkit-scrollbar { display: none; }
  .pf-reg-tabs__ind {
    position: absolute; top: 3px; bottom: 3px; left: 0; z-index: 0; border-radius: 9px;
    background: var(--nd-card-bg); box-shadow: 0 1px 2px rgba(15, 23, 42, 0.18);
    transition: transform var(--nd-dur) var(--nd-spring), width var(--nd-dur) var(--nd-spring), opacity var(--nd-dur-fast) ease;
  }
  .pf-reg-tab {
    position: relative; z-index: 1; flex: 0 0 auto; display: inline-flex; align-items: center; gap: 7px;
    height: 34px; padding: 0 12px; border: 0; border-radius: 9px; background: transparent; color: var(--text-secondary);
    font: inherit; font-size: 13px; font-weight: 500; white-space: nowrap; cursor: pointer;
    transition: color var(--nd-dur-fast) ease;
  }
  .pf-reg-tab:hover { color: var(--text-primary); }
  .pf-reg-tab[aria-selected='true'] { color: var(--text-primary); font-weight: 600; }
  .pf-reg-tab:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: 1px; }
  /* Violet status dot: filled = complete, a ring = something to finish. */
  .pf-reg-tab__dot { flex: none; width: 7px; height: 7px; border-radius: 999px; border: 1.5px solid var(--nd-sel-border); background: transparent; }
  .pf-reg-tab__dot--ok { border-color: transparent; background: var(--color-violet-600, #7c3aed); }

  .pf-reg-savestate__t { white-space: nowrap; }

  /* One section card fills the body; only its body scrolls. */
  .pf-reg-body { gap: 12px; }
  .pf-reg-card { flex: 1 1 auto; min-height: 0; }
  .pf-reg-card__head { row-gap: 8px; }
  .pf-reg-card__note { display: inline-flex; align-items: center; gap: 6px; }
  .pf-reg-abha, .pf-reg-abha-new { flex: none; }
  .pf-reg-card__body { padding: 18px 18px 20px; gap: 16px; }
  .pf-reg-next { display: flex; justify-content: flex-end; margin-top: auto; padding-top: 4px; }
  .pf-reg-next__btn { display: inline-flex; align-items: center; gap: 6px; }

  @media (prefers-reduced-motion: reduce) {
    .pf-reg-tabs__ind, .pf-reg-tab { transition: none; }
  }

  /* Phones: name over a sideways-scrolling tabs row; Cancel goes (the back
     chevron is the same move); the save state keeps only its mark; the
     band's secondaries + primary are 44px icons (pf-hero-band). Fields are
     full width (the renderer's grid is one column below md). */
  @media (max-width: 640px) {
    .pf-reg-ctx.nd-ctx { flex-wrap: wrap; align-items: center; gap: 6px; padding: 8px 0 6px; overflow: visible; }
    .pf-reg-ctx__name { flex: 1 1 100%; max-width: none; min-width: 0; }
    .pf-reg-ctx__div { display: none; }
    .pf-reg-tabs { flex: 1 1 0; }
    .pf-reg-tab { height: 40px; }
    .pf-reg-cancel { display: none !important; }
    .pf-reg-savestate__t { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
    .pf-reg-card__body { padding: 14px 14px 18px; }
    /* Beat the global phone h2 cap (!important): the card label is 12px. */
    h2.nd-card__label.pf-reg-card__label { font-size: 12px !important; line-height: 1.3 !important; }
    .pf-reg-next__btn { width: 100%; justify-content: center; min-height: 44px; }
  }
`;
