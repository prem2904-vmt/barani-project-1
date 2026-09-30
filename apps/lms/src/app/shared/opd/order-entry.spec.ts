import { newOrderTarget, labOrderTarget, consultTarget } from './order-entry';

describe('newOrderTarget', () => {
  // Production-safety: lab / none / default all go to the lab order screen.
  it('routes lab mode to the lab order screen (today’s behaviour)', () => {
    expect(newOrderTarget('lab', 'p1')).toEqual({ commands: ['/frontdesk/order'], queryParams: { patientId: 'p1' } });
    expect(newOrderTarget('lab')).toEqual({ commands: ['/frontdesk/order'] });
  });
  it('routes the inert none mode to the lab order screen too', () => {
    expect(newOrderTarget('none', 'p1')).toEqual({ commands: ['/frontdesk/order'], queryParams: { patientId: 'p1' } });
  });

  it('routes opd mode to the consult screen', () => {
    expect(newOrderTarget('opd', 'p1')).toEqual({ commands: ['/opd/visit/new'], queryParams: { patientId: 'p1' } });
    expect(newOrderTarget('opd')).toEqual({ commands: ['/opd/visit/new'] });
  });

  it('returns choose when both modules are usable', () => {
    expect(newOrderTarget('choose', 'p1')).toBe('choose');
  });
});

describe('target builders omit queryParams when no patient', () => {
  it('lab', () => expect(labOrderTarget()).toEqual({ commands: ['/frontdesk/order'] }));
  it('consult', () => expect(consultTarget()).toEqual({ commands: ['/opd/visit/new'] }));
});
