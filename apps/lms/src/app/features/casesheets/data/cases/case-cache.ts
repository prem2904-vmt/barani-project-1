import { InjectionToken, inject } from '@angular/core';
import { AuthService } from '../../../../core/auth/auth.service';
import { Answers, FormDefinition } from '@prefrontal/forms-engine';
import { CaseSheet, PatientBlock } from './case-models';

/**
 * What this device keeps of a sheet so a dropped connection never loses a
 * tap (plan §6: "answers also cached in IndexedDB per case sheet"). Only
 * the doctor's own sheets, only what was typed on this device.
 */
export interface CachedSheet {
  /** The last server copy this device saw. */
  sheet: CaseSheet;
  /** The answers on this device (may be ahead of the server). */
  localAnswers: Answers;
  visited: string[];
  patient: Partial<PatientBlock> | null;
  /** True while local changes have not reached the server. */
  dirty: boolean;
  /** When the local answers were last written (ms since epoch). */
  savedAt: number;
}

export interface CaseCache {
  getSheet(id: string): Promise<CachedSheet | null>;
  putSheet(id: string, value: CachedSheet): Promise<void>;
  removeSheet(id: string): Promise<void>;
  getForm(versionId: string): Promise<FormDefinition | null>;
  putForm(versionId: string, definition: FormDefinition): Promise<void>;
}

export const CASE_CACHE = new InjectionToken<CaseCache>('CASE_CACHE', {
  providedIn: 'root',
  // One device can carry several signed-in people (a lab's shared PC): each person's copy lives in its own database,
  // so an offline open can never show one user's patient to another (Prefrontal addition to Prepare's cache).
  factory: () => new IndexedDbCaseCache(cacheScope(inject(AuthService, { optional: true })?.user?.() ?? null)),
});

/** `pf-casesheets:<tenant>:<user>` — the database name for the signed-in person (anonymous = its own bucket). */
export function cacheScope(user: { id?: string; tenantId?: string } | null): string {
  return `${DB}:${user?.tenantId ?? 'none'}:${user?.id ?? 'anon'}`;
}

const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

export class MemoryCaseCache implements CaseCache {
  private readonly sheets = new Map<string, CachedSheet>();
  private readonly forms = new Map<string, FormDefinition>();
  async getSheet(id: string) {
    return clone(this.sheets.get(id) ?? null);
  }
  async putSheet(id: string, value: CachedSheet) {
    this.sheets.set(id, clone(value));
  }
  async removeSheet(id: string) {
    this.sheets.delete(id);
  }
  async getForm(versionId: string) {
    return clone(this.forms.get(versionId) ?? null);
  }
  async putForm(versionId: string, definition: FormDefinition) {
    this.forms.set(versionId, clone(definition));
  }
}

const DB = 'pf-casesheets';
const SHEETS = 'sheets';
const FORMS = 'forms';

/**
 * IndexedDB, wrapped so it can never break the screen: when IndexedDB is
 * missing or refuses (private mode, a full disk, jsdom) every call falls
 * back to memory for the rest of the session.
 */
export class IndexedDbCaseCache implements CaseCache {
  private readonly memory = new MemoryCaseCache();
  private db: Promise<IDBDatabase | null> | null = null;

  constructor(private readonly name: string = DB) {}

  private open(): Promise<IDBDatabase | null> {
    if (this.db) return this.db;
    this.db = new Promise<IDBDatabase | null>((resolve) => {
      try {
        if (typeof indexedDB === 'undefined' || !indexedDB) return resolve(null);
        const req = indexedDB.open(this.name, 1);
        req.onupgradeneeded = () => {
          const d = req.result;
          if (!d.objectStoreNames.contains(SHEETS)) d.createObjectStore(SHEETS);
          if (!d.objectStoreNames.contains(FORMS)) d.createObjectStore(FORMS);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    return this.db;
  }

  private async run<T>(
    store: string,
    mode: IDBTransactionMode,
    work: (s: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T | undefined> {
    const db = await this.open();
    if (!db) throw new Error('no indexeddb');
    return new Promise<T | undefined>((resolve, reject) => {
      try {
        const tx = db.transaction(store, mode);
        const req = work(tx.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      } catch (e) {
        reject(e);
      }
    });
  }

  async getSheet(id: string): Promise<CachedSheet | null> {
    try {
      return (
        ((await this.run(SHEETS, 'readonly', (s) => s.get(id))) as CachedSheet | undefined) ??
        (await this.memory.getSheet(id))
      );
    } catch {
      return this.memory.getSheet(id);
    }
  }

  async putSheet(id: string, value: CachedSheet): Promise<void> {
    await this.memory.putSheet(id, value);
    try {
      await this.run(SHEETS, 'readwrite', (s) => s.put(clone(value), id));
    } catch {
      /* memory keeps it */
    }
  }

  async removeSheet(id: string): Promise<void> {
    await this.memory.removeSheet(id);
    try {
      await this.run(SHEETS, 'readwrite', (s) => s.delete(id));
    } catch {
      /* nothing to remove */
    }
  }

  async getForm(versionId: string): Promise<FormDefinition | null> {
    try {
      return (
        ((await this.run(FORMS, 'readonly', (s) => s.get(versionId))) as FormDefinition | undefined) ??
        (await this.memory.getForm(versionId))
      );
    } catch {
      return this.memory.getForm(versionId);
    }
  }

  async putForm(versionId: string, definition: FormDefinition): Promise<void> {
    await this.memory.putForm(versionId, definition);
    try {
      await this.run(FORMS, 'readwrite', (s) => s.put(clone(definition), versionId));
    } catch {
      /* memory keeps it */
    }
  }
}
