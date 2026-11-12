import { NgComponentOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import {
  FieldDef,
  FieldWidth,
  FormDefinition,
  IconName,
  LinkDef,
  OptionDef,
  PALETTE,
  PaletteEntry,
  PfIconComponent,
  ShowWhenDef,
  addOption,
  addPage,
  allFields,
  edit,
  findField,
  ifNoneOf,
  isKnownKind,
  kindBuild,
  medicalIcon,
  removeOption,
  sectionKeyOf,
  setLabel,
  supportsCombinations,
  updateField,
  updateOption,
  writeInto,
} from '@prefrontal/forms-engine';
import { PfSelectOption, SelectComponent } from '@prefrontal/shared';
import { DialogService } from '../../../../core/services/dialog.service';
import { checkNoteOf } from '../cortex-import/cortex-import';
import { ConditionsComponent } from '../shared/conditions.component';
import { IconPickerComponent } from '../shared/icon-picker.component';
import { SentenceComponent } from '../shared/sentence.component';
import { CombinationsComponent } from './combinations.component';
import { EditorStore } from './editor-store';
import { FieldActions } from './field-actions';
import { PaletteComponent } from './palette.component';

export type ConfigTab = 'general' | 'validation' | 'options' | 'narrative' | 'conditions' | 'chronological' | 'special';

interface ConfigRow {
  name: string;
  label: string;
  hint?: string;
  type: 'choices' | 'switch' | 'number' | 'text';
  choices: { value: string; label: string }[];
  value: unknown;
}

/** The legacy name of a kind's own settings tab. */
const SPECIAL_TAB: Record<string, string> = {
  grid: 'Textboxes',
  photos: 'Gallery Settings',
  drawing: 'Pad Settings',
  photoMarkup: 'Image & Markers',
  repeat: 'Linked Components',
  repeatPages: 'Linked Pages',
  sidePair: 'Eye Fields',
};

const WIDTHS: PfSelectOption<string>[] = [
  { value: 'full', label: 'Full width' },
  { value: 'half', label: 'Half' },
  { value: 'third', label: 'One third' },
  { value: 'quarter', label: 'One quarter' },
];

/**
 * The legacy Studio's "Configure Field" panel (the right pane when a question is selected), with its tabs:
 * General · Validation · Options · Narrative · Conditions, then Chronological (multiple choice) and the kind's own tab
 * (Textboxes, Gallery Settings, Pad Settings, Image & Markers, Linked Components, Linked Pages …). Everything edits
 * through the one EditorStore, so the canvas, this panel and the narrative never disagree.
 */
@Component({
  selector: 'st-config-panel',
  standalone: true,
  imports: [PfIconComponent, SelectComponent, NgComponentOutlet, CombinationsComponent, ConditionsComponent, SentenceComponent, IconPickerComponent, PaletteComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './config-panel.component.html',
  styleUrls: ['../shared/lg-form.scss', './config-panel.component.scss'],
})
export class ConfigPanelComponent {
  protected readonly store = inject(EditorStore);
  protected readonly actions = inject(FieldActions);
  private readonly dialog = inject(DialogService);

  constructor() {
    // something asked to edit a part of the selected question (Enter to rename, a problem, the narrative): open that tab
    effect(() => {
      const e = this.store.editing();
      const f = this.f();
      if (!e || !f || e.key !== f.key) return;
      untracked(() => {
        const area = e.area;
        if (area === 'label') {
          this.tab.set('general');
          this.store.editing.set(null);
          setTimeout(() => {
            const el = document.getElementById('cfg-label') as HTMLInputElement | null;
            el?.focus();
            el?.select();
          }, 0);
        } else if (area === 'options') this.tab.set('options');
        else if (area === 'showWhen') this.tab.set('conditions');
        else if (area === 'says' || area === 'ifNone') this.tab.set('narrative');
      });
    });
  }

  protected readonly loc = this.store.selected;
  protected readonly f = computed(() => this.loc()?.field ?? null);
  protected readonly owner = computed(() => this.loc()?.ownerField ?? null);
  protected readonly build = computed(() => kindBuild(this.f()?.kind ?? 'text'));
  protected readonly icon = computed(() => this.build().icon as IconName);
  protected readonly known = computed(() => isKnownKind(this.f()?.kind ?? ''));
  protected readonly tab = signal<ConfigTab>('general');
  protected readonly widths = WIDTHS;
  protected readonly expanded = signal<string | null>(null);
  protected readonly iconFor = signal<string | null>(null);

  protected readonly hasOptions = computed(() => !!this.build().starterOptions || (this.f()?.options ?? []).length > 0);
  protected readonly isToggle = computed(() => this.f()?.kind === 'yesno' && this.f()?.config?.['display'] === 'switch' && this.f()?.config?.['labelFallback'] === true);
  protected readonly isMulti = computed(() => this.f()?.kind === 'multi');
  protected readonly isText = computed(() => this.f()?.kind === 'text');
  protected readonly isNumber = computed(() => this.f()?.kind === 'number');
  protected readonly combos = computed(() => supportsCombinations(this.f()));
  protected readonly isYesNo = computed(() => {
    const f = this.f();
    return !!f && ifNoneOf(f) !== null && ifNoneOf(f) !== 'negativeHistory';
  });

  /** Kinds with a settings tab of their own (pictures, tables, repeats …): their settings live there, not in General. */
  protected readonly special = computed(() => {
    const b = this.build();
    return !!b.panel || ['Repeat', 'Picture', 'Table'].includes(b.group) || this.f()?.kind === 'sidePair';
  });
  protected readonly specialLabel = computed(() => SPECIAL_TAB[this.f()?.kind ?? ''] ?? 'Settings');

  protected readonly tabs = computed<{ id: ConfigTab; label: string }[]>(() => {
    const t: { id: ConfigTab; label: string }[] = [
      { id: 'general', label: 'General' },
      { id: 'validation', label: 'Validation' },
    ];
    if (this.hasOptions()) t.push({ id: 'options', label: 'Options' });
    t.push({ id: 'narrative', label: 'Narrative' }, { id: 'conditions', label: 'Conditions' });
    if (this.isMulti()) t.push({ id: 'chronological', label: 'Chronological' });
    if (this.special() || this.combos()) t.push({ id: 'special', label: this.special() ? this.specialLabel() : 'Settings' });
    return t;
  });

  protected readonly activeTab = computed<ConfigTab>(() => (this.tabs().some((x) => x.id === this.tab()) ? this.tab() : 'general'));

  protected setTab(t: ConfigTab): void {
    this.tab.set(t);
  }

  protected close(): void {
    this.store.select(null);
    this.store.settingsOpen.set(false);
  }

  protected backToOwner(): void {
    const o = this.owner();
    if (o) this.store.select(o.key);
  }

  // ---------------- edit helpers ----------------

  protected readonly applier = (change: (f: FieldDef) => void) => this.patch(change);

  protected patch(change: (f: FieldDef) => void): void {
    const key = this.f()?.key;
    if (key) this.store.edit((d) => updateField(d, key, change));
  }

  protected setLabel(v: string): void {
    const key = this.f()?.key;
    if (key && v.trim()) this.store.edit((d) => setLabel(d, key, v.trim()));
  }

  protected setText(prop: 'placeholder' | 'helper', v: string): void {
    this.patch((f) => (f[prop] = v.trim() || undefined));
  }

  protected setWidth(w: string | null): void {
    this.patch((f) => (f.width = !w || w === 'full' ? undefined : (w as FieldWidth)));
  }

  protected readonly toggleRequired = (f: FieldDef) => (f.required = !f.required);

  protected setConfig(name: string, value: unknown): void {
    this.patch((f) => {
      f.config ??= {};
      if (value === '' || value === null || value === undefined) delete f.config[name];
      else f.config[name] = value;
    });
  }

  protected toggleConfig(name: string): void {
    this.setConfig(name, !this.f()?.config?.[name] ? true : null);
  }

  protected num(v: string): number | null {
    const n = Number(String(v).replace(',', '.'));
    return v.trim() === '' || !Number.isFinite(n) ? null : n;
  }

  protected int(v: string): number | null {
    const n = this.num(v);
    return n === null ? null : Math.max(0, Math.round(n));
  }

  protected cfg(name: string): string {
    const v = this.f()?.config?.[name];
    return v === undefined || v === null ? '' : String(v);
  }

  protected cfgOn(name: string): boolean {
    return !!this.f()?.config?.[name];
  }

  // ---------------- General: the legacy "Type" (a family of palette tiles that share one kind) ----------------

  protected readonly typeEntries = computed<PaletteEntry[]>(() => {
    const f = this.f();
    if (!f) return [];
    const seen = new Set<string>();
    return PALETTE.filter((e) => e.kind === f.kind && e.group !== 'Department').filter((e) => {
      const sig = JSON.stringify([e.config ?? {}, e.options?.length ?? 0]);
      if (seen.has(sig)) return false;
      seen.add(sig);
      return true;
    });
  });

  protected readonly typeOptions = computed<PfSelectOption<string>[]>(() => this.typeEntries().map((e) => ({ value: e.id, label: e.label })));

  protected readonly typeNow = computed(() => {
    const f = this.f();
    const cfg = f?.config ?? {};
    let best: { id: string; score: number } | null = null;
    for (const e of this.typeEntries()) {
      const keys = Object.keys(e.config ?? {});
      const ok = keys.every((k) => cfg[k] === e.config![k] || (cfg[k] === undefined && e.config![k] === false));
      if (!ok) continue;
      if (!best || keys.length > best.score) best = { id: e.id, score: keys.length };
    }
    return best?.id ?? this.typeEntries()[0]?.id ?? null;
  });

  protected setType(id: string | null): void {
    const e = this.typeEntries().find((x) => x.id === id);
    if (!e) return;
    const siblings = new Set(this.typeEntries().flatMap((x) => Object.keys(x.config ?? {})));
    this.patch((f) => {
      f.config ??= {};
      for (const k of siblings) delete f.config[k];
      Object.assign(f.config, e.config ?? {});
      if (e.options && (f.options?.length ?? 0) !== 2) f.options = e.options.map((o): OptionDef => ({ key: o.key, label: o.label, subFields: [] }));
    });
  }

  // ---------------- kind settings, in plain words ----------------

  protected readonly config = computed<ConfigRow[]>(() => {
    const f = this.f();
    if (!f) return [];
    const schema = this.store.catalogue().find((k) => k.name === f.kind)?.configSchema?.properties ?? {};
    // a number's lowest / highest are its Validation
    const skip = this.isNumber() ? new Set(['min', 'max']) : new Set<string>();
    return this.build()
      .config.filter((c) => !skip.has(c.name) && (c.name in schema || !this.store.catalogue().length) && (!c.when || c.when(f)))
      .map((c) => {
        const s = schema[c.name] ?? {};
        const t = Array.isArray(s.type) ? s.type.find((x) => x !== 'null') : s.type;
        const enumVals = (s.enum as string[] | undefined) ?? (c.choices ? Object.keys(c.choices) : null);
        const type: ConfigRow['type'] = enumVals ? 'choices' : t === 'boolean' ? 'switch' : t === 'integer' || t === 'number' ? 'number' : 'text';
        return {
          name: c.name,
          label: c.label,
          hint: c.hint,
          type,
          choices: (enumVals ?? []).map((v) => ({ value: String(v), label: c.choices?.[String(v)] ?? String(v) })),
          value: f.config?.[c.name] ?? this.store.catalogue().find((k) => k.name === f.kind)?.defaults?.[c.name],
        };
      });
  });

  // ---------------- General: linking (shares its answer with) ----------------

  private readonly others = computed(() => {
    const d = this.store.def();
    const f = this.f();
    return d && f ? allFields(d).filter((x) => x.key !== f.key) : [];
  });
  protected readonly linkOptions = computed<PfSelectOption<string>[]>(() => this.others().map((x) => ({ value: x.key, label: x.label || 'Untitled question' })));
  protected readonly linked = computed(() => {
    const d = this.store.def();
    const f = this.f();
    const l = d && f ? (d.links ?? []).find((x) => x.fields.some((k) => k.split('::')[0] === f.key)) : null;
    return l ? l.fields.map((k) => k.split('::')[0]).filter((k) => k !== f!.key) : [];
  });
  protected readonly linkWords = computed(() => {
    const d = this.store.def();
    const f = this.f();
    if (!d || !f || !this.linked().length) return '';
    const names = this.linked().map((k) => `“${findField(d, k)?.label ?? 'a removed question'}”`);
    return `When “${f.label}” is answered, ${names.join(' and ')} ${names.length > 1 ? 'get' : 'gets'} the same answer (and the other way round).`;
  });
  protected setLinks(keys: string[]): void {
    const f = this.f();
    if (!f) return;
    this.store.edit((d) =>
      edit(d, (x) => {
        const rest = (x.links ?? []).filter((l) => !l.fields.some((k) => k.split('::')[0] === f.key));
        const link: LinkDef = { name: `${f.label} shared`, fields: [f.key, ...keys], mode: 'mirror' };
        x.links = keys.length ? [...rest, link] : rest;
      }),
    );
  }

  // ---------------- Options ----------------

  protected readonly pageOptions = computed<PfSelectOption<string>[]>(() => [
    { value: '', label: 'No linked page' },
    ...(this.store.def()?.pages ?? []).map((p) => ({ value: p.key, label: p.title || 'Untitled page' })),
  ]);

  protected toggleOption(key: string): void {
    this.expanded.set(this.expanded() === key ? null : key);
  }

  protected addOption(): void {
    const key = this.f()?.key;
    if (!key) return;
    let made = '';
    const n = (this.f()?.options?.length ?? 0) + 1;
    this.store.edit((d) => {
      const r = addOption(d, key, `Option ${n}`);
      made = r.key;
      return r.def;
    });
    this.expanded.set(made);
  }

  protected setOption(optionKey: string, change: (o: OptionDef) => void): void {
    const key = this.f()?.key;
    if (key) this.store.edit((d) => updateOption(d, key, optionKey, change));
  }

  protected setOptionText(optionKey: string, prop: 'label' | 'says' | 'description' | 'color', v: string): void {
    const t = v.trim();
    if (prop === 'label' && !t) return;
    this.setOption(optionKey, (o) => {
      if (prop === 'label') o.label = t;
      else (o as unknown as Record<string, unknown>)[prop] = t || undefined;
    });
  }

  protected setOptionIcon(optionKey: string, v: string | null): void {
    this.setOption(optionKey, (o) => (o.icon = v ?? undefined));
    this.iconFor.set(null);
  }

  protected setLinkedPage(optionKey: string, page: string | null): void {
    this.setOption(optionKey, (o) => (o.linkedPage = page || undefined));
  }

  protected newLinkedPage(o: OptionDef): void {
    const owner = this.f();
    if (!owner) return;
    let pageKey = '';
    this.store.edit((d) => {
      const r = addPage(d, o.label);
      pageKey = r.key;
      return updateOption(r.def, owner.key, o.key, (x) => (x.linkedPage = pageKey));
    });
  }

  protected async removeOption(o: OptionDef): Promise<void> {
    const key = this.f()?.key;
    if (!key) return;
    const n = (o.subFields ?? []).length;
    if (n) {
      const ok = await this.dialog.confirm({
        title: `Delete the option “${o.label}”?`,
        message: `Its ${n} sub-field${n === 1 ? '' : 's'} go with it. You can undo this.`,
        confirmLabel: 'Delete',
        cancelLabel: 'Keep it',
        tone: 'danger',
      });
      if (!ok) return;
    }
    this.store.edit((d) => removeOption(d, key, o.key));
  }

  protected optionGrip(e: PointerEvent, i: number): void {
    this.actions.drag.start(e, `options:${this.f()!.key}`, i);
  }

  protected addSubField(optionKey: string): void {
    const key = this.f()?.key;
    if (key) this.store.paletteAt.set({ option: { fieldKey: key, optionKey } });
  }

  protected isPaletteFor(optionKey: string): boolean {
    const p = this.store.paletteAt();
    return !!p?.option && p.option.fieldKey === this.f()?.key && p.option.optionKey === optionKey;
  }

  protected subIcon(s: FieldDef): IconName {
    return kindBuild(s.kind).icon as IconName;
  }

  protected readonly checkNote = computed(() => (this.f() ? checkNoteOf(this.f()!) : ''));
  protected subCheck(s: FieldDef): boolean {
    return !!checkNoteOf(s);
  }

  protected hasNarrative(s: FieldDef): boolean {
    return s.says?.include !== false && !!(s.says?.sentence || s.says?.whenTrue || (s.options ?? []).some((o) => o.says));
  }

  protected removeSub(s: FieldDef): void {
    this.actions.removeMany([s.key]);
  }

  protected glyph(v: string | undefined): IconName | null {
    return medicalIcon(v);
  }

  protected readonly colorOptions = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#64748b'];

  // ---------------- Chronological (multiple choice: order of the linked pages) ----------------

  protected readonly chrono = computed(() => {
    const c = (this.f()?.config?.['chronological'] ?? {}) as { enabled?: boolean; sortOrder?: string; nested?: boolean | { enabled?: boolean; trigger?: string; sortBy?: string; sortOrder?: string } };
    const n = typeof c.nested === 'object' && c.nested ? c.nested : { enabled: c.nested === true };
    return { enabled: !!c.enabled, sortOrder: c.sortOrder === 'asc' ? 'asc' : 'desc', nested: { enabled: !!n.enabled, trigger: (n as { trigger?: string }).trigger ?? '', sortBy: (n as { sortBy?: string }).sortBy ?? 'duration', sortOrder: (n as { sortOrder?: string }).sortOrder === 'asc' ? 'asc' : 'desc' } };
  });
  protected readonly sortChoices: PfSelectOption<string>[] = [
    { value: 'desc', label: 'Longest duration first (descending)' },
    { value: 'asc', label: 'Shortest duration first (ascending)' },
  ];
  protected readonly nestedSortChoices: PfSelectOption<string>[] = [
    { value: 'duration', label: 'Duration' },
    { value: 'severity', label: 'Severity' },
    { value: 'order', label: 'Order' },
  ];

  protected setChrono(change: (c: Record<string, unknown>) => void): void {
    const cur = JSON.parse(JSON.stringify(this.f()?.config?.['chronological'] ?? {})) as Record<string, unknown>;
    change(cur);
    const empty = !cur['enabled'] && !cur['nested'];
    this.setConfig('chronological', empty ? null : cur);
  }

  protected readonly toggleChrono = (c: Record<string, unknown>) => {
    c['enabled'] = !c['enabled'];
  };
  protected readonly toggleNested = (c: Record<string, unknown>) => {
    const n = c['nested'];
    const on = typeof n === 'object' && n ? !!(n as { enabled?: boolean }).enabled : n === true;
    c['nested'] = on ? false : { enabled: true, sortBy: 'duration', sortOrder: 'desc' };
  };
  protected sortBy(v: string | null): (c: Record<string, unknown>) => void {
    return (c) => {
      c['sortOrder'] = v === 'asc' ? 'asc' : 'desc';
    };
  }
  protected nestedProp(prop: string, v: string | null): (c: Record<string, unknown>) => void {
    return (c) => {
      const n = typeof c['nested'] === 'object' && c['nested'] ? (c['nested'] as Record<string, unknown>) : { enabled: true };
      n[prop] = v ?? undefined;
      c['nested'] = n;
    };
  }

  protected readonly linkedOptionsMissingDuration = computed(() => (this.f()?.options ?? []).filter((o) => o.linkedPage && !(o.subFields ?? []).some((s) => s.kind === 'duration')));
  protected readonly optionsWithoutPage = computed(() => (this.f()?.options ?? []).filter((o) => !o.linkedPage));
  protected readonly triggerOptions = computed<PfSelectOption<string>[]>(() => {
    const d = this.store.def();
    if (!d) return [];
    const pages = new Set((this.f()?.options ?? []).map((o) => o.linkedPage).filter((x): x is string => !!x));
    return d.pages
      .filter((p) => pages.has(p.key))
      .flatMap((p) => p.fields.filter((x) => x.kind === 'multi').map((x) => ({ value: x.key, label: `${p.title}: ${x.label}` })));
  });

  // ---------------- Narrative ----------------

  private readonly options = computed(() => this.f()?.options ?? []);
  protected readonly saysMode = computed<'sentence' | 'firstOption' | 'whenTrue' | 'none'>(() => {
    const ifNone = ifNoneOf(this.f() ?? ({ kind: 'text', options: [] } as unknown as FieldDef));
    if (ifNone === 'whenFalse') return 'whenTrue';
    if (ifNone === 'noOption') return 'firstOption';
    return this.known() ? 'sentence' : 'none';
  });
  protected readonly saysLabel = computed(() => {
    switch (this.saysMode()) {
      case 'firstOption':
        return `If ${this.options()[0]?.label ?? 'Yes'}, says`;
      case 'whenTrue':
        return 'When ticked, says';
      default:
        return 'Narrative sentence';
    }
  });
  protected readonly saysTokens = computed(() => (this.saysMode() === 'sentence' ? (this.build().sentenceTokens ?? [{ text: '{value}', label: 'the answer' }]) : []));
  protected readonly saysValue = computed(() => {
    const f = this.f();
    if (!f) return '';
    switch (this.saysMode()) {
      case 'firstOption':
        return f.options?.[0]?.says ?? '';
      case 'whenTrue':
        return f.says?.whenTrue ?? '';
      default:
        return f.says?.sentence ?? '';
    }
  });
  protected readonly ifNone = computed(() => (this.f() ? ifNoneOf(this.f()!) : null));
  protected readonly ifNoneLabel = computed(() => {
    switch (this.ifNone()) {
      case 'noOption':
        return `If ${this.options()[1]?.label ?? 'No'}, says`;
      case 'whenFalse':
        return 'When not ticked, says';
      default:
        return '';
    }
  });
  protected readonly ifNoneValue = computed(() => {
    const f = this.f();
    if (!f) return '';
    if (this.ifNone() === 'noOption') return f.options?.[1]?.says ?? '';
    if (this.ifNone() === 'whenFalse') return f.says?.whenFalse ?? '';
    return '';
  });
  protected readonly negative = computed(() => this.f()?.says?.negativeHistory ?? { enabled: false, prefix: 'Denies' });
  protected readonly sectionOptions = computed<PfSelectOption<string>[]>(() => [
    { value: '', label: 'Not in the narrative' },
    ...(this.store.def()?.narrative?.sections ?? []).map((s) => ({ value: s.key, label: s.title || 'Untitled section' })),
  ]);
  protected readonly writesInto = computed(() => {
    const d = this.store.def();
    const f = this.f();
    return d && f ? (sectionKeyOf(d, f) ?? '') : '';
  });
  /** A follow-up writes with its owner's paragraph: it has no section of its own. */
  protected readonly isSub = computed(() => !!this.owner());

  protected readonly toggleInclude = (f: FieldDef) => {
    f.says ??= { include: true };
    f.says.include = f.says.include === false;
  };
  protected readonly toggleHeading = (f: FieldDef) => {
    f.says ??= { include: true };
    f.says.subheading = !f.says.subheading;
  };
  protected setAffix(which: 'prefix' | 'suffix', v: string): void {
    this.patch((f) => {
      f.says ??= { include: true };
      f.says[which] = v || undefined;
    });
  }

  protected saveSays(text: string): void {
    const key = this.f()?.key;
    if (!key) return;
    const mode = this.saysMode();
    this.store.edit((d) => {
      if (mode === 'firstOption') {
        const o = findField(d, key)?.options?.[0];
        return o ? updateOption(d, key, o.key, (x) => (x.says = text || undefined)) : d;
      }
      return updateField(d, key, (f) => {
        f.says ??= { include: true };
        if (mode === 'whenTrue') f.says.whenTrue = text || undefined;
        else f.says.sentence = text || undefined;
      });
    });
    this.store.editing.set(null);
  }

  protected saveIfNone(text: string): void {
    const key = this.f()?.key;
    if (!key) return;
    this.store.edit((d) => {
      if (this.ifNone() === 'noOption') {
        const o = findField(d, key)?.options?.[1];
        return o ? updateOption(d, key, o.key, (x) => (x.says = text || undefined)) : d;
      }
      return updateField(d, key, (f) => {
        f.says ??= { include: true };
        f.says.whenFalse = text || undefined;
      });
    });
    this.store.editing.set(null);
  }

  protected setNegative(enabled: boolean, prefix?: string): void {
    this.patch((f) => {
      f.says ??= { include: true };
      f.says.negativeHistory = { enabled, prefix: (prefix ?? f.says.negativeHistory?.prefix ?? 'Denies').trim() || 'Denies' };
    });
  }

  protected setSection(key: string | null): void {
    const f = this.f()?.key;
    if (f) this.store.edit((d) => writeInto(d, f, key || null));
  }

  // ---------------- Conditions ----------------

  protected setShowWhen(sw: ShowWhenDef | null): void {
    this.patch((f) => (f.showWhen = sw));
  }

  protected readonly def = computed<FormDefinition | null>(() => this.store.def());

  // ---------------- header ----------------

  protected saveTemplate(): void {
    const k = this.f()?.key;
    if (k) void this.actions.saveAsTemplate(k);
  }

  protected removeThis(): void {
    const key = this.f()?.key;
    if (!key) return;
    this.actions.removeMany([key]);
    this.store.select(null);
  }

}
