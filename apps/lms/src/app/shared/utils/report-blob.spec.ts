import { previewViaService } from './report-blob';

// M-B (logic re-review, 2026-10-03): renderReportFromSnapshot's preview
// callback — the stored-report render path, the ONE place that produces the
// file every other entry point then just reads back — used to silently drop
// the 5th argument (profileCode), so a profile-tagged band (BIO010's
// Gestational OGTT <92) never scoped to its own profile on the stored PDF.
describe('previewViaService', () => {
  it('forwards profileCode (6th call arg) through to the service, with parametersJson explicitly null', async () => {
    const calls: unknown[][] = [];
    const svc = {
      preview: async (...args: unknown[]) => { calls.push(args); return { ok: true }; },
    };

    const fn = previewViaService(svc as never);
    await fn('bio010', { 'Fasting Blood Sugar': 91 }, ['img.png'], { sex: 'F', age: 28 }, 'BIO004');

    expect(calls).toHaveLength(1);
    const [testId, values, imageUrls, patient, parametersJson, profileCode] = calls[0];
    expect(testId).toBe('bio010');
    expect(values).toEqual({ 'Fasting Blood Sugar': 91 });
    expect(imageUrls).toEqual(['img.png']);
    expect(patient).toEqual({ sex: 'F', age: 28 });
    expect(parametersJson).toBeNull();
    expect(profileCode).toBe('BIO004');
  });

  it('forwards a null/absent profileCode for a standalone test unchanged', async () => {
    const calls: unknown[][] = [];
    const svc = {
      preview: async (...args: unknown[]) => { calls.push(args); return { ok: true }; },
    };

    const fn = previewViaService(svc as never);
    await fn('bio156', {}, [], undefined, null);

    const [, , , , , profileCode] = calls[0];
    expect(profileCode).toBeNull();
  });
});
