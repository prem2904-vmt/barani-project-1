import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { addPage, emptyDefinition } from '@prefrontal/forms-engine';
import { DialogService } from '../../../../core/services/dialog.service';
import { MockStudioApi } from '../data/mock-studio-api';
import { StudioApi } from '../data/studio-api';
import { StudioSession } from '../data/studio-session';
import { CaseSheetBuilderApi } from './builder-api';
import { BuilderStatus, CheckView, ChecksResult, CortexReply } from './builder-models';
import { BuilderStatusService, CORTEX_BUILDER_ON } from './builder-status.service';
import { ChatStore } from './chat.store';
import { ChecksStore } from './checks.store';

export const check = (id: string, over: Partial<CheckView> = {}): CheckView => ({
  id, title: `Check ${id}`, source: 'auto', given: ['Chief complaint: Cough'], expect: ["'Duration of cough' shows"], result: { pass: true, failures: [] }, ranAt: null, ...over,
});

export function checksOf(checks: CheckView[], rules = 10, tested = 9): ChecksResult {
  const failed = checks.filter((c) => c.result && !c.result.pass).length;
  const passed = checks.filter((c) => c.result?.pass).length;
  return { summary: { total: checks.length, passed, failed, coverage: { rules, tested } }, checks };
}

export const STATUS_ON: BuilderStatus = { cortex: true, connector: false, connectorSwitch: false, canChangeSwitch: true };

/** A fake builder API whose every call is a spy the spec can re-program. */
export function fakeApi(initial: ChecksResult = checksOf([])) {
  return {
    status: vi.fn(async () => STATUS_ON),
    setConnector: vi.fn(async () => undefined),
    cortex: vi.fn(async (): Promise<CortexReply> => ({ conversationId: 'c1', reply: 'Done.', steps: [], formChanged: false, proposalId: null, proposalStatus: null })),
    cortexNew: vi.fn(async (): Promise<CortexReply> => ({ conversationId: 'n1', reply: 'Done.', steps: [], formChanged: false, proposalId: null, proposalStatus: null })),
    submit: vi.fn(async (_id?: string) => 'pending' as const),
    checks: vi.fn(async () => initial),
    runChecks: vi.fn(async () => initial),
    suggestChecks: vi.fn(async () => initial),
    removeCheck: vi.fn(async () => undefined),
  };
}
export type FakeApi = ReturnType<typeof fakeApi>;

export const fakeDialog = () => ({ confirm: vi.fn(async (_r?: unknown) => true), alert: vi.fn(async (_r?: unknown) => undefined), prompt: vi.fn(async (_r?: unknown) => null), choose: vi.fn(async (_r?: unknown) => null) });

/** A form open in a real StudioSession (mock Studio API) with the builder stores wired to a fake builder API. */
export async function openBuilder(opts: { api?: FakeApi; dialog?: ReturnType<typeof fakeDialog>; flag?: boolean; status?: BuilderStatus | null; extraProviders?: unknown[] } = {}) {
  TestBed.resetTestingModule();
  const studio = new MockStudioApi();
  const api = opts.api ?? fakeApi();
  if (opts.status === null) api.status.mockRejectedValue(new Error('404'));
  else if (opts.status) api.status.mockResolvedValue(opts.status);
  const dialog = opts.dialog ?? fakeDialog();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: StudioApi, useValue: studio },
      { provide: CaseSheetBuilderApi, useValue: api },
      { provide: DialogService, useValue: dialog },
      { provide: CORTEX_BUILDER_ON, useValue: () => opts.flag ?? true },
      StudioSession, ChecksStore, ChatStore,
      ...((opts.extraProviders ?? []) as never[]),
    ],
  });
  const id = studio.seed('ENT', addPage(emptyDefinition('ENT'), 'History').def);
  const session = TestBed.inject(StudioSession);
  const status = TestBed.inject(BuilderStatusService);
  await status.load();
  await session.load(id);
  const flush = async () => { TestBed.tick(); await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); TestBed.tick(); };
  await flush();
  return { studio, api, dialog, session, status, checks: TestBed.inject(ChecksStore), chat: TestBed.inject(ChatStore), id, flush, signal };
}
