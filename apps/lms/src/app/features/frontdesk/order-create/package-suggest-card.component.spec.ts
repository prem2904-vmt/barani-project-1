import { TestBed } from '@angular/core/testing';
import { PackageSuggestCardComponent } from './package-suggest-card.component';
import { suggestBundles, type PackageSuggestion, type SuggestCatalogItem } from './package-suggest';

/** The two suggestion cards (ND pattern): SAVING is the only struck-through
 *  price; UPGRADE is quiet ("+₹900.00 · adds 12 more tests …"), never struck,
 *  never a primary button; "What's included" ticks the tests in the cart. */
type Row = SuggestCatalogItem & { price: number };
const T = (id: string, price: number, extra: Partial<Row> = {}): Row =>
  ({ id, name: `Test ${id.toUpperCase()}`, type: 'individual', price, isActive: true, ...extra });
const items = (...ids: string[]) => JSON.stringify({ items: ids.map(testId => ({ testId })) });
const MEMBERS = [T('tsh', 100), T('cbc', 300), T('esr', 120), T('crp', 180), T('fbs', 80), T('hba1c', 250),
  T('chol', 150), T('tg', 150), T('crea', 120), T('urea', 100), T('sgpt', 100), T('sgot', 100), T('urine', 200)];
const CAT: Row[] = [...MEMBERS, T('mal', 150), T('widal', 150),
  T('fullbody', 1000, { name: 'Full Body Checkup', type: 'package', parameters: items(...MEMBERS.map(m => m.id)) }),
  T('fever', 499, { name: 'Fever Panel', type: 'package', parameters: items('cbc', 'esr', 'crp', 'mal', 'widal') })];
const unit = (t: Row) => ({ price: t.price, slab: 0 });
const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

function render(selected: string[]) {
  TestBed.configureTestingModule({ imports: [PackageSuggestCardComponent] });
  const f = TestBed.createComponent(PackageSuggestCardComponent);
  const list = suggestBundles(CAT, selected, unit);
  f.componentRef.setInput('suggestions', list);
  f.detectChanges();
  const emitted: PackageSuggestion[] = [];
  f.componentInstance.apply.subscribe(s => emitted.push(s));
  return { f, el: f.nativeElement as HTMLElement, list, emitted };
}

describe('PackageSuggestCard — UPGRADE (owner: ₹100 test, ₹1,000.00 package)', () => {
  it('reads as an upgrade: +₹900, adds tests worth individual amounts, no strike-through', () => {
    const { el } = render(['tsh']);
    const card = el.querySelector('.pf-psg__card')!;
    expect(card.getAttribute('data-kind')).toBe('upgrade');
    expect(text(card.querySelector('.pf-psg__name'))).toBe('Full Body Checkup');
    expect(text(card.querySelector('.pf-psg__kind'))).toBe('Package');
    expect(text(card)).toContain('+₹900.00');
    expect(el.querySelector('s, .pf-psg__was')).toBeNull();
    expect(text(card)).not.toMatch(/save/i);
  });

  it('is quiet: a text (tertiary) Upgrade button, never a primary', () => {
    const { el, emitted, list } = render(['tsh']);
    expect(el.querySelector('.pf-btn--primary')).toBeNull();
    const btn = el.querySelector('.pf-psg__act') as HTMLButtonElement;
    expect(btn.classList).toContain('pf-btn--tertiary');
    expect(btn.textContent!.trim()).toBe('Upgrade');
    expect(btn.getAttribute('aria-label')).toBe('Upgrade to Full Body Checkup for ₹900.00 more');
    btn.click();
    expect(emitted).toEqual([list[0]]);
  });

  afterEach(() => {
    document.getElementById('pf-overlay-host')?.remove();
  });

  it("test count accordion: opens menu to 13 tests, only TSH ticked and tagged In cart", () => {
    const { f, el } = render(['tsh']);
    const more = el.querySelector('.pf-psg__more') as HTMLButtonElement;
    expect(more.getAttribute('aria-expanded')).toBe('false');
    expect(text(more)).toContain('(13 tests)');
    const getMembers = () => el.querySelector('.pf-psg__members') ?? document.querySelector('.pf-psg__members');
    expect(getMembers()).toBeNull();
    more.click();
    f.detectChanges();
    expect(more.getAttribute('aria-expanded')).toBe('true');
    const membersEl = getMembers()!;
    const rows = membersEl.querySelectorAll('.pf-psg__m');
    expect(rows.length).toBe(13);
    const ticked = [...rows].filter(r => r.classList.contains('pf-psg__m--in'));
    expect(ticked.map(r => text(r.querySelector('.pf-psg__mname')))).toEqual(['Test TSH, in your cart']);
    expect(text(ticked[0])).toContain('In cart');
    expect(text(rows[1])).toContain('₹300.00');
    expect(membersEl.id).toBe(more.getAttribute('aria-controls'));
  });
});

describe('PackageSuggestCard — SAVING', () => {
  it('1-line with full package name, (x tests) accordion count, ~~₹600.00~~ ₹499.00 and Apply button', () => {
    const { el, emitted, list } = render(['cbc', 'esr', 'crp']);
    const [saving, upgrade] = [...el.querySelectorAll('.pf-psg__card')];
    expect(saving.getAttribute('data-kind')).toBe('saving');
    expect(text(saving.querySelector('.pf-psg__name'))).toBe('Fever Panel');
    expect(text(saving.querySelector('.pf-psg__kind'))).toBe('Package');
    expect(text(saving.querySelector('.pf-psg__more'))).toContain('(5 tests)');
    expect(text(saving.querySelector('s.pf-psg__was'))).toBe('₹600.00');
    expect(text(saving.querySelector('.pf-psg__now'))).toBe('₹499.00');
    const btn = saving.querySelector('.pf-psg__act') as HTMLButtonElement;
    expect(btn.classList).toContain('pf-btn--secondary');
    expect(btn.textContent!.trim()).toBe('Apply');
    btn.click();
    expect(emitted[0]).toBe(list[0]);
    // The upgrade after it still has no strike-through.
    expect(upgrade.getAttribute('data-kind')).toBe('upgrade');
    expect(upgrade.querySelector('s')).toBeNull();
    expect(text(upgrade)).toContain('+₹400.00');
    // Exactly one strike-through on screen — the saving's.
    expect(el.querySelectorAll('s').length).toBe(1);
  });

  it('names wrap (no truncation) and icons are SVG, not emoji', () => {
    const { el } = render(['cbc', 'esr', 'crp']);
    expect(el.querySelector('[title]')).toBeNull();
    expect(el.querySelectorAll('.pf-psg__icon svg').length).toBe(2);
    expect(el.textContent).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it('renders nothing when there is nothing honest to suggest', () => {
    const { el } = render(['mal']);
    // Fever Panel for Malaria (₹150): +₹349, 10%+ off its members (₹900.00) → upgrade shown;
    // with an empty list the section is absent.
    expect(el.querySelectorAll('.pf-psg__card').length).toBe(1);
    const f = TestBed.createComponent(PackageSuggestCardComponent);
    f.componentRef.setInput('suggestions', []);
    f.detectChanges();
    expect((f.nativeElement as HTMLElement).querySelector('.pf-psg')).toBeNull();
  });
});
