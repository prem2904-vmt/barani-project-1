import { Directive, InjectionToken, Signal, Type, computed, input } from '@angular/core';
import { Lookup } from '../core/rules';
import { Answers, FieldDef } from '../core/types';

/**
 * The fill-control contract (plan §4 "add a new component"): every kind has
 * ONE control in `kinds/<kind>/<kind>.fill.ts` that extends `KindFill`.
 * The field host gives it the field, its value and a `set` callback; the
 * control never knows about pages, saving or other fields.
 *
 * Touch rules every control follows: targets ≥48px (`--pf-touch`), inputs
 * ≥16px, no keyboard where a tap will do (chips, steppers, the in-app
 * number pad), no native select / date input, no inner scroll container.
 */
@Directive()
export abstract class KindFill {
  readonly field = input.required<FieldDef>();
  readonly value = input<unknown>(null);
  readonly disabled = input<boolean>(false);
  /** Write a new value (undefined clears it). */
  readonly set = input.required<(v: unknown) => void>();
  /** id of the visible label; group controls use aria-labelledby with it. */
  readonly labelId = input<string>('');
  /** The answers in this field's scope (a repeat row, a repeated page or the sheet). Repeat-like kinds read children from it. */
  readonly scope = input<Answers>({});
  /** Conditions lookup for children (scope first, then the sheet). */
  readonly lookup = input<Lookup>(() => undefined);
  /** Write any key in this scope (follow-up questions a kind shows inside its own options, legacy cards). */
  readonly setKey = input<(key: string, value: unknown) => void>(() => undefined);
  readonly lockedKeys = input<ReadonlySet<string>>(new Set());
  readonly missingKeys = input<ReadonlySet<string>>(new Set());

  protected readonly config = computed(() => this.field().config ?? {});

  protected emit(v: unknown): void {
    if (this.disabled()) return;
    this.set()(v);
  }
}

export interface KindSpec {
  /** The control, bundled with the filler (the plain kinds: small, used on almost every sheet). */
  component?: Type<KindFill>;
  /**
   * Or: load the control when a form first needs it (the heavy kinds: the canvas engine, the grid). Keeps them out of
   * the first download (bundle budget); `kindControl` caches the class, `preloadKinds` fetches a form's kinds on open.
   */
  load?: () => Promise<Type<KindFill>>;
  /**
   * One tap finishes this answer (choice, yes/no, period of day). When the
   * last visible field of a page is one of these, the wizard moves on by
   * itself 500 ms later (legacy behaviour doctors liked).
   */
  tapCompletes?: boolean;
  /** The control is a group of buttons (label is a group label, not a <label for>). Default true. */
  group?: boolean;
}

/** The kind → control map, provided by `provideFormsEngine()` (breaks the field-host ↔ repeat import cycle). */
export const FE_KINDS = new InjectionToken<Record<string, KindSpec>>('FE_KINDS');

const loaded = new WeakMap<KindSpec, Type<KindFill>>();
const loading = new WeakMap<KindSpec, Promise<Type<KindFill>>>();

/** The control of a kind: the class straight away when it is bundled or already loaded, else a promise of it. */
export function kindControl(spec: KindSpec): Type<KindFill> | Promise<Type<KindFill>> {
  if (spec.component) return spec.component;
  const have = loaded.get(spec);
  if (have) return have;
  let p = loading.get(spec);
  if (!p) {
    if (!spec.load) return Promise.reject(new Error('this kind has no control'));
    p = spec.load().then(
      (c) => {
        loaded.set(spec, c);
        return c;
      },
      (e) => {
        loading.delete(spec); // a dropped connection: try again next time
        throw e;
      },
    );
    loading.set(spec, p);
  }
  return p;
}

/** Fetch the controls of these kinds now (a case sheet / a preview on open), so turning a page never waits. Errors are ignored. */
export function preloadKinds(kinds: Record<string, KindSpec>, names: Iterable<string>): Promise<void> {
  const waits: Promise<unknown>[] = [];
  for (const n of new Set(names)) {
    const spec = kinds[n];
    if (!spec || spec.component) continue;
    const c = kindControl(spec);
    if (c instanceof Promise) waits.push(c.catch(() => undefined));
  }
  return Promise.all(waits).then(() => undefined);
}

