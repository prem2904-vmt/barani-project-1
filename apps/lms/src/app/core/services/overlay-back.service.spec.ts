import { OverlayBackService } from './overlay-back.service';

describe('OverlayBackService', () => {
  it('closes the most recently opened overlay first, one per back', () => {
    const s = new OverlayBackService();
    const order: string[] = [];
    s.register(() => order.push('start'));
    s.register(() => order.push('account'));
    expect(s.open).toBe(true);
    expect(s.closeTop()).toBe(true);
    expect(s.closeTop()).toBe(true);
    expect(order).toEqual(['account', 'start']);
    expect(s.closeTop()).toBe(false);
    expect(s.open).toBe(false);
  });

  it('an overlay that closed itself unregisters and is not closed twice', () => {
    const s = new OverlayBackService();
    let n = 0;
    const off = s.register(() => n++);
    off();
    expect(s.closeTop()).toBe(false);
    expect(n).toBe(0);
  });
});
