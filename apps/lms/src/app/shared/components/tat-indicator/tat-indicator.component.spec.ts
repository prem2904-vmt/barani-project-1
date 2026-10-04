import { TestBed } from '@angular/core/testing';
import { TatIndicatorComponent } from './tat-indicator.component';

/** The TAT chip is a clock — "Overdue" / "Due in …" / "Due 14:30" — never
 *  a priority word (Urgent / High / Normal). */
function render(remaining: number | null, dueAt?: number) {
  const f = TestBed.createComponent(TatIndicatorComponent);
  f.componentInstance.remainingMinutes = remaining;
  if (dueAt != null) f.componentInstance.dueAt = dueAt;
  f.detectChanges();
  const chip = (f.nativeElement as HTMLElement).querySelector('.pf-tat-chip') as HTMLElement | null;
  return { chip, text: chip?.textContent?.trim() ?? '' };
}

describe('pf-tat-indicator', () => {
  it('overdue → "Overdue" (rose), with how long in the tooltip', () => {
    const { chip, text } = render(-80);
    expect(text).toBe('Overdue');
    expect(chip!.getAttribute('data-tat')).toBe('overdue');
    expect(chip!.getAttribute('title')).toBe('Overdue by 1h 20m');
  });
  it('within the hour → "Due in 20m" (amber)', () => {
    const { chip, text } = render(20);
    expect(text).toBe('Due in 20m');
    expect(chip!.getAttribute('data-tat')).toBe('dueSoon');
  });
  it('otherwise the plain due time', () => {
    const due = new Date();
    due.setHours(23, 59, 0, 0);
    const rem = (due.getTime() - Date.now()) / 60000;
    if (rem > 61) {
      const { chip, text } = render(rem, due.getTime());
      expect(text).toBe('Due 23:59');
      expect(chip!.getAttribute('data-tat')).toBe('onTrack');
    }
    expect(render(200).text).toBe('Due in 3h 20m');
  });
  it('no clock → renders nothing', () => {
    expect(render(null).chip).toBeNull();
  });
  it('never shows a priority word', () => {
    for (const r of [-500, -1, 0, 1, 59, 60, 61, 600]) {
      expect(render(r).text).not.toMatch(/urgent|high|normal|breached/i);
    }
  });
});
