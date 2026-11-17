import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TwoPanelComponent, TwoPanelGroup } from './two-panel.component';

const GROUPS: TwoPanelGroup[] = [
  { key: 'a', heading: 'ALPHA', items: [{ id: 'one', label: 'One', note: '3', description: 'First section.' }, { id: 'two', label: 'Two' }] },
  { key: 'b', heading: 'BETA', items: [{ id: 'three', label: 'Three' }] },
];

@Component({
  standalone: true,
  imports: [TwoPanelComponent],
  template: `<pf-two-panel [groups]="groups" [selected]="sel()" [compact]="compact()" [detailOpen]="detail()"
      (pick)="picked.push($event); sel.set($event)" (back)="backs = backs + 1"><p class="inner">tiles for {{ sel() }}</p></pf-two-panel>`,
})
class Host {
  groups = GROUPS;
  sel = signal<string | null>('one');
  compact = signal(false);
  detail = signal(false);
  picked: string[] = [];
  backs = 0;
}

function mount() {
  const f = TestBed.createComponent(Host);
  f.detectChanges();
  return { f, host: f.componentInstance, el: f.nativeElement as HTMLElement };
}

describe('pf-two-panel (shared)', () => {
  it('renders grouped rows in order with notes, marks the selected one and projects the content', () => {
    const { el } = mount();
    expect(Array.from(el.querySelectorAll('.pf-tp__heading')).map((h) => h.textContent!.trim())).toEqual(['ALPHA', 'BETA']);
    expect(Array.from(el.querySelectorAll('.pf-tp__item .pf-tp__label')).map((l) => l.textContent!.trim())).toEqual(['One', 'Two', 'Three']);
    expect(el.querySelector('[data-testid="tp-item-one"]')!.getAttribute('aria-current')).toBe('true');
    expect(el.querySelector('[data-testid="tp-item-one"] .pf-tp__note')!.textContent).toBe('3');
    expect(el.querySelector('.pf-tp__title')!.textContent).toBe('One');
    expect(el.querySelector('.pf-tp__desc')!.textContent).toBe('First section.');
    expect(el.querySelector('.inner')!.textContent).toBe('tiles for one');
  });

  it('clicking a row emits pick with its id', () => {
    const { f, host, el } = mount();
    el.querySelector<HTMLButtonElement>('[data-testid="tp-item-three"]')!.click();
    f.detectChanges();
    expect(host.picked).toEqual(['three']);
    expect(el.querySelector('.pf-tp__title')!.textContent).toBe('Three');
  });

  it('the slide/fade restarts on every pick (alternating phase class)', () => {
    const { f, host, el } = mount();
    const panel = el.querySelector('.pf-tp__panel')!;
    const first = panel.classList.contains('pf-tp__panel--a');
    host.sel.set('two'); f.detectChanges();
    expect(panel.classList.contains('pf-tp__panel--a')).toBe(!first);
    host.sel.set('three'); f.detectChanges();
    expect(panel.classList.contains('pf-tp__panel--a')).toBe(first);
  });

  it('wide: no back chevron', () => {
    const { el } = mount();
    expect(el.querySelector('[data-testid="tp-back"]')).toBeNull();
    expect(el.querySelector('.pf-tp--compact')).toBeNull();
  });

  it('compact list: detail is not shown; compact detail shows it — and NO back button in either card (the band owns back)', () => {
    const { f, host, el } = mount();
    host.compact.set(true); f.detectChanges();
    expect(el.querySelector('pf-two-panel')!.classList.contains('pf-tp--detail')).toBe(false);
    host.detail.set(true); f.detectChanges();
    expect(el.querySelector('pf-two-panel')!.classList.contains('pf-tp--detail')).toBe(true);
    expect(el.querySelector('[data-testid="tp-back"], [data-testid="tp-nav-back"]')).toBeNull();
  });

  it('Test Master frame: side card + main card, each with a pf-card__head; the side head shows navTitle', () => {
    const { el } = mount();
    expect(el.querySelector('aside.pf-card.pf-tp__nav > .pf-card__head [data-testid="tp-nav-title"]')!.textContent!.trim()).toBe('Settings');
    expect(el.querySelector('section.pf-card.pf-tp__panel > .pf-card__head .pf-tp__title')!.textContent).toBe('One');
    expect(el.querySelector('[data-testid="tp-nav-back"]')).toBeNull();
  });

  it('nothing selected renders the list only', () => {
    const { f, host, el } = mount();
    host.sel.set(null); f.detectChanges();
    expect(el.querySelector('.pf-tp__title')).toBeNull();
    expect(el.querySelectorAll('.pf-tp__item').length).toBe(3);
  });

  it('tree rows: a heading toggles its children (indented); a heading holding the selected row stays open', () => {
    const f = TestBed.createComponent(TwoPanelComponent);
    f.componentRef.setInput('groups', [{ key: 't', heading: '', items: [
      { id: 'departments', label: 'Departments' },
      { id: 'spaces', label: 'Lab spaces', heading: true },
      { id: 'spaces-b1', label: 'Main', parent: 'spaces' },
      { id: 'spaces-b2', label: 'Annex', parent: 'spaces' },
    ] }]);
    f.componentRef.setInput('selected', 'departments');
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelectorAll('.pf-tp__item--child').length).toBe(2);
    el.querySelector<HTMLButtonElement>('[data-testid="tp-item-spaces"]')!.click();
    f.detectChanges();
    expect(el.querySelectorAll('.pf-tp__item--child').length).toBe(0);
    expect(el.querySelector('[data-testid="tp-item-spaces"]')!.getAttribute('aria-expanded')).toBe('false');
    f.componentRef.setInput('selected', 'spaces-b2');
    f.detectChanges();
    expect(el.querySelectorAll('.pf-tp__item--child').length).toBe(2);
  });
});
