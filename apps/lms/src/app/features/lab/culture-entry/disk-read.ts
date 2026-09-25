import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map, timeout } from 'rxjs';
import { PlatformService } from '../../../core/services/platform.service';
import { ApiError, ApiResponse } from '../../../shared/models/api-response.model';
import { DiskCandidate, drugForCode, normCode } from './disk-codes';
import { mosaicLayout, MosaicLayout } from './plate-vision';

/**
 * The ONE AI call of "Measure zones from plate": a mosaic of numbered disk
 * crops goes to the backend, which asks the model to read each printed code
 * from the panel's candidate list. The answer is a SUGGESTION — nothing is
 * written until the technician presses Apply. Everything measured (plate,
 * disks, zones) is OpenCV, never AI.
 */

export interface DiskReadRequest {
  orderTestId: string;
  /** JPEG mosaic, base64 WITHOUT the data: prefix. */
  image: string;
  tiles: number[];
  candidates: string[];
}
export interface DiskReadResult {
  /** `suggestedCode` (optional): on an UNKNOWN tile, the one panel code left
   *  unused — shown as "Probably …", never applied automatically. */
  disks: { n: number; code: string | null; confidence: number | null; suggestedCode?: string | null }[];
  model: string;
  latencyMs: number;
  usage: { promptTokens: number; outputTokens: number; thoughtTokens: number; totalTokens: number };
  auditId: string;
}
export interface AiUsage { monthTokens: number; capTokens: number; calls: number; }

@Injectable({ providedIn: 'root' })
export class DiskReadApi {
  private readonly http = inject(HttpClient);
  private readonly platform = inject(PlatformService);
  private url(p: string) { return `${this.platform.getApiUrl()}/api/culture/ast${p}`; }

  /** The read takes ~6–10 s; give up after 60 s (→ pick manually). */
  static readonly TIMEOUT_MS = 60_000;
  read(req: DiskReadRequest): Observable<DiskReadResult> {
    return this.http.post<ApiResponse<DiskReadResult>>(this.url('/disk-read'), req).pipe(timeout(DiskReadApi.TIMEOUT_MS), map(r => {
      if (!r?.success || !r.data) throw new ApiError(r?.message || 'PF Sense couldn’t read the codes', r?.error || 'ai_failed');
      return r.data;
    }));
  }
  confirm(auditId: string, disks: { n: number; code: string | null }[]): Observable<unknown> {
    return this.http.post(this.url(`/disk-read/${encodeURIComponent(auditId)}/confirm`), { disks });
  }
  usage(): Observable<AiUsage> {
    return this.http.get<ApiResponse<AiUsage>>(this.url('/ai-usage')).pipe(map(r => {
      if (!r?.success || !r.data) throw new ApiError('usage unavailable');
      return r.data;
    }));
  }
}

/** The line shown when the AI can't help — the technician picks codes. */
export function aiFallbackMessage(e: unknown): string {
  const status = (e as { status?: number })?.status;
  const code = ApiError.from(e).code;
  if (code === 'ai_cap_reached') return 'PF Sense limit reached this month — codes: pick manually';
  if (code === 'ai_unavailable' || status === 404) return 'Codes: pick manually';
  return 'Couldn’t read the codes — pick manually';
}

