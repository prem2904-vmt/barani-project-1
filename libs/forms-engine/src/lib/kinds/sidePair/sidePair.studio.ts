import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { ApplyFieldChange, opt } from '../../build/contract';
import { FieldDef, OptionDef } from '../../core/types';
import { PfIconComponent, PfSelectOption, SelectComponent } from '../../kit';
import { SHORTHAND_BUILD, PRESET_WORDS } from '../shorthand/shorthand.build';
import { SHORTHAND_PRESETS, presetOf } from '../shorthand/shorthand-math';
import { PAIR_INNER_KINDS, innerOf } from './side-pair-model';

/** What a new question for each side starts with, by kind (kept here: the kind descriptors import this panel). */
const STARTERS: Record<string, { config: Record<string, unknown>; options?: OptionDef[] }> = {
  text: { config: { multiline: false, format: 'plain', voice: true, suggestions: true } },
  number: { config: {} },
  measure: { config: { min: 0, max: 200, step: 1, unit: '' } },
  choice: { config: { display: 'buttons' }, options: [opt('first', 'First choice'), opt('second', 'Second choice')] },
  multi: { config: { display: 'chips' }, options: [opt('first', 'First choice'), opt('second', 'Second choice'), opt('third', 'Third choice')] },
  shorthand: { config: { ...SHORTHAND_BUILD.starterConfig } },
};

const KIND_NAMES: Record<string, string> = {
  text: 'Text',
  number: 'Number',
  measure: 'Reading on a slider',
  choice: 'One choice',
  multi: 'Multiple choice',
  shorthand: 'Clinical shorthand',
};

/**
 * Studio panel for `sidePair`: which question is asked for each side, and what that question needs (its choices, its unit,
 * its notation). The question is the field's one child; both sides share it. Studio chrome: kit-sized controls.
 */
