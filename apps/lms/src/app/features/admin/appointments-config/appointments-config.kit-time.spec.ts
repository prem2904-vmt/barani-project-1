import { of } from 'rxjs';
import { vi } from 'vitest';
import { AppointmentsConfigComponent } from './appointments-config.component';
import { AppointmentQueueService } from '../../../core/services/appointment-queue.service';
import { renderBandPage } from '../admin-band.spec-helpers';

/** Start / End time used a native `<input type="time">` — now `pf-time`
 *  (typed hh:mm, 24h HH:mm in/out, same value the native control emitted). */
describe('Appointments config — Start/End time (kit, no native time input)', () => {
  const cfg = {
    slotMinutes: 15, maxConcurrentSlots: 2, open24h: false,
    queueMode: 'fifo',
    queueOptions: { baseAppointment: 100, baseWalkin: 50, baseFollowup: 80, waitWeight: 1, appointmentGraceMinutes: 10,
      latePenalty: 50, noShowThresholdMinutes: 30, avgCollectionMinutes: 5, urgentOverrideScore: 1000 },
  };
  const render = () => renderBandPage(AppointmentsConfigComponent, {
    providers: [{ provide: AppointmentQueueService, useValue: { getConfig: vi.fn(() => of(cfg)), saveConfig: vi.fn((c: unknown) => of(c)) } }],
  });

  it('renders pf-time for Start/End, never a visible native time input', () => {
    const p = render();
    (p.cmp as any).tab.set('slots');
    p.f.detectChanges();
    const card = p.el.querySelector('pf-setting-group.pf-ap-card .pf-card')!;
    expect(card.querySelectorAll('pf-time').length).toBe(2);
    expect(card.querySelector('input[type="time"]:not([aria-hidden="true"])')).toBeNull();
  });

  it('typing a new Start time in the kit field updates the stored HH:mm', () => {
    const p = render();
    (p.cmp as any).tab.set('slots');
    p.f.detectChanges();
    const txt = p.el.querySelectorAll<HTMLInputElement>('.pf-ap-card pf-time input[type="text"]')[0];
    txt.value = '0730';
    txt.dispatchEvent(new Event('input'));
    p.f.detectChanges();
    expect((p.cmp as any).startTime()).toBe('07:30');
  });
});
