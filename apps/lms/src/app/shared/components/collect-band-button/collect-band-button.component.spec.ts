import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { CollectBandButtonComponent } from './collect-band-button.component';
import { AuthService } from '../../../core/auth/auth.service';
import { ProcessWorkflowService } from '../../../core/services/process-workflow.service';
import { ProcessWorkflowConfig } from '../../models/process-workflow.model';

/**
 * Band "Collect" entry point: shows only on screens whose work-area holds an
 * ENABLED sample_collection (Process builder) for users with collect_sample;
 * opens collection for the selected order, else the general queue, and
 * carries the back target.
 */
@Component({
  standalone: true,
  imports: [CollectBandButtonComponent],
  template: `<pf-collect-band-button [area]="area()" [orderId]="orderId()" [from]="from()" [inPlace]="inPlace()" />`,
})
class HostComponent {
  inPlace = signal<(() => void) | null>(null);
  area = signal('frontdesk');
  orderId = signal<string | null>(null);
  from = signal<string | null>(null);
}

const act = (id: string, type: string, categoryId: string, enabled = true) =>
  ({ id, type, categoryId, enabled, order: 0 });

const CFG: ProcessWorkflowConfig = {
  categories: [],
  actions: [
    act('r', 'patient_registration', 'frontdesk'),
    act('b', 'billing', 'billdesk'),
    act('c1', 'sample_collection', 'frontdesk'),
    act('c2', 'sample_collection', 'lab', false),
    act('c3', 'sample_collection', 'custom1'),
  ],
};

function make(opts: { cfg?: ProcessWorkflowConfig | null; perms?: string[] } = {}) {
  const active = signal<ProcessWorkflowConfig | null>(opts.cfg === undefined ? CFG : opts.cfg);
  const perms = signal(opts.perms ?? ['collect_sample']);
  TestBed.configureTestingModule({
    imports: [HostComponent],
    providers: [
      provideRouter([]),
      { provide: AuthService, useValue: { hasPermission: (c: string) => perms().includes('*') || perms().includes(c) } },
      { provide: ProcessWorkflowService, useValue: { active, loadActive: vi.fn() } },
    ],
  });
  const router = TestBed.inject(Router);
  const nav = vi.spyOn(router, 'navigate').mockResolvedValue(true);
  const f = TestBed.createComponent(HostComponent);
  f.detectChanges();
  const el = f.nativeElement as HTMLElement;
  const btn = () => el.querySelector<HTMLButtonElement>('button.pf-cbb');
  return { f, el, host: f.componentInstance, btn, nav, active, perms };
}

describe('pf-collect-band-button', () => {
  it('shows on an area holding enabled collection, for a collect_sample holder', () => {
    const { btn } = make();
    expect(btn()).not.toBeNull();
    expect(btn()!.getAttribute('aria-label')).toBe('Collect');
    expect(btn()!.textContent).toContain('Collect');
    expect(btn()!.querySelector('.pf-collect-nav-icon')).not.toBeNull();
    // Quiet secondary, never the violet primary.
    expect(btn()!.classList.contains('pf-hb-btn--primary')).toBe(false);
  });

  it('hidden without collect_sample', () => {
    const { btn } = make({ perms: ['create_order'] });
    expect(btn()).toBeNull();
  });

  it('hidden when the area has no collection, or only a DISABLED one', () => {
    const { f, host, btn } = make();
    host.area.set('billing-counter');   // billdesk holds billing, not collection
    f.detectChanges();
    expect(btn()).toBeNull();
    host.area.set('lab');               // lab's collection is disabled
    f.detectChanges();
    expect(btn()).toBeNull();
    host.area.set('custom1');           // /w/custom1 holds it
    f.detectChanges();
    expect(btn()).not.toBeNull();
  });

  it('billing counter shows when collection sits in the billing area', () => {
    const cfg = { ...CFG, actions: [...CFG.actions, act('c4', 'sample_collection', 'billdesk')] };
    const { f, host, btn } = make({ cfg });
    host.area.set('billing-counter');
    f.detectChanges();
    expect(btn()).not.toBeNull();
  });

  it('no workflow configured → nothing (current behaviour kept)', () => {
    const { btn } = make({ cfg: null });
    expect(btn()).toBeNull();
  });

  it('patient-specific: opens collection for the selected order and returns to the given screen', () => {
    const { f, host, btn, nav } = make();
    host.orderId.set('ord-42');
    host.from.set('/frontdesk/order?orderId=ord-42');
    f.detectChanges();
    btn()!.click();
    expect(nav).toHaveBeenCalledWith(['/lab/collect'],
      { queryParams: { orderId: 'ord-42', from: '/frontdesk/order?orderId=ord-42' } });
  });

  it('general: no selection opens the unfiltered collect page, back = current URL', () => {
    const { btn, nav } = make();
    const router = TestBed.inject(Router);
    vi.spyOn(router, 'url', 'get').mockReturnValue('/frontdesk');
    btn()!.click();
    expect(nav).toHaveBeenCalledWith(['/lab/collect'], { queryParams: { from: '/frontdesk' } });
  });

  it('never passes a non-app back target', () => {
    const { f, host, btn, nav } = make();
    host.from.set('https://evil.example');
    f.detectChanges();
    btn()!.click();
    expect(nav).toHaveBeenCalledWith(['/lab/collect'], { queryParams: { from: '/' } });
  });

  it('in place: with collection already on the screen it runs the host action, never navigates', () => {
    const { f, host, btn, nav } = make();
    const local = vi.fn();
    host.inPlace.set(local);
    f.detectChanges();
    expect(btn()!.getAttribute('title')).toBe('Go to Collection');
    btn()!.click();
    expect(local).toHaveBeenCalledTimes(1);
    expect(nav).not.toHaveBeenCalled();
    host.inPlace.set(null);             // companion gone → back to navigating
    f.detectChanges();
    btn()!.click();
    expect(nav).toHaveBeenCalled();
  });
});
