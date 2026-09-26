import { draftSwapDirection, slideDirection } from './slide-transition';

describe('slideDirection (step-to-step slide)', () => {
  it('Order & Payments / frontdesk → Collect slides forward', () => {
    expect(slideDirection('/frontdesk/order?patientId=p1', '/lab/collect?orderId=o1&from=/frontdesk')).toBe('forward');
    expect(slideDirection('/frontdesk', '/lab/collect?orderId=o1')).toBe('forward');
  });
  it('Collect → frontdesk slides back', () => {
    expect(slideDirection('/lab/collect?orderId=o1', '/frontdesk')).toBe('back');
  });
  it('every other navigation keeps the instant swap', () => {
    expect(slideDirection('/admin', '/frontdesk')).toBeNull();
    expect(slideDirection('/frontdesk', '/frontdesk/order')).toBeNull();
    expect(slideDirection('/lab/collect', '/lab/my-work')).toBeNull();
  });
});

describe('draftSwapDirection (draft shelf chip → chip)', () => {
  it('reads the direction the chip put on the navigation state', () => {
    expect(draftSwapDirection({ pfDraftSwap: 'forward' })).toBe('forward');
    expect(draftSwapDirection({ pfDraftSwap: 'back' })).toBe('back');
  });
  it('anything else is no draft hop', () => {
    expect(draftSwapDirection(undefined)).toBeNull();
    expect(draftSwapDirection(null)).toBeNull();
    expect(draftSwapDirection({ pfDraftSwap: 'sideways' })).toBeNull();
    expect(draftSwapDirection({ justScanned: true })).toBeNull();
  });
});
