import {
  ChangeDetectionStrategy, Component, ElementRef, OnDestroy, ViewChild, computed, inject, input, signal,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { DialogService } from '../../core/services/dialog.service';
import { ApiError } from '../../shared/models/api-response.model';
import { NumberInputComponent } from '../../shared/primitives/number-input.component';
import { PfSelectOption, SelectComponent } from '../../shared/primitives/select.component';
import { AutoAssignAdapter } from './adapters/auto-assign.adapter';
import { hasAny } from './settings-access';
import { SETTINGS_GROUPS } from './settings-registry';
import { SettingsStore } from './settings-store.service';
import { ControlDef, FieldDef, SettingDef, SettingScope } from './settings.model';

export type RowStatus = 'idle' | 'saving' | 'saved' | 'error';

/** Logo uploads: same cap as the Branding page. */
export const LOGO_MAX_BYTES = 100 * 1024;

/**
 * One settings row: bold label, grey one-liner, the control on the right and
 * a scope chip under the label. Every change saves at once (optimistic):
 * the new value shows immediately, "Saved" + a violet check fades in for
 * 1.5 s, and on an error the value goes back with ONE red line saying why.
 * Text saves on blur or Enter; numbers after a short pause.
 */
@Component({
  selector: 'pf-setting-row',
  standalone: true,
  imports: [NgTemplateOutlet, NumberInputComponent, SelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './setting-row.component.html',
  styleUrl: './setting-row.component.scss',
  host: {
    class: 'pf-sr',
    '[attr.id]': "'row-' + def().id",
    '[attr.data-setting]': 'def().id',
    '[class.pf-sr--stack]': 'stacked()',
    '[class.pf-sr--error]': "status() === 'error'",
  },
})
export class SettingRowComponent implements OnDestroy {
  protected readonly store = inject(SettingsStore);
  private readonly dialog = inject(DialogService);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  protected readonly autoAssign = inject(AutoAssignAdapter);

  readonly def = input.required<SettingDef>();
  /** Search results show the group as a small breadcrumb. */
  readonly crumb = input<boolean>(false);
  /** Screen sheets narrow the Alerts row to that screen's modules. */
  readonly alertModules = input<string[] | null>(null);

  readonly status = signal<RowStatus>('idle');
  readonly error = signal<string | null>(null);
  /** Optimistic values by key (undefined = show the store's value). */
  private readonly local = signal<Record<string, unknown>>({});
  private seq = 0;
  private savedTimer: ReturnType<typeof setTimeout> | null = null;
  private numTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /** Composite rows: the inline editor is open. */
  readonly editing = signal(false);

  @ViewChild('logoInput') logoInput?: ElementRef<HTMLInputElement>;

  readonly groupLabel = computed(() => SETTINGS_GROUPS.find((g) => g.id === this.def().group)?.label ?? '');
  readonly loaded = computed(() => this.store.loaded(this.def()));
  readonly c = computed<ControlDef>(() => this.def().control);

  /** Controls that drop to their own full-width line on phones. */
  readonly stacked = computed(() => !['switch', 'readonly', 'link'].includes(this.c().kind));

  readKey(key: string): unknown {
    const l = this.local();
    return key in l ? l[key] : this.store.read(this.def(), key);
  }
  readonly value = computed(() => this.readKey(this.def().key));

  // ── scope chip ────────────────────────────────────────────────────────
  readonly scopeText = computed(() => scopeLabel(this.def().scope, this.store.branchName()));
  readonly branchOptions = computed<PfSelectOption<string>[]>(() =>
    this.store.branches().map((b) => ({ value: b.id, label: b.name })));
  readonly canPickBranch = computed(() =>
    (this.def().scope === 'branch' || this.def().scope === 'dept') && this.store.branches().length > 1);

  // ── helpers for the template ─────────────────────────────────────────
  readonly linkAllowed = computed(() => {
    const l = this.c().link;
    return !!l && hasAny(this.auth.user()?.permissions ?? [], l.permission ?? []);
  });
  readonly readonlyText = computed(() => {
    const p = this.c().preview;
    return p ? p((k) => this.readKey(k)) : String(this.value() ?? '');
  });
  readonly previewText = computed(() => {
    const p = this.c().preview;
    return p ? p((k) => this.readKey(k)) : '';
  });
  readonly selectOptions = computed<PfSelectOption<string>[]>(() =>
    (this.c().options ?? []).map((o) => ({ value: String(o.value), label: o.label })));

  fieldVisible(f: FieldDef): boolean { return f.visibleWhen ? f.visibleWhen((k) => this.readKey(k)) : true; }
  fieldValue(f: FieldDef): unknown { return this.readKey(f.key); }
  optionPressed(v: unknown, opt: unknown): boolean { return String(v) === String(opt); }
  asString(v: unknown): string { return v === null || v === undefined ? '' : String(v); }
  asNumber(v: unknown): number | null {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  selectOptionsFor(c: ControlDef): PfSelectOption<string>[] {
    return (c.options ?? []).map((o) => ({ value: String(o.value), label: o.label }));
  }
  /** Option value back to its real type (numbers / booleans stay typed). */
  private typed(c: ControlDef, raw: string): unknown {
    const o = (c.options ?? []).find((x) => String(x.value) === raw);
    return o ? o.value : raw;
  }

  // ── writing ───────────────────────────────────────────────────────────
  async commit(value: unknown, key: string = this.def().key): Promise<void> {
    const prev = this.readKey(key);
    if (same(prev, value)) return;
    const d = this.def();
    if (d.confirm && d.control.kind !== 'composite') {
      const ok = await this.dialog.confirm({
        title: d.confirm.title, message: d.confirm.message,
        confirmLabel: d.confirm.confirmLabel ?? 'Change', tone: d.confirm.tone ?? 'danger',
      });
      if (!ok) { this.bumpLocal(key, undefined); return; }
    }
    const my = ++this.seq;
    this.bumpLocal(key, value);
    this.error.set(null);
    this.status.set('saving');
    try {
      await this.store.write(d, value, key);
      if (my !== this.seq) return;
      this.bumpLocal(key, undefined);
      this.status.set('saved');
      if (this.savedTimer) clearTimeout(this.savedTimer);
      this.savedTimer = setTimeout(() => { if (this.status() === 'saved') this.status.set('idle'); }, 1500);
    } catch (e) {
      if (my !== this.seq) return;
      this.bumpLocal(key, undefined);          // revert to the store's value
      this.status.set('error');
      this.error.set(oneLine(ApiError.from(e).message));
    }
  }

  private bumpLocal(key: string, v: unknown): void {
    this.local.update((l) => {
      const n = { ...l };
      if (v === undefined) delete n[key]; else n[key] = v;
      return n;
    });
  }

  toggle(key: string = this.def().key): void { void this.commit(!(this.readKey(key) === true), key); }

  pick(c: ControlDef, raw: string, key: string = this.def().key): void { void this.commit(this.typed(c, raw), key); }

  /** Numbers save after a short pause (the stepper repeats while held). */
  numberChanged(v: number | null, key: string = this.def().key): void {
    this.bumpLocal(key, v);
    const t = this.numTimers.get(key);
    if (t) clearTimeout(t);
    this.numTimers.set(key, setTimeout(() => {
      this.numTimers.delete(key);
      const pending = this.local()[key];
      this.bumpLocal(key, undefined);
      void this.commit(pending as number | null, key);
    }, 700));
  }

  textInput(ev: Event, c: ControlDef = this.c()): void {
    const el = ev.target as HTMLInputElement;
    const clean = c.sanitize ? c.sanitize(el.value) : el.value;
    if (clean !== el.value) el.value = clean;
  }
  textCommit(ev: Event, key: string = this.def().key): void {
    const el = ev.target as HTMLInputElement;
    const v = el.value;
    if (same(v, this.asString(this.readKey(key)))) return;
    void this.commit(v, key).then(() => { el.value = this.asString(this.readKey(key)); });
  }
  textEnter(ev: Event): void { (ev.target as HTMLInputElement).blur(); }

  async openEditor(): Promise<void> {
    if (this.editing()) { this.editing.set(false); return; }
    const conf = this.def().confirm;
    if (conf) {
      const ok = await this.dialog.confirm({
        title: conf.title, message: conf.message,
        confirmLabel: conf.confirmLabel ?? 'Change', tone: conf.tone ?? 'primary',
      });
      if (!ok) return;
    }
    this.editing.set(true);
  }

  go(href: string): void { void this.router.navigateByUrl(href); }

  // ── logo ──────────────────────────────────────────────────────────────
  pickLogo(): void { this.logoInput?.nativeElement.click(); }
  onLogo(files: FileList | null): void {
    const f = files?.[0];
    if (this.logoInput) this.logoInput.nativeElement.value = '';
    if (!f) return;
    if (!f.type.startsWith('image/')) { this.fail('Pick an image file.'); return; }
    if (f.size > LOGO_MAX_BYTES) { this.fail(`That file is ${Math.round(f.size / 1024)} KB. Keep it under 100 KB.`); return; }
    const r = new FileReader();
    r.onload = () => void this.commit(String(r.result ?? ''));
    r.onerror = () => this.fail('Could not read the file.');
    r.readAsDataURL(f);
  }
  private fail(msg: string): void { this.status.set('error'); this.error.set(msg); }

  // ── department pools ──────────────────────────────────────────────────
  readonly departments = computed(() => this.autoAssign.departments(this.store.scopeBranch(this.def())));
  poolKey(deptId: string): string { return `${this.c().leg ?? 'tech'}:${deptId}`; }
  poolValues(deptId: string): string[] {
    const v = this.readKey(this.poolKey(deptId));
    return Array.isArray(v) ? (v as string[]) : [];
  }

  ngOnDestroy(): void {
    if (this.savedTimer) clearTimeout(this.savedTimer);
    this.numTimers.forEach((t) => clearTimeout(t));
  }
}

export function scopeLabel(scope: SettingScope, branchName: string): string {
  switch (scope) {
    case 'tenant': return 'All branches';
    case 'branch': return `This branch: ${branchName}`;
    case 'dept': return `Per department · ${branchName}`;
    case 'device': return 'This device';
    case 'user': return 'Only me';
    default: return '';
  }
}

function same(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
  const na = a === undefined || a === '' ? null : a;
  const nb = b === undefined || b === '' ? null : b;
  return na === nb;
}

/** Errors are ONE line — the first sentence, capped. */
function oneLine(msg: string): string {
  const s = (msg || 'Could not save.').split(/\n/)[0].trim();
  return s.length > 120 ? s.slice(0, 117) + '…' : s;
}
