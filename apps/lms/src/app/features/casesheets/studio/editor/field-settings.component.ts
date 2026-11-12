import { NgComponentOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import {
  FieldDef,
  FieldWidth,
  FormDefinition,
  LinkDef,
  TriggerDef,
  addOption,
  allFields,
  describeCondition,
  edit,
  findField,
  ifNoneOf,
  kindBuild,
  removeOption,
  sectionKeyOf,
  setLabel,
  updateField,
  updateOption,
  valueChoices,
} from '@prefrontal/forms-engine';
import { IconName, PfIconComponent } from '@prefrontal/forms-engine';
import { PfSelectOption, SelectComponent } from '@prefrontal/shared';
import { EditorStore } from './editor-store';
import { FieldActions } from './field-actions';

interface ConfigRow {
  name: string;
  label: string;
  hint?: string;
  type: 'choices' | 'switch' | 'number' | 'text';
  choices: { value: string; label: string }[];
  value: unknown;
}

/**
 * The selected question's settings (the right card; a sheet on narrow
 * screens): its name and hint, its choices each with its own words and
 * follow-ups, how it looks (from the catalogue's settings, in plain words),
 * and "More" — words before / after, shared answers, "when answered, fill
 * in…", time order — each written as a sentence.
 */
@Component({
  selector: 'st-field-settings',
  standalone: true,
  imports: [PfIconComponent, SelectComponent, NgComponentOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './field-settings.component.html',
  styleUrl: './field-settings.component.scss',
})
export class FieldSettingsComponent {
  protected readonly store = inject(EditorStore);
  protected readonly actions = inject(FieldActions);

  protected readonly loc = this.store.selected;
  protected readonly f = computed(() => this.loc()?.field ?? null);
  protected readonly build = computed(() => kindBuild(this.f()?.kind ?? 'text'));
  protected readonly icon = computed(() => this.build().icon as IconName);
  protected readonly hasOptions = computed(() => !!this.build().starterOptions || (this.f()?.options ?? []).length > 0);
  protected readonly isYesNo = computed(() => {
    const f = this.f();
    return !!f && ifNoneOf(f) !== null && ifNoneOf(f) !== 'negativeHistory';
  });
  protected readonly moreOpen = signal(false);
  protected readonly newChoice = signal('');

  protected readonly widths: { value: FieldWidth; label: string }[] = [
    { value: 'full', label: 'Whole row' },
    { value: 'half', label: 'Half' },
    { value: 'third', label: 'A third' },
  ];

  /** The kind's settings: the catalogue's schema, in the kind descriptor's words and order. */
  protected readonly config = computed<ConfigRow[]>(() => {
    const f = this.f();
    if (!f) return [];
    const schema = this.store.catalogue().find((k) => k.name === f.kind)?.configSchema?.properties ?? {};
    return this.build()
      .config.filter((c) => (c.name in schema || !this.store.catalogue().length) && (!c.when || c.when(f)))
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

  // ---------------- question ----------------

  protected setLabel(v: string): void {
    const key = this.f()?.key;
    if (key && v.trim()) this.store.edit((d) => setLabel(d, key, v.trim()));
  }

  /** The kind's own panel writes through this (one Studio edit per change). */
  protected readonly applier = (change: (f: FieldDef) => void) => this.patch(change);

  protected patch(change: (f: FieldDef) => void): void {
    const key = this.f()?.key;
    if (key) this.store.edit((d) => updateField(d, key, change));
  }

  // small edit builders the template passes to patch() / setChoice()
  protected readonly toggleRequired = (f: FieldDef) => (f.required = !f.required);
  protected readonly toggleHeading = (f: FieldDef) => {
    f.says ??= { include: true };
    f.says.subheading = !f.says.subheading;
  };
  protected readonly toggleInclude = (f: FieldDef) => {
    f.says ??= { include: true };
    f.says.include = f.says.include === false;
  };
  protected setHelper(v: string) {
    return (f: FieldDef) => (f.helper = v.trim() || undefined);
  }
  protected setWidth(w: FieldWidth) {
    return (f: FieldDef) => (f.width = w === 'full' ? undefined : w);
  }
  protected setPrefix(v: string) {
    return (f: FieldDef) => {
      f.says ??= { include: true };
      f.says.prefix = v || undefined;
    };
  }
  protected setSuffix(v: string) {
    return (f: FieldDef) => {
      f.says ??= { include: true };
      f.says.suffix = v || undefined;
    };
  }
  protected setOptionLabel(v: string) {
    return (o: NonNullable<FieldDef['options']>[number]) => {
      if (v.trim()) o.label = v.trim();
    };
  }
  protected setOptionSays(v: string) {
    return (o: NonNullable<FieldDef['options']>[number]) => (o.says = v.trim() || undefined);
  }

  protected setConfig(name: string, value: unknown): void {
    this.patch((f) => {
      f.config ??= {};
      if (value === '' || value === null || value === undefined) delete f.config[name];
      else f.config[name] = value;
    });
  }

  protected num(v: string): number | null {
    const n = Number(String(v).replace(',', '.'));
    return v.trim() === '' || !Number.isFinite(n) ? null : n;
  }

  // ---------------- choices ----------------

  protected addChoice(): void {
    const key = this.f()?.key;
    const label = this.newChoice().trim();
    if (!key || !label) return;
    this.store.edit((d) => addOption(d, key, label).def);
    this.newChoice.set('');
  }

  protected setChoice(optionKey: string, change: (o: NonNullable<FieldDef['options']>[number]) => void): void {
    const key = this.f()?.key;
    if (key) this.store.edit((d) => updateOption(d, key, optionKey, change));
  }

  protected removeChoice(optionKey: string): void {
    const key = this.f()?.key;
    if (key) this.store.edit((d) => removeOption(d, key, optionKey));
  }

  protected followUp(optionKey: string): void {
    const key = this.f()?.key;
    if (!key) return;
    this.store.settingsOpen.set(false);
    this.store.paletteAt.set({ option: { fieldKey: key, optionKey } });
    this.store.jumpTo(key);
  }

  protected choiceGrip(e: PointerEvent, i: number): void {
    this.actions.drag.start(e, `options:${this.f()!.key}`, i);
  }

  // ---------------- more: links ----------------

  private readonly others = computed(() => {
    const d = this.store.def();
    const f = this.f();
    return d && f ? allFields(d).filter((x) => x.key !== f.key) : [];
  });

  protected readonly linkOptions = computed<PfSelectOption<string>[]>(() =>
    this.others().map((x) => ({ value: x.key, label: x.label || 'Untitled question' })),
  );

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

  // ---------------- more: triggers ----------------

  protected readonly myTriggers = computed(() => {
    const d = this.store.def();
    const f = this.f();
    if (!d || !f) return [];
    return (d.triggers ?? [])
      .map((t, i) => ({ t, i }))
      .filter(({ t }) => t.conditions.some((c) => c.source.split('::')[0] === f.key))
      .map(({ t, i }) => ({ i, words: this.triggerWords(d, t) }));
  });

  private triggerWords(d: FormDefinition, t: TriggerDef): string {
    const when = t.conditions.map((c) => describeCondition(d, { field: c.source.split('::')[0], op: c.op, value: c.value })).join(' and ');
    const then = t.actions
      .map((a) => {
        const target = findField(d, a.target.split('::')[0]);
        const opt = target?.options?.find((o) => o.key === a.value)?.label;
        return `fill in “${target?.label ?? 'a removed question'}” with ${opt ?? a.value ?? '…'}`;
      })
      .join(' and ');
    return `When ${when}, ${then}.`;
  }

  protected readonly tWhen = signal<string | null>(null);
  protected readonly tTarget = signal<string | null>(null);
  protected readonly tValue = signal<string | null>(null);
  protected readonly myValues = computed(() => (this.f() && this.store.def() ? valueChoices(this.store.def()!, this.f()!.key).options : []));
  protected readonly targetValues = computed(() => {
    const t = this.tTarget();
    return t && this.store.def() ? valueChoices(this.store.def()!, t) : { kind: 'none' as const, options: [] };
  });

  protected addTrigger(): void {
    const f = this.f();
    const when = this.tWhen();
    const target = this.tTarget();
    const value = this.tValue();
    if (!f || !when || !target || value === null || value === '') return;
    this.store.edit((d) =>
      edit(d, (x) => {
        x.triggers = [
          ...(x.triggers ?? []),
          {
            name: `${f.label} fills ${findField(x, target)?.label ?? target}`,
            enabled: true,
            logic: 'and',
            conditions: [{ source: f.key, op: 'equals', value: when }],
            actions: [{ target, action: 'setValue', value }],
          },
        ];
      }),
    );
    this.tWhen.set(null);
    this.tTarget.set(null);
    this.tValue.set(null);
  }

  protected removeTrigger(i: number): void {
    this.store.edit((d) => edit(d, (x) => (x.triggers = (x.triggers ?? []).filter((_, j) => j !== i))));
  }

  // ---------------- more: chronology (its paragraph's order) ----------------

  protected readonly section = computed(() => {
    const d = this.store.def();
    const f = this.f();
    const k = d && f ? sectionKeyOf(d, f) : null;
    return k ? (d!.narrative?.sections ?? []).find((s) => s.key === k) ?? null : null;
  });

  protected readonly chronological = computed(() => {
    const s = this.section() as { sorting?: { enabled?: boolean } } | null;
    return !!s?.sorting?.enabled;
  });

  protected setChronology(on: boolean): void {
    const key = this.section()?.key;
    if (!key) return;
    this.store.edit((d) =>
      edit(d, (x) => {
        const s = x.narrative?.sections.find((y) => y.key === key);
        if (s) s['sorting'] = on ? { enabled: true, sortBy: 'duration', sortOrder: 'desc' } : { enabled: false };
      }),
    );
  }
}
