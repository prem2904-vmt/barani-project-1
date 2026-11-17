import { notificationRoute } from './notification-route';

describe('notificationRoute', () => {
  // Type-specific overrides (the reported cases): referenceType is "order" for
  // both, so only the type tells them apart.
  it('routes billed-not-collected to the collection drawer for that order', () => {
    expect(notificationRoute('lms.billed_not_collected', 'order', 'o1', false))
      .toEqual({ commands: ['/lab/collect'], queryParams: { orderId: 'o1' } });
  });

  it('routes dispatch-not-received to the lab receive screen', () => {
    expect(notificationRoute('lms.dispatch_not_received', 'order', 'o1', false))
      .toEqual({ commands: ['/lab/receive'] });
  });

  it('strips the lms. prefix on the type', () => {
    expect(notificationRoute('dispatch_not_received', 'order', 'o1', false))
      .toEqual({ commands: ['/lab/receive'] });
  });

  it('routes a report to the report viewer', () => {
    expect(notificationRoute('report_ready', 'report', 'r1', false))
      .toEqual({ commands: ['/reports/view', 'r1'] });
  });

  it('routes a sample to the lab sample screen', () => {
    expect(notificationRoute(null, 'order_sample', 's1', false))
      .toEqual({ commands: ['/lab/sample', 's1'] });
  });

  it('routes a validation item to the pathologist screen only when allowed', () => {
    expect(notificationRoute(null, 'order_test', 't1', true))
      .toEqual({ commands: ['/pathologist/validate', 't1'] });
    expect(notificationRoute(null, 'order_test', 't1', false))
      .toEqual({ commands: ['/lab/my-work'] });
  });

  it('routes a generic order to its collection drawer', () => {
    expect(notificationRoute('order_created', 'order', 'o9', false))
      .toEqual({ commands: ['/lab/collect'], queryParams: { orderId: 'o9' } });
  });

  // Work Register #6: urgent_report_ready shares referenceType 'order' with
  // the Collect-bound events above, so only the TYPE check routes it right
  // — to the report queue, not Collect (nothing left to collect).
  it('routes urgent_report_ready to the report queue, not Collect', () => {
    expect(notificationRoute('urgent_report_ready', 'order', 'o9', false))
      .toEqual({ commands: ['/reports'] });
    expect(notificationRoute('lms.urgent_report_ready', 'order', 'o9', false))
      .toEqual({ commands: ['/reports'] });
  });

  it('routes a bill to the frontdesk queue', () => {
    expect(notificationRoute('refund_owed', 'bill', 'b1', false))
      .toEqual({ commands: ['/frontdesk'] });
  });

  it('routes appointment / dispatch_package / user / vendor / workflow', () => {
    expect(notificationRoute(null, 'appointment', 'a1', false)).toEqual({ commands: ['/frontdesk/appointments'] });
    expect(notificationRoute(null, 'dispatch_package', 'd1', false)).toEqual({ commands: ['/lab/receive'] });
    expect(notificationRoute(null, 'user', 'u1', false)).toEqual({ commands: ['/admin/users', 'u1', 'edit'] });
    expect(notificationRoute(null, 'vendor', 'v1', false)).toEqual({ commands: ['/finance/credit-accounts'] });
    expect(notificationRoute(null, 'process_workflow', 'w1', false)).toEqual({ commands: ['/admin/process'] });
  });

  it('returns null for an unknown / missing reference type', () => {
    expect(notificationRoute('something', 'mystery', 'x', false)).toBeNull();
    expect(notificationRoute(undefined, undefined, undefined, false)).toBeNull();
  });
});
