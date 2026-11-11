import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, Injector, inject } from '@angular/core';
import { firstValueFrom, Observable } from 'rxjs';
import { api } from '../../data/api-url';
import {
  BUILDER_WORDS, BuilderError, BuilderStatus, CheckSource, CheckView, ChecksResult, CortexProposalStatus, CortexReply,
} from './builder-models';

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const SOURCES: CheckSource[] = ['auto', 'cortex', 'connector', 'person'];
const PROPOSAL_STATUSES: CortexProposalStatus[] = ['building', 'pending', 'stale', 'failed', 'approved', 'rejected', 'withdrawn'];

export function toStatus(v: unknown): BuilderStatus {
  const r = obj(v);
  return { cortex: r['cortex'] === true, connector: r['connector'] === true, connectorSwitch: r['connectorSwitch'] === true, canChangeSwitch: r['canChangeSwitch'] === true };
}

export function toReply(v: unknown): CortexReply {
  const r = obj(v);
  return {
    conversationId: typeof r['conversationId'] === 'string' ? r['conversationId'] : '',
    reply: typeof r['reply'] === 'string' ? r['reply'] : '',
    steps: (Array.isArray(r['steps']) ? r['steps'] : []).map((s) => ({ tool: String(obj(s)['tool'] ?? ''), summary: String(obj(s)['summary'] ?? ''), changed: obj(s)['changed'] !== false })).filter((s) => s.summary),
    formChanged: r['formChanged'] === true,
    proposalId: typeof r['proposalId'] === 'string' && r['proposalId'] ? (r['proposalId'] as string) : null,
    proposalStatus: PROPOSAL_STATUSES.find((s) => s === r['proposalStatus']) ?? null,
  };
}

export function toCheck(v: unknown): CheckView {
  const c = obj(v);
  const res = c['result'] && typeof c['result'] === 'object' ? obj(c['result']) : null;
  return {
    id: String(c['id'] ?? ''),
    title: String(c['title'] ?? ''),
    source: SOURCES.find((s) => s === c['source']) ?? 'auto',
    given: strs(c['given']),
    expect: strs(c['expect']),
    result: res ? { pass: res['pass'] === true, failures: strs(res['failures']) } : null,
    ranAt: typeof c['ranAt'] === 'string' ? (c['ranAt'] as string) : null,
  };
}

export function toChecks(v: unknown): ChecksResult {
  const r = obj(v);
  const s = obj(r['summary']);
  const cov = obj(s['coverage']);
  return {
    summary: { total: n(s['total']), passed: n(s['passed']), failed: n(s['failed']), coverage: { rules: n(cov['rules']), tested: n(cov['tested']) } },
    checks: (Array.isArray(r['checks']) ? r['checks'] : []).map(toCheck),
  };
}

/** ProblemDetails `code` → a BuilderError with plain words (the contract codes use our own wording). */
export function mapBuilderError(e: unknown): unknown {
  if (!(e instanceof HttpErrorResponse) || e.status === 0) return e;
  const body = obj(e.error);
  const code = typeof body['code'] === 'string' ? (body['code'] as string) : '';
  const detail = (typeof body['detail'] === 'string' && body['detail']) || (typeof body['title'] === 'string' && body['title']) || '';
  if (code) return new BuilderError(code, BUILDER_WORDS[code] ?? (detail || "Couldn't do that just now."), e.status);
  return e;
}

/** The case-sheet builder endpoints (raw JSON, like the rest of the case-sheet data layer). */
@Injectable({ providedIn: 'root' })
export class CaseSheetBuilderApi {
  // looked up on first use: the editor injects the builder services even when the beta is off, and a screen without
  // HttpClient (unit specs) must never fail just because of that
  private readonly injector = inject(Injector);
  private get http(): HttpClient { return this.injector.get(HttpClient); }

  private async call<T>(req: Observable<T>): Promise<T> {
    try { return await firstValueFrom(req); } catch (e) { throw mapBuilderError(e); }
  }

  async status(): Promise<BuilderStatus> {
    return toStatus(await this.call(this.http.get(api('/api/casesheets/builder/status'))));
  }

  async setConnector(enabled: boolean): Promise<void> {
    await this.call(this.http.put(api('/api/casesheets/builder/connector'), { enabled }));
  }

  async cortex(formId: string, message: string, conversationId?: string): Promise<CortexReply> {
    const body: Json = { message };
    if (conversationId) body['conversationId'] = conversationId;
    return toReply(await this.call(this.http.post(api(`/api/casesheets/forms/${encodeURIComponent(formId)}/cortex`), body)));
  }

  /** No case sheet open: Cortex may start a NEW case sheet (a `create` suggestion; nothing exists until it is approved). */
  async cortexNew(message: string, conversationId?: string): Promise<CortexReply> {
    const body: Json = { message };
    if (conversationId) body['conversationId'] = conversationId;
    return toReply(await this.call(this.http.post(api('/api/casesheets/builder/cortex'), body)));
  }

  /** "Send for approval": the chat's building suggestion → pending. Returns the new status. */
  async submit(proposalId: string): Promise<CortexProposalStatus> {
    const r = obj(await this.call(this.http.post(api(`/api/casesheets/proposals/${encodeURIComponent(proposalId)}/submit`), {})));
    return PROPOSAL_STATUSES.find((s) => s === r['status']) ?? 'pending';
  }

  async checks(formId: string): Promise<ChecksResult> {
    return toChecks(await this.call(this.http.get(api(`/api/casesheets/forms/${encodeURIComponent(formId)}/checks`))));
  }

  async runChecks(formId: string): Promise<ChecksResult> {
    return toChecks(await this.call(this.http.post(api(`/api/casesheets/forms/${encodeURIComponent(formId)}/checks/run`), {})));
  }

  async suggestChecks(formId: string): Promise<ChecksResult> {
    return toChecks(await this.call(this.http.post(api(`/api/casesheets/forms/${encodeURIComponent(formId)}/checks/suggest`), {})));
  }

  async removeCheck(formId: string, checkId: string): Promise<void> {
    await this.call(this.http.delete(api(`/api/casesheets/forms/${encodeURIComponent(formId)}/checks/${encodeURIComponent(checkId)}`)));
  }
}
