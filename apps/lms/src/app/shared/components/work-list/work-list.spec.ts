import { TestBed } from '@angular/core/testing';
import { Component, signal } from '@angular/core';
import { WorkListComponent } from './work-list.component';
import { SortChipComponent } from './sort-chip.component';
import { WorkListItem, columnSortOptions, factsLine, parseSortId, sortChipText, sortItems, statusLine, toneOf } from './work-list';

describe('work-list helpers', () => {
  it('sorts items on the real value, blanks last both ways, stable', () => {
    const rows = [{ n: 'b', due: 30 }, { n: 'a', due: null }, { n: 'c', due: -5 }, { n: 'd', due: 30 }];
    const v = { due: (r: { due: number | null }) => r.due, name: (r: { n: string }) => r.n };
    expect(sortItems(rows, 'due:asc', v).map(r => r.n)).toEqual(['c', 'b', 'd', 'a']);
    expect(sortItems(rows, 'due:desc', v).map(r => r.n)).toEqual(['b', 'd', 'c', 'a']);
    expect(sortItems(rows, 'name:asc', v).map(r => r.n)).toEqual(['a', 'b', 'c', 'd']);
    expect(sortItems(rows, null, v)).toBe(rows);
  });
  it('joins the facts in order, dropping blanks and repeats', () => {
    expect(factsLine(['34/F', null, '', 'LAB-1', false, undefined, '34/F', 'Biochemistry'])).toBe('34/F · LAB-1 · Biochemistry');
    expect(factsLine(undefined)).toBe('');
  });
  it('writes the status line as words', () => {
    expect(statusLine({ now: 'Billed', detail: '0 of 2 tubes collected' })).toBe('Billed · 0 of 2 tubes collected');
    expect(statusLine({ now: 'Received' })).toBe('Received');
    expect(statusLine(null)).toBe('');
  });
  it('maps grid tones to word colours (green = done, rose / late = late, else normal)', () => {
    expect(toneOf('green')).toBe('done');
    expect(toneOf('rose')).toBe('late');
    expect(toneOf('violet')).toBe('normal');
    expect(toneOf('violet', true)).toBe('late');
  });
  it('gives every column both directions, default first', () => {
    const o = columnSortOptions([{ id: 'due', label: 'Due' }, { id: 'name', label: 'Patient', first: 'desc' }]);
    expect(o.map(x => x.id)).toEqual(['due:asc', 'due:desc', 'name:desc', 'name:asc']);
    expect(o[1].label).toBe('Due ↓');
    expect(parseSortId('due:desc')).toEqual({ col: 'due', dir: 'desc' });
    expect(parseSortId('default')).toBeNull();
    expect(sortChipText(o, 'due:desc')).toBe('Sort: Due ↓');
    expect(sortChipText(o, null)).toBe('Sort');
  });
});

@Component({
  standalone: true,
  imports: [WorkListComponent, SortChipComponent],
  template: `
    <pf-work-list [items]="items()" (open)="opened = $event.id" (primary)="pressed = $event.id" />
    <pf-sort-chip [options]="opts" value="due:desc" />`,
})
class HostComponent {
  readonly items = signal<WorkListItem[]>([
    { id: 'a', name: 'Ms. Meenakshi Sundareswaran Ramanathan Iyer', token: '#3', facts: ['34/F', 'LAB-1'], status: { now: 'Late', detail: 'Next: collect', tone: 'late' },
      time: { text: '12m late', late: true }, primary: { id: 'collect', label: 'Collect' }, more: [{ id: 'cancel', label: 'Cancel' }] },
    { id: 'b', name: 'Mr. Sathish Kumar', facts: ['41/M'], status: { now: 'Done', tone: 'done' } },
  ]);
  readonly opts = columnSortOptions([{ id: 'due', label: 'Due' }]);
  opened = ''; pressed = '';
}

describe('pf-work-list', () => {
  it('draws divider rows: name + token, facts, status words + time, ONE primary + ⋯; no pills', async () => {
    const f = TestBed.createComponent(HostComponent);
    f.detectChanges(); await f.whenStable();
    const el: HTMLElement = f.nativeElement;
    const rows = el.querySelectorAll('.pf-wl__row');
    expect(rows.length).toBe(2);
    const r = rows[0] as HTMLElement;
    expect(r.querySelector('.pf-wl__name')!.textContent).toContain('Ms. Meenakshi Sundareswaran Ramanathan Iyer');
    expect(r.querySelector('.pf-wl__token')!.textContent).toContain('#3');
    expect(r.querySelector('.pf-wl__l2')!.textContent).toBe('34/F · LAB-1');
    const sw = r.querySelector('pf-status-words.pf-wl__status')!;
    expect(sw.querySelector('.pf-sw__now')!.textContent).toBe('Late');
    expect(sw.querySelector('.pf-sw__detail')!.textContent).toBe('Next: collect');
    expect(sw.getAttribute('data-tone')).toBe('late');
    expect(r.querySelector('.pf-wl__time--late')!.textContent).toBe('12m late');
    expect(r.querySelectorAll('.pf-wl__primary').length).toBe(1);
    expect(r.querySelector('.pf-wl__more')).toBeTruthy();
    expect(el.querySelector('.pf-pill, .wg-pill')).toBeNull();
    (r.querySelector('.pf-wl__primary') as HTMLButtonElement).click();
    (r.querySelector('.pf-wl__main') as HTMLElement).click();
    expect(f.componentInstance.pressed).toBe('a');
    expect(f.componentInstance.opened).toBe('a');
    expect(el.querySelector('[data-testid="sort-chip"]')!.textContent).toContain('Sort: Due ↓');
    expect(el.querySelector('select')).toBeNull();
  });
});
