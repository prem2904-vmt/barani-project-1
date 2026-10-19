import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DraftChip, DraftShelfService } from './draft-shelf.service';

@Component({ template: '' })
class Blank {}

const LAB: DraftChip[] = [
  { id: 'lab:A', label: '26123', sub: 'Mr. Arun', link: ['/lab/sample', 'A'] },
  { id: 'lab:B', label: '26124', sub: 'Ms. Bhavna', link: ['/lab/sample', 'B'] },
];
const FD: DraftChip[] = [
  { id: 'fd:pA', label: 'Mr. Arun', link: '/frontdesk/order', queryParams: { patientId: 'pA' } },
  { id: 'fd:pB', label: 'Ms. Bhavna', link: '/frontdesk/order', queryParams: { patientId: 'pB' } },
];

function setup() {
  TestBed.configureTestingModule({
    providers: [provideRouter([
      { path: 'lab/my-work', component: Blank },
      { path: 'lab/collect', component: Blank },
      { path: 'lab/sample/:sampleId', component: Blank },
      { path: 'frontdesk', component: Blank },
      { path: 'frontdesk/order', component: Blank },
      { path: '**', component: Blank },
    ])],
  });
  const router = TestBed.inject(Router);
  const shelf = TestBed.inject(DraftShelfService);
  shelf.publish('lab', LAB);
  shelf.publish('frontdesk', FD);
  return { router, shelf };
}

describe('DraftShelfService — which draft is on stage', () => {
  it('the chip matching the current path is active, and it follows every navigation', async () => {
    const { router, shelf } = setup();
    await router.navigateByUrl('/lab/my-work');
    expect(shelf.activeId()).toBeNull();                 // the publisher list itself: none selected
    await router.navigateByUrl('/lab/sample/A');
    expect(shelf.activeId()).toBe('lab:A');
    expect(shelf.isActive(LAB[0])).toBe(true);
    expect(shelf.isActive(LAB[1])).toBe(false);
    // Arriving at B by other means (scan, queue row, notification…) moves it too.
    await router.navigateByUrl('/lab/sample/B');
    expect(shelf.activeId()).toBe('lab:B');
    await router.navigateByUrl('/lab/sample/Z');         // not a draft
    expect(shelf.activeId()).toBeNull();
  });

  it('query-identified drafts match on path AND their query; extra URL params are ignored', async () => {
    const { router, shelf } = setup();
    await router.navigateByUrl('/frontdesk/order?patientId=pB');
    expect(shelf.activeId()).toBe('fd:pB');
    await router.navigateByUrl('/frontdesk/order?patientId=pA&discount=50');
    expect(shelf.activeId()).toBe('fd:pA');
    await router.navigateByUrl('/frontdesk/order');       // same path, no patient
    expect(shelf.activeId()).toBeNull();
    await router.navigateByUrl('/frontdesk/order?patientId=pZ');
    expect(shelf.activeId()).toBeNull();
    await router.navigateByUrl('/frontdesk');             // the landing is not the order screen
    expect(shelf.activeId()).toBeNull();
  });

  it('drafts stay area-scoped: Collect (inside /lab) shows the lab drafts, none selected', async () => {
    const { router, shelf } = setup();
    await router.navigateByUrl('/lab/collect?orderId=o1');
    expect(shelf.items().map(d => d.id)).toEqual(['lab:A', 'lab:B']);
    expect(shelf.activeId()).toBeNull();
    await router.navigateByUrl('/frontdesk/order?patientId=pA');
    expect(shelf.items().map(d => d.id)).toEqual(['fd:pA', 'fd:pB']);
  });

  it('Lab settings (/lab/settings…) is configuration, not lab work: no drafts on the bar there', async () => {
    const { router, shelf } = setup();
    await router.navigateByUrl('/lab/my-work');
    expect(shelf.items().map(d => d.id)).toEqual(['lab:A', 'lab:B']);
    await router.navigateByUrl('/lab/settings');
    expect(shelf.items()).toEqual([]);
    await router.navigateByUrl('/lab/settings?tab=report');
    expect(shelf.items()).toEqual([]);
    await router.navigateByUrl('/lab/sample/A');           // back in lab work: drafts return
    expect(shelf.items().map(d => d.id)).toEqual(['lab:A', 'lab:B']);
  });

  it('swapState: a draft → draft hop slides by shelf order; none from a non-draft screen or onto itself', async () => {
    const { router, shelf } = setup();
    await router.navigateByUrl('/lab/my-work');
    expect(shelf.swapState(LAB[1])).toBeUndefined();
    await router.navigateByUrl('/lab/sample/A');
    expect(shelf.swapState(LAB[1])).toEqual({ pfDraftSwap: 'forward' });
    expect(shelf.swapState(LAB[0])).toBeUndefined();
    await router.navigateByUrl('/lab/sample/B');
    expect(shelf.swapState(LAB[0])).toEqual({ pfDraftSwap: 'back' });
  });
});

/** The shelf's markup contract (top-strip template): the active chip is
 *  marked aria-current and carries NO link, so tapping the draft you're on
 *  cannot navigate or reload anything. */
describe('Draft shelf markup — selected chip', () => {
  const html = readFileSync(resolve(process.cwd(), 'apps/lms/src/app/layout/top-strip/top-strip.component.html'), 'utf8');
  const shelf = html.slice(html.indexOf('class="pf-draftshelf"'), html.indexOf('pf-ts-spacer'));
  it('chips: aria-current, link dropped while on stage; the +N chip carries the overflow selection', () => {
    const cls = 'pf-draftshelf__chip press';
    const tag = shelf.slice(shelf.indexOf(cls), shelf.indexOf('>', shelf.indexOf(cls)));
    expect(tag).toContain(`[routerLink]="on ? null : d.link"`);
    expect(tag).toContain(`[attr.aria-current]="on ? 'page' : null"`);
    expect(tag).toContain('[state]="draftShelf.swapState(d)"');
    expect(shelf).toContain('@let on = draftShelf.activeId() === d.id;');
    expect(shelf).toContain(`[attr.data-current]="activeDraftInOverflow() ? 'true' : null"`);
  });
  it('selected style = the quiet violet look (tint + ink + hairline), both themes, ARIA-driven; 44px touch hit', () => {
    const scss = readFileSync(resolve(process.cwd(), 'apps/lms/src/app/layout/top-strip/top-strip.component.scss'), 'utf8');
    expect(scss).toMatch(/\.pf-draftshelf__chip\[aria-current\],\s*\.pf-draftshelf__more\[data-current\] \{[^}]*background:\s*rgba\(124, 58, 237, 0\.10\)/);
    // Dark goes through :host-context (a `:root.dark` selector is mangled by
    // emulated encapsulation and never matches).
    expect(scss).toMatch(/:host-context\(\.dark\) \.pf-draftshelf__chip\[aria-current\]/);
    expect(scss).not.toMatch(/:root\.dark \.pf-draftshelf/);
    expect(scss).toMatch(/@media \(pointer: coarse\)[\s\S]*\.pf-draftshelf__chip::after[\s\S]*height:\s*44px/);
  });
});

describe('DraftShelfService — drop (submitted tubes leave the shelf)', () => {
  it('removes only the named chips of that area', async () => {
    const { router, shelf } = setup();
    await router.navigateByUrl('/lab/my-work');
    shelf.drop('lab', ['lab:A', 'lab:nope']);
    expect(shelf.items().map(d => d.id)).toEqual(['lab:B']);
    await router.navigateByUrl('/frontdesk');
    expect(shelf.items().map(d => d.id)).toEqual(['fd:pA', 'fd:pB']);   // other areas untouched
  });
});