/**
 * Voice dictation for text fields (plan §6): tap the mic to start, tap again
 * to stop; the words are APPENDED. `available` false hides every mic.
 */
export interface VoiceSession {
  /** Stop listening and return the typed words ('' when nothing was heard). */
  stop(): Promise<string>;
  cancel(): void;
}
export interface VoiceInput {
  readonly available: Signal<boolean>;
  start(context: { label: string; specialty?: string }): Promise<VoiceSession>;
}
export const FE_VOICE = new InjectionToken<VoiceInput | null>('FE_VOICE', { factory: () => null });

/** One of the doctor's own wordings for a field (legacy user_suggestions). */
export interface FieldSuggestion {
  id: string;
  text: string;
}

/**
 * The doctor's suggestion chips (legacy resident-fe `text-input` + `SuggestionsService`): learned by the API
 * when a sheet is finished, read per field, removable. `list(field)` is the top 5 (cached by the provider);
 * `list(field, q)` narrows them while typing. No provider = no chips.
 */
export interface SuggestionSource {
  list(fieldKey: string, q?: string): Promise<FieldSuggestion[]>;
  remove(fieldKey: string, id: string): Promise<void>;
}
export const FE_SUGGESTIONS = new InjectionToken<SuggestionSource | null>('FE_SUGGESTIONS', { factory: () => null });

/** Lets a control talk to the page wizard (repeating-page chips). */
export interface WizardNav {
  /** Jump to a wizard page by id (`field#page#index` for a repetition). */
  goTo(pageId: string): void;
  /** A page's title by key ("Pregnancy"). */
  pageTitle(pageKey: string): string;
}
export const FE_WIZARD = new InjectionToken<WizardNav | null>('FE_WIZARD', { factory: () => null });

/** Unique ids for labels / inputs. */
let seq = 0;
export function feId(prefix: string): string {
  seq += 1;
  return `${prefix}-${seq}`;
}

/** An uploaded picture (a case photo or a template picture): its id (what the answer / the form stores) and its size AS SHOWN. */
export interface AssetRef {
  assetId: string;
  width: number;
  height: number;
  mime: string;
}

/** An uploaded picture, with `url` = a URL the page can show (the host fetched the bytes with the session: an object URL). */
export interface AssetLink extends AssetRef {
  url: string;
}

/** A starter picture of the API (`GET /api/canvas/templates`): product artwork with its tap areas in fractions. */
export interface StarterInfo {
  id: string;
  title: string;
  width: number;
  height: number;
  svgUrl: string;
}
export interface StarterPicture extends StarterInfo {
  regions: { id: string; label: string; points: [number, number][] }[];
}

/**
 * Pictures for the image kinds (plan §4; API docs "Image kinds"). The API stores
 * them as assets (never `data:` in a form or an answer):
 *  - starter pictures (`/api/canvas/templates`), cached;
 *  - template pictures Studio uploads (`POST /api/assets/templates`, owner / admin);
 *  - case photos (`POST /api/case-sheets/{id}/photos`): only while a draft sheet is
 *    open (`canAddPhotos()`), shrunk on the device first;
 *  - `asset(id)`: size + a showable URL (the host fetches the bytes with the session; no signed links).
 * No provider = pictures can't be shown or added (the controls say so in plain words).
 */
export interface AssetStore {
  starters(): Promise<StarterInfo[]>;
  starter(id: string): Promise<StarterPicture>;
  asset(assetId: string): Promise<AssetLink>;
  uploadTemplate(file: Blob): Promise<AssetRef>;
  canAddPhotos(): boolean;
  uploadPhoto(file: Blob): Promise<AssetRef>;
}
export const FE_ASSETS = new InjectionToken<AssetStore | null>('FE_ASSETS', { factory: () => null });