@Component({
  selector: 'fe-side-pair-panel',
  standalone: true,
  imports: [SelectComponent, PfIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      :host {
        display: grid;
        gap: 12px;
      }
      .sp-h {
        margin: 0;
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--text-tertiary);
      }
      .sp-note {
        font-size: 13px;
        color: var(--text-tertiary);
      }
      .sp-row {
        display: grid;
        gap: 6px;
      }
      .sp-lbl {
        font-size: 14px;
        font-weight: 600;
        color: var(--text-primary);
      }
      .sp-choice {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .sp-choice .pf-input,
      .sp-add .pf-input {
        flex: 1 1 auto;
        min-width: 0;
      }
      .sp-add {
        display: flex;
        gap: 8px;
      }
      .sp-nums {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }
      .sp-nums .pf-input {
        max-width: 110px;
      }
    `,
  ],
  template: `
    @if (inner(); as q) {
      <h3 class="sp-h">Asked for each side <span class="sp-note">the same question, once per side</span></h3>
      <div class="sp-row" data-sp="kind">
        <span class="sp-lbl" id="sp-kind-lbl">Question</span>
        <pf-select [options]="kindOptions" [value]="q.kind" (valueChange)="setKind($event)" />
      </div>

      @if (q.kind === 'choice' || q.kind === 'multi') {
        <div class="sp-row" data-sp="choices">
          <span class="sp-lbl">Choices</span>
          @for (o of q.options ?? []; track o.key; let i = $index) {
            <div class="sp-choice">
              <input class="pf-input" type="text" [attr.aria-label]="'Choice ' + (i + 1)" [value]="o.label" (change)="renameChoice(o.key, $any($event.target).value)" />
              <button type="button" class="pf-btn pf-btn--icon" [attr.aria-label]="'Remove ' + o.label" (click)="removeChoice(o.key)">
                <pf-icon name="x" [size]="18" />
              </button>
            </div>
          }
          <div class="sp-add">
            <input
              class="pf-input"
              type="text"
              aria-label="New choice"
              placeholder="New choice"
              [value]="newChoice()"
              (input)="newChoice.set($any($event.target).value)"
              (keydown.enter)="addChoice()"
            />
            <button type="button" class="pf-btn pf-btn--secondary" [disabled]="!newChoice().trim()" (click)="addChoice()">
              <pf-icon name="plus" [size]="18" /> Add
            </button>
          </div>
        </div>
      }

      @if (q.kind === 'number' || q.kind === 'measure') {
        <div class="sp-row" data-sp="numbers">
          <div class="sp-nums">
            <label class="sp-row">
              <span class="sp-lbl">Unit</span>
              <input class="pf-input" type="text" [value]="text(q, 'unit')" (change)="setConfig('unit', $any($event.target).value)" />
            </label>
            @if (q.kind === 'measure') {
              <label class="sp-row">
                <span class="sp-lbl">Lowest</span>
                <input class="pf-input" type="text" inputmode="decimal" [value]="text(q, 'min')" (change)="setNumber('min', $any($event.target).value)" />
              </label>
              <label class="sp-row">
                <span class="sp-lbl">Highest</span>
                <input class="pf-input" type="text" inputmode="decimal" [value]="text(q, 'max')" (change)="setNumber('max', $any($event.target).value)" />
              </label>
            }
          </div>
        </div>
      }

      @if (q.kind === 'shorthand') {
        <div class="sp-row" data-sp="preset">
          <span class="sp-lbl">Which notation</span>
          <pf-select [options]="presetOptions" [value]="preset()" (valueChange)="setPreset($event)" />
        </div>
      }
    }
  `,
})
export class SidePairPanelComponent {
  readonly field = input.required<FieldDef>();
  readonly apply = input.required<ApplyFieldChange>();

  protected readonly inner = computed(() => innerOf(this.field()));
  protected readonly preset = computed(() => presetOf(this.inner()?.config));
  protected readonly newChoice = signal('');
  protected readonly kindOptions: PfSelectOption<string>[] = PAIR_INNER_KINDS.map((k) => ({ value: k, label: KIND_NAMES[k] ?? k }));
  protected readonly presetOptions: PfSelectOption<string>[] = SHORTHAND_PRESETS.map((p) => ({ value: p, label: PRESET_WORDS[p] }));

  protected text(q: FieldDef, name: string): string {
    const v = q.config?.[name];
    return v === undefined || v === null ? '' : String(v);
  }

  protected setKind(kind: string): void {
    this.apply()((f) => {
      const prev = f.children?.[0];
      if (prev?.kind === kind) return;
      const s = STARTERS[kind];
      if (!s) return;
      f.children = [
        {
          key: prev?.key ?? `${f.key}Each`,
          kind,
          label: prev?.label ?? f.label,
          required: false,
          config: structuredClone(s.config),
          options: structuredClone(s.options ?? []),
          children: [],
          says: prev?.says,
        },
      ];
    });
  }

  private child(change: (c: FieldDef) => void): void {
    this.apply()((f) => {
      const c = f.children?.[0];
      if (c) change(c);
    });
  }

  protected setConfig(name: string, value: string): void {
    this.child((c) => {
      c.config ??= {};
      if (value.trim() === '') delete c.config[name];
      else c.config[name] = value.trim();
    });
  }

  protected setNumber(name: string, value: string): void {
    const n = Number(value.replace(',', '.'));
    this.child((c) => {
      c.config ??= {};
      if (value.trim() === '' || !Number.isFinite(n)) delete c.config[name];
      else c.config[name] = n;
    });
  }

  protected setPreset(p: string): void {
    this.child((c) => {
      c.config = { ...(SHORTHAND_BUILD.starterConfig ?? {}), preset: p };
    });
  }

  protected addChoice(): void {
    const label = this.newChoice().trim();
    if (!label) return;
    this.child((c) => {
      c.options ??= [];
      let key = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'option';
      for (let n = 2; c.options.some((o) => o.key === key); n++) key = `${key.replace(/_\d+$/, '')}_${n}`;
      c.options.push(opt(key, label));
    });
    this.newChoice.set('');
  }

  protected renameChoice(key: string, label: string): void {
    if (!label.trim()) return;
    this.child((c) => {
      const o = c.options?.find((x) => x.key === key);
      if (o) o.label = label.trim();
    });
  }

  protected removeChoice(key: string): void {
    this.child((c) => {
      c.options = (c.options ?? []).filter((o) => o.key !== key);
    });
  }
}
