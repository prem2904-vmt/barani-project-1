import { Injectable } from '@angular/core';
import { FilesApp } from './files-registry';

/** Is the engine's static build actually shipped with this app? (Synapse, Axon, Myelin and Retina arrive one by one.) */
@Injectable({ providedIn: 'root' })
export class FilesEngineService {
  private readonly known = new Map<string, boolean>();

  /** False only on a definite "no": a missing folder (404) or a page that is not an engine (the app's own index.html served as a fallback).
   *  A network error or no fetch at all answers true: the editor then shows its normal loading / failed states. */
  async available(app: FilesApp, base: string = typeof document !== 'undefined' ? document.baseURI : 'http://localhost/'): Promise<boolean> {
    const hit = this.known.get(app.id);
    if (hit !== undefined) return hit;
    let ok = true;
    try {
      if (typeof fetch === 'function') {
        const r = await fetch(new URL(`${app.enginePath}index.html`, base).toString(), { cache: 'no-store' });
        ok = r.ok && /\.wasm|_bg\.js|window\.[a-z]+\s*=/.test(await r.text());
      }
    } catch { ok = true; }
    this.known.set(app.id, ok);
    return ok;
  }
}

export const engineMissingMessage = (app: FilesApp): string => `${app.name} isn't available in this build yet. Ask your admin, or try again after the next update.`;
