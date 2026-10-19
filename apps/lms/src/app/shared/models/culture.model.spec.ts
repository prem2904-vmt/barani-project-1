import { panelForSpecimen, ANTIBIOTIC_PANELS, COMMON_ORGANISMS } from './culture.model';

describe('panelForSpecimen', () => {
  it('returns the default panel for unknown/falsy specimens', () => {
    expect(panelForSpecimen(undefined)).toEqual(ANTIBIOTIC_PANELS['default']);
    expect(panelForSpecimen('')).toEqual(ANTIBIOTIC_PANELS['default']);
    expect(panelForSpecimen('  ')).toEqual(ANTIBIOTIC_PANELS['default']);
    expect(panelForSpecimen('unknown-specimen-type')).toEqual(ANTIBIOTIC_PANELS['default']);
  });

  it('matches specimens case-insensitively', () => {
    expect(panelForSpecimen('URINE')).toEqual(ANTIBIOTIC_PANELS['urine']);
    expect(panelForSpecimen('UriNe')).toEqual(ANTIBIOTIC_PANELS['urine']);
    expect(panelForSpecimen('BLOOD')).toEqual(ANTIBIOTIC_PANELS['blood']);
    expect(panelForSpecimen('Pus')).toEqual(ANTIBIOTIC_PANELS['pus']);
  });

  it('trims whitespace from specimen names', () => {
    expect(panelForSpecimen('  urine  ')).toEqual(ANTIBIOTIC_PANELS['urine']);
    expect(panelForSpecimen('\tsputum\n')).toEqual(ANTIBIOTIC_PANELS['sputum']);
    expect(panelForSpecimen('  BLOOD  ')).toEqual(ANTIBIOTIC_PANELS['blood']);
  });

  it('returns urine panel with additional urinary antibiotics', () => {
    const urinePanel = panelForSpecimen('urine');
    expect(urinePanel).toContain('Nitrofurantoin');
    expect(urinePanel).toContain('Norfloxacin');
    expect(urinePanel).toContain('Fosfomycin');
    expect(urinePanel).toContain('Amikacin'); // from GRAM_NEG base
  });

  it('returns blood panel combining gram-negative and gram-positive', () => {
    const bloodPanel = panelForSpecimen('blood');
    // Should have gram-negative antibiotics
    expect(bloodPanel).toContain('Amikacin');
    expect(bloodPanel).toContain('Ciprofloxacin');
    // Should have gram-positive antibiotics
    expect(bloodPanel).toContain('Penicillin');
    expect(bloodPanel).toContain('Vancomycin');
    // Should not have duplicates (Set deduplication applied)
    expect(bloodPanel.filter((a) => a === 'Ciprofloxacin')).toHaveLength(1);
  });

  it('returns pus panel with both gram families', () => {
    const pusPanel = panelForSpecimen('pus');
    expect(pusPanel).toContain('Amikacin');
    expect(pusPanel).toContain('Penicillin');
    expect(pusPanel).toContain('Vancomycin');
  });

  it('returns wound-swab panel with both gram families', () => {
    const woundPanel = panelForSpecimen('wound swab');
    expect(woundPanel).toContain('Amikacin');
    expect(woundPanel).toContain('Ceftriaxone');
    expect(woundPanel).toContain('Penicillin');
  });

  it('returns sputum panel with respiratory fluoroquinolones', () => {
    const sputumPanel = panelForSpecimen('sputum');
    expect(sputumPanel).toContain('Levofloxacin');
    expect(sputumPanel).toContain('Azithromycin');
    expect(sputumPanel).toContain('Cefotaxime'); // from GRAM_NEG base
  });

  it('returns stool panel with enteric antibiotics', () => {
    const stoolPanel = panelForSpecimen('stool');
    expect(stoolPanel).toContain('Ampicillin');
    expect(stoolPanel).toContain('Ciprofloxacin');
    expect(stoolPanel).toContain('Azithromycin');
    // Stool does not include all GRAM_NEG (it's a custom subset)
    expect(stoolPanel).not.toContain('Amikacin');
  });

  it('returns arrays of strings, never null', () => {
    expect(Array.isArray(panelForSpecimen('blood'))).toBe(true);
    expect(Array.isArray(panelForSpecimen(undefined))).toBe(true);
    expect(Array.isArray(panelForSpecimen('nonexistent'))).toBe(true);
  });
});

describe('COMMON_ORGANISMS', () => {
  it('is a non-empty array of strings', () => {
    expect(Array.isArray(COMMON_ORGANISMS)).toBe(true);
    expect(COMMON_ORGANISMS.length).toBeGreaterThan(0);
    expect(COMMON_ORGANISMS.every((org) => typeof org === 'string')).toBe(true);
  });

  it('includes major gram-negative pathogens', () => {
    expect(COMMON_ORGANISMS).toContain('Escherichia coli');
    expect(COMMON_ORGANISMS).toContain('Klebsiella pneumoniae');
    expect(COMMON_ORGANISMS).toContain('Pseudomonas aeruginosa');
  });

  it('includes major gram-positive pathogens', () => {
    expect(COMMON_ORGANISMS).toContain('Staphylococcus aureus (MSSA)');
    expect(COMMON_ORGANISMS).toContain('Staphylococcus aureus (MRSA)');
    expect(COMMON_ORGANISMS).toContain('Streptococcus pneumoniae');
  });

  it('includes fungal isolates', () => {
    expect(COMMON_ORGANISMS).toContain('Candida albicans');
    expect(COMMON_ORGANISMS).toContain('Candida tropicalis');
  });

  it('includes negative control marker', () => {
    expect(COMMON_ORGANISMS).toContain('No growth');
  });
});