/** "1.2M / 2M tokens". */
export function formatTokens(n: number): string {
  if (!Number.isFinite(n)) return '0';
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${+(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

/** One disk row as the AI mapping sees it. */
export interface CodeSlot {
  id: number; code: string | null; codeSrc: 'ai' | 'tech' | null; aiConf: number | null; notDisk: boolean;
  /** The backend's "probably" for an unread disk — a one-tap confirm, never auto-applied. */
  suggested?: string | null;
}

/**
 * Fold the AI answer into the rows. `tileToId` maps the tile number sent
 * (n) to the row id AT CALL TIME — rows may have been added or removed
 * while the call ran. Rules: a row the technician already coded is never
 * touched; a code off the panel (or UNKNOWN) stays unknown; a DRUG is used
 * at most once — two printed aliases of one drug ("CFS 105" / "CFS 75/30")
 * count as the same — the most confident tile keeps it, a drug the
 * technician already placed stays theirs. An unread tile may carry the backend's
 * `suggestedCode` — kept as `suggested` only while no other disk holds it.
 */
export function mapAiRead<T extends CodeSlot>(rows: T[], res: Pick<DiskReadResult, 'disks'>, tileToId: Map<number, number>, candidates: DiskCandidate[]): T[] {
  const allowed = new Set(candidates.map(c => c.code));
  const byId = new Map<number, { code: string | null; conf: number | null; sug: string | null }>();
  for (const d of res.disks ?? []) {
    const id = tileToId.get(d.n);
    if (id == null) continue;
    const c = normCode(d.code), sg = normCode(d.suggestedCode);
    byId.set(id, { code: allowed.has(c) ? c : null, conf: d.confidence ?? null, sug: allowed.has(sg) ? sg : null });
  }
  const drugOf = (c: string | null | undefined) => (c ? drugForCode(c, candidates) ?? c : null);
  const techDrugs = new Set(rows.filter(r => r.codeSrc === 'tech' && r.code).map(r => drugOf(r.code)));
  // Duplicate claims: keep the most confident per DRUG.
  const winner = new Map<string, { id: number; conf: number }>();
  for (const [id, v] of byId) {
    if (!v.code) continue;
    const row = rows.find(r => r.id === id);
    if (!row || row.codeSrc === 'tech' || row.notDisk) continue;
    const d = drugOf(v.code)!, w = winner.get(d), conf = v.conf ?? 0;
    if (!w || conf > w.conf) winner.set(d, { id, conf });
  }
  const mapped = rows.map(r => {
    if (r.codeSrc === 'tech' || r.notDisk || !byId.has(r.id)) return r;
    const v = byId.get(r.id)!;
    const keep = !!v.code && winner.get(drugOf(v.code)!)?.id === r.id && !techDrugs.has(drugOf(v.code));
    return { ...r, code: keep ? v.code : null, codeSrc: 'ai' as const, aiConf: keep ? v.conf : null, suggested: keep ? null : v.sug };
  });
  const used = new Set(mapped.map(r => drugOf(r.code)).filter(Boolean));
  return mapped.map(r => r.suggested && used.has(drugOf(r.suggested)) ? { ...r, suggested: null } : r);
}

// ── Mosaic (canvas) ──────────────────────────────────────────────────

export interface MosaicTileSource { cx: number; cy: number; r: number; /** Badge number (default: position + 1). */ n?: number; }
export interface Mosaic { base64: string; layout: MosaicLayout; /** Tile numbers in tile order — the `tiles` sent. */ tiles: number[]; }

interface Ctx2D {
  fillStyle: string | CanvasGradient | CanvasPattern; font: string; textBaseline: CanvasTextBaseline; textAlign: CanvasTextAlign;
  fillRect(x: number, y: number, w: number, h: number): void;
  drawImage(img: CanvasImageSource, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number): void;
  fillText(t: string, x: number, y: number): void;
}
export interface CanvasLike { width: number; height: number; getContext(k: '2d'): Ctx2D | null; toDataURL(type: string, q: number): string; }

/**
 * Numbered 256 px crops (1.6 × the disk radius around each disk), 4 per row,
 * JPEG ≈0.9. Each tile carries its disk's badge number (default i+1) in a
 * dark corner badge — the number the AI answers with.
 */
export function buildMosaic(source: CanvasImageSource, disks: MosaicTileSource[],
                            make: () => CanvasLike = () => document.createElement('canvas') as unknown as CanvasLike,
                            cols = 4, tile = 256): Mosaic {
  const layout = mosaicLayout(disks.length, cols, tile);
  const cv = make();
  cv.width = layout.width; cv.height = layout.height;
  const ctx = cv.getContext('2d');
  if (!ctx) throw new Error('canvas unavailable');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, layout.width, layout.height);
  const numbers = disks.map((d, i) => d.n ?? i + 1);
  disks.forEach((d, i) => {
    const t = { ...layout.tiles[i], n: numbers[i] };
    const k = d.r * 1.6;
    ctx.drawImage(source, d.cx - k, d.cy - k, 2 * k, 2 * k, t.x, t.y, tile, tile);
    ctx.fillStyle = '#141414';
    ctx.fillRect(t.x, t.y, 46, 36);
    ctx.fillStyle = '#ffffff';
    ctx.font = '600 24px "Noto Sans", sans-serif';
    ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    ctx.fillText(String(t.n), t.x + 23, t.y + 19);
  });
  const url = cv.toDataURL('image/jpeg', 0.9);
  return { base64: url.slice(url.indexOf(',') + 1), layout, tiles: numbers };
}
