import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, Injector, inject } from '@angular/core';
import { Observable, firstValueFrom } from 'rxjs';
import { api } from '../../data/api-url';
import {
  APPROVAL_WORDS, ApprovalError, OfferView, ProposalFilter, ProposalPage, ProposalView, toOffer, toOffers, toPage, toProposal,
} from './approvals-models';

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});

/** problem+json `code` → ApprovalError with our plain words (the server's detail only for codes we don't word ourselves). */
export function mapApprovalError(e: unknown): unknown {
  if (!(e instanceof HttpErrorResponse) || e.status === 0) return e;
  const body = obj(e.error);
  const code = typeof body['code'] === 'string' ? (body['code'] as string) : '';
  const detail = (typeof body['detail'] === 'string' && body['detail']) || (typeof body['title'] === 'string' && body['title']) || '';
  if (code) return new ApprovalError(code, APPROVAL_WORDS[code] ?? (detail || 'Couldn’t do that just now.'), e.status, detail);
  return e;
}

const enc = encodeURIComponent;

/**
 * Every proposal action (approve / reject / re-review / withdraw / submit) answers with the full `GET proposals/{id}` shape,
 * detail included, so the screen never has to read it again.
 *
 * The case-sheet approvals endpoints (raw JSON, like the rest of /api/casesheets). One call per action, ONE suggestion at a time:
 * there is no bulk method here because the server has no bulk route (owner rule, same as Test Master).
 */
@Injectable({ providedIn: 'root' })
export class CaseSheetApprovalsApi {
  // looked up on first use: the Studio home / IPD hub inject the badge even in specs that have no HttpClient
  private readonly injector = inject(Injector);
  private get http(): HttpClient { return this.injector.get(HttpClient); }

  private async call<T>(req: Observable<T>): Promise<T> {
    try { return await firstValueFrom(req); } catch (e) { throw mapApprovalError(e); }
  }

  async list(opts: { status?: ProposalFilter; mine?: boolean; skip?: number; take?: number } = {}): Promise<ProposalPage> {
    let params = new HttpParams().set('status', opts.status ?? 'open');
    if (opts.mine) params = params.set('mine', 'true');
    if (opts.skip) params = params.set('skip', String(opts.skip));
    params = params.set('take', String(Math.min(100, Math.max(1, opts.take ?? 50))));
    return toPage(await this.call(this.http.get(api('/api/casesheets/proposals'), { params })));
  }

  async get(id: string): Promise<ProposalView> {
    return toProposal(await this.call(this.http.get(api(`/api/casesheets/proposals/${enc(id)}`))));
  }

  /** Publishes NOW, as the signed-in person. */
  async approve(id: string): Promise<ProposalView> {
    return toProposal(await this.call(this.http.post(api(`/api/casesheets/proposals/${enc(id)}/approve`), {})));
  }

  async reject(id: string, note?: string): Promise<ProposalView> {
    const body: Json = {};
    const n = note?.trim();
    if (n) body['note'] = n.slice(0, 500);
    return toProposal(await this.call(this.http.post(api(`/api/casesheets/proposals/${enc(id)}/reject`), body)));
  }

  async withdraw(id: string): Promise<ProposalView> {
    return toProposal(await this.call(this.http.post(api(`/api/casesheets/proposals/${enc(id)}/withdraw`), {})));
  }

  /** "Look again": a stale / failed suggestion moves onto the case sheet as it is now (no merge). */
  async reReview(id: string): Promise<ProposalView> {
    return toProposal(await this.call(this.http.post(api(`/api/casesheets/proposals/${enc(id)}/re-review`), {})));
  }

  /** The chat's "Send for approval": building → pending. */
  async submit(id: string): Promise<ProposalView> {
    return toProposal(await this.call(this.http.post(api(`/api/casesheets/proposals/${enc(id)}/submit`), {})));
  }

  async offers(): Promise<OfferView[]> {
    return toOffers(await this.call(this.http.get(api('/api/casesheets/master-offers'))));
  }

  /** One update with `detail: { yours, master }` (both definitions) for the before / after. */
  async offer(id: string): Promise<OfferView> {
    return toOffer(await this.call(this.http.get(api(`/api/casesheets/master-offers/${enc(id)}`))));
  }

  /** "Take Prefrontal's version": the copy publishes the master's version (history kept). */
  async acceptOffer(id: string): Promise<OfferView> {
    return toOffer(await this.call(this.http.post(api(`/api/casesheets/master-offers/${enc(id)}/accept`), {})));
  }

  /** "Keep mine": this master version is never offered to this copy again. */
  async dismissOffer(id: string): Promise<OfferView> {
    return toOffer(await this.call(this.http.post(api(`/api/casesheets/master-offers/${enc(id)}/dismiss`), {})));
  }
}
