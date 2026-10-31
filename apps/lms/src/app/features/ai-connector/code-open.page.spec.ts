import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { ApiError } from '../../shared/models/api-response.model';
import { AiConnectorApi, ResolvedCode } from './ai-connector.api';
import { CodeOpenPage, patientTarget } from './code-open.page';

function setup(code: string, resolve: () => ReturnType<AiConnectorApi['resolve']>) {
  const api = { resolve: vi.fn(resolve) };
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [CodeOpenPage],
    providers: [
      provideRouter([]),
      { provide: AiConnectorApi, useValue: api },
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => code } } } },
    ],
  });
  const router = TestBed.inject(Router);
  const nav = vi.spyOn(router, 'navigate').mockResolvedValue(true);
  const f = TestBed.createComponent(CodeOpenPage);
  document.body.appendChild(f.nativeElement);
  return { f, api, nav };
}
async function settle(f: { detectChanges(): void; whenStable(): Promise<unknown> }) {
  f.detectChanges();
  for (let i = 0; i < 4; i++) { await Promise.resolve(); await new Promise(r => setTimeout(r, 0)); }
  await f.whenStable();
  f.detectChanges();
}
afterEach(() => { document.body.innerHTML = ''; });

describe('patientTarget', () => {
  it('one mentioned order opens that order; otherwise the patient profile', () => {
    expect(patientTarget('p1', ['o1'])).toEqual(['/o', 'o1']);
    expect(patientTarget('p1', [])).toEqual(['/frontdesk/patients', 'p1']);
    expect(patientTarget('p1', ['o1', 'o2'])).toEqual(['/frontdesk/patients', 'p1']);
  });
});

describe('CodeOpenPage /r/:code', () => {
  it('a patient code forwards to the patient profile', async () => {
    const { f, api, nav } = setup('P-K7Q2X', () => of<ResolvedCode>({ kind: 'patient', patientId: 'p1', orderIds: [] }));
    await settle(f);
    expect(api.resolve).toHaveBeenCalledWith('P-K7Q2X');
    expect(nav).toHaveBeenCalledWith(['/frontdesk/patients', 'p1'], { replaceUrl: true });
  });

  it('a patient code with one order forwards to the order landing', async () => {
    const { f, nav } = setup('P-K7Q2X', () => of<ResolvedCode>({ kind: 'patient', patientId: 'p1', orderIds: ['o9'] }));
    await settle(f);
    expect(nav).toHaveBeenCalledWith(['/o', 'o9'], { replaceUrl: true });
  });

  it('a staff code shows the staff card with the name (text, not HTML)', async () => {
    const { f, nav } = setup('T-3', () => of<ResolvedCode>({ kind: 'staff', userId: 'u1', name: '<b>Asha Rao</b>' }));
    await settle(f);
    expect(nav).not.toHaveBeenCalled();
    const name = f.nativeElement.querySelector('.pf-co__name') as HTMLElement;
    expect(name.textContent).toBe('<b>Asha Rao</b>');
    expect(name.querySelector('b')).toBeNull();
  });

  it('404 says exactly: This link has expired or isn’t yours.', async () => {
    const { f, nav } = setup('P-AAAAA', () => throwError(() => new ApiError('nf', 'not_found')));
    await settle(f);
    expect(nav).not.toHaveBeenCalled();
    expect(f.nativeElement.textContent).toContain('This link has expired or isn’t yours.');
  });

  it('a network failure is a different, retryable message', async () => {
    const { f, api } = setup('P-AAAAA', () => throwError(() => new ApiError('Request failed')));
    await settle(f);
    expect(f.nativeElement.textContent).toContain('Couldn’t open this link.');
    (f.nativeElement.querySelector('button') as HTMLButtonElement).click();
    await settle(f);
    expect(api.resolve).toHaveBeenCalledTimes(2);
  });

  it('an empty code is expired without calling the server', async () => {
    const { f, api } = setup('', () => of<ResolvedCode>({ kind: 'patient', patientId: 'p', orderIds: [] }));
    await settle(f);
    expect(api.resolve).not.toHaveBeenCalled();
    expect(f.nativeElement.textContent).toContain('expired');
  });
});
