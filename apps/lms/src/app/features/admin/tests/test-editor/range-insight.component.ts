import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { ReportLayoutService } from '../../../../core/services/report-layout.service';
import { deriveRangeLabel } from '../../../../shared/utils/reference-range';
import {
  LEVEL_LABEL, bandZones, bandWho, fmtNum, tryValue, validateRanges, zoneTicks, zoneWeights,
  type FlagLevel, type InsightBand, type InsightParam, type RangeIssue, type RangeZone,
} from '../../../../shared/utils/range-insight';
import { evaluateRules, type CondLookup, type CondRule } from '../../../../shared/utils/flag-conditions';

interface BarView {
  index: number;
  who: string;
  zones: Array<RangeZone & { weight: number; label: string }>;
  ticks: Array<{ pct: number; text: string; title: string }>;
  issues: RangeIssue[];
}

interface FiredLine { where: string; what: string }

/**
 * "What the numbers mean" — one range bar per band (the number line cut the
 * way production flags it, live from the grid), the problems with the ranges
 * attached to the band they belong to, and a "try a value" tester that runs
 * the SAME band choice + flag as result entry and shows which report
 * conditions would fire. Reads only; the grid above stays the editor.
 * Shared byte-identical by prefrontal-ui and prefrontal-admin-ui.
 */
@Component({
  selector: 'pf-range-insight',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (bars().length || paramIssues().length) {
    <section class="rin" aria-label="What the numbers mean">
      <header class="rin__head">
        <h3 class="rin__title">What the numbers mean</h3>
        <p class="rin__sub">Read left to right. A number under the bar is where the next zone starts —
          <span class="rin__g">≥</span> the number is in it, <span class="rin__g">&gt;</span> it is not.</p>
      </header>

      @for (m of paramIssues(); track $index) {
        <p class="rin__issue" [class.rin__issue--err]="m.severity === 'error'" role="note">
          <svg class="rin__issue-ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>
          <span>{{ m.message }}</span>
        </p>
      }

      <ol class="rin__bands">
        @for (b of bars(); track b.index) {
          <li class="rin__band" [class.rin__band--on]="tried()?.bandIndex === b.index">
            <div class="rin__who">
              <span class="rin__n">Range {{ b.index + 1 }}</span>
              <span class="rin__whotext">{{ b.who }}</span>
              @if (tried()?.bandIndex === b.index) { <span class="rin__used">used for this patient</span> }
            </div>
            @if (b.zones.length) {
              <div class="rin__barwrap">
                <div class="rin__bar" role="img" [attr.aria-label]="barLabel(b)">
                  @for (z of b.zones; track $index) {
                    <span class="rin__zone" [attr.data-level]="z.level ?? 'none'" [style.flex-grow]="z.weight"
                          [title]="z.caption">
                      <span class="rin__zlbl">{{ z.label }}</span>
                    </span>
                  }
                  @if (tried()?.bandIndex === b.index && markerPct() != null) {
                    <span class="rin__pin" [style.left.%]="markerPct()" aria-hidden="true"></span>
                  }
                </div>
                <div class="rin__ticks" aria-hidden="true">
                  @for (t of b.ticks; track $index) {
                    <span class="rin__tick" [style.left.%]="t.pct" [title]="t.title">{{ t.text }}</span>
                  }
                </div>
              </div>
              <ul class="rin__caps">
                @for (z of b.zones; track $index) {
                  <li class="rin__cap"><span class="rin__sw" [attr.data-level]="z.level ?? 'none'" aria-hidden="true"></span>{{ z.words }}{{ unitSuffix() }} → {{ z.label }}</li>
                }
              </ul>
            } @else {
              <p class="rin__empty">No numbers yet — fill Normal low / high (or a critical limit) in the grid.</p>
            }
            @for (m of b.issues; track $index) {
              <p class="rin__issue" [class.rin__issue--err]="m.severity === 'error'" role="note">
                <svg class="rin__issue-ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>
                <span><strong>{{ fieldName(m.field) }}:</strong> {{ m.message }}</span>
              </p>
            }
          </li>
        }
      </ol>

      <div class="rin__try">
        <div class="rin__tryrow">
          <label class="rin__fld">
            <span class="rin__lbl">Try a value</span>
            <input class="nd-input rin__in rin__in--val" type="text" inputmode="decimal" autocomplete="off"
                   [placeholder]="'e.g. ' + samplePlaceholder()" [value]="valueText()"
                   (input)="valueText.set($any($event.target).value)" />
          </label>
          <div class="rin__fld">
            <span class="rin__lbl" id="rin-sex-lbl">Patient</span>
            <div class="rin__seg" role="radiogroup" aria-labelledby="rin-sex-lbl">
              @for (s of sexes; track s.v) {
                <button type="button" class="rin__segi" role="radio" [attr.aria-checked]="sex() === s.v"
                        (click)="sex.set(s.v)">{{ s.l }}</button>
              }
            </div>
          </div>
          <label class="rin__fld">
            <span class="rin__lbl">Age in years</span>
            <input class="nd-input rin__in rin__in--age" type="text" inputmode="decimal" autocomplete="off"
                   placeholder="any" [value]="ageText()" (input)="ageText.set($any($event.target).value)" />
          </label>
        </div>
        @if (tried(); as t) {
          <div class="rin__verdict" aria-live="polite">
            <span class="rin__flag" [attr.data-level]="t.level ?? 'none'">{{ t.level ? levelLabel(t.level) : 'Not flagged' }}</span>
            <span class="rin__vtext">
              @if (t.bandIndex != null) {
                Judged against range {{ t.bandIndex + 1 }} ({{ whoOf(t.band) }}){{ t.onMerit ? '' : ' — no range matches this patient on sex / age, so the first eligible one is used and the report lists every range' }}.
              } @else { No range to judge against. }
              @if (t.code) { Saved as flag <strong>{{ t.code }}</strong>{{ t.code === 'C' ? ' (critical — stored as C, not H / L)' : '' }}. }
            </span>
          </div>
          @if (fired().length) {
            <ul class="rin__fired">
              @for (f of fired(); track $index) {
                <li><span class="rin__where">{{ f.where }}</span> {{ f.what }}</li>
              }
            </ul>
          } @else if (hasRules()) {
            <p class="rin__quiet">No report condition changes anything for this value.</p>
          }
        } @else if (valueText().trim()) {
          <p class="rin__quiet">Type a number to see how it is flagged.</p>
        }
      </div>
    </section>
    }
  `,
  styles: [`
    :host { display: block; }
    .rin {
      --rin-crit: #c2413b; --rin-crit-bg: color-mix(in srgb, #dc2626 13%, transparent);
      --rin-warn: #a15c07; --rin-warn-bg: color-mix(in srgb, #d97706 13%, transparent);
      --rin-ok: var(--violet-text, #6d28d9); --rin-ok-bg: color-mix(in srgb, var(--color-primary, #7c3aed) 9%, transparent);
      --rin-line: var(--nd-line, var(--glass-border, #e5e7eb));
      display: flex; flex-direction: column; gap: 12px; margin-top: 12px; padding: 14px 16px;
      border: 1px solid var(--rin-line); border-radius: 14px; background: var(--nd-card-bg, transparent);
      font-family: inherit;
    }
    :host-context(.dark) .rin {
      --rin-crit: #f28b82; --rin-crit-bg: color-mix(in srgb, #ef4444 20%, transparent);
      --rin-warn: #f2b35c; --rin-warn-bg: color-mix(in srgb, #f59e0b 17%, transparent);
      --rin-ok: #c4b5fd; --rin-ok-bg: color-mix(in srgb, #8b5cf6 16%, transparent);
    }
    .rin__head { display: flex; flex-direction: column; gap: 2px; }
    .rin__title { margin: 0; font-size: 13px; font-weight: 600; color: var(--text-primary); }
    .rin__sub { margin: 0; font-size: 12px; line-height: 1.45; color: var(--text-tertiary); text-wrap: pretty; }
    .rin__g { font-variant-numeric: tabular-nums; color: var(--text-secondary); font-weight: 600; }

    .rin__bands { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 14px; }
    .rin__band { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; border-radius: 12px;
      border: 1px solid transparent; transition: border-color .2s, background .2s; }
    .rin__band--on { border-color: color-mix(in srgb, var(--color-primary, #7c3aed) 30%, transparent); background: var(--rin-ok-bg); }
    .rin__who { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
    .rin__n { font-size: 12px; font-weight: 600; color: var(--text-secondary); font-variant-numeric: tabular-nums; }
    .rin__whotext { font-size: 13px; font-weight: 500; color: var(--text-primary); }
    .rin__used { font-size: 11.5px; color: var(--rin-ok); font-weight: 500; }

    .rin__barwrap { position: relative; padding-bottom: 22px; }
    .rin__bar { position: relative; display: flex; height: 30px; border-radius: 9px; overflow: visible; gap: 2px; }
    .rin__zone { flex-basis: 0; min-width: 34px; display: flex; align-items: center; justify-content: center;
      border-radius: 4px; padding: 0 6px; background: var(--nd-chip-bg, rgba(127,127,127,.12)); }
    .rin__zone:first-child { border-top-left-radius: 9px; border-bottom-left-radius: 9px; }
    .rin__zone:last-of-type { border-top-right-radius: 9px; border-bottom-right-radius: 9px; }
    .rin__zone[data-level='normal'] { background: var(--rin-ok-bg); color: var(--rin-ok); }
    .rin__zone[data-level='low'], .rin__zone[data-level='high'] { background: var(--rin-warn-bg); color: var(--rin-warn); }
    .rin__zone[data-level='critical_low'], .rin__zone[data-level='critical_high'] { background: var(--rin-crit-bg); color: var(--rin-crit); }
    .rin__zlbl { font-size: 11.5px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .rin__pin { position: absolute; top: -5px; bottom: -5px; width: 3px; margin-left: -1.5px; border-radius: 2px;
      background: var(--text-primary); box-shadow: 0 1px 4px rgba(0,0,0,.25); transition: left .32s cubic-bezier(0.32, 0.72, 0, 1); }
    .rin__ticks { position: absolute; left: 0; right: 0; bottom: 0; height: 18px; }
    .rin__tick { position: absolute; transform: translateX(-50%); top: 2px; font-size: 11.5px; color: var(--text-secondary);
      font-variant-numeric: tabular-nums; white-space: nowrap; }
    .rin__tick::before { content: ''; position: absolute; left: 50%; top: -6px; width: 1px; height: 5px; background: var(--rin-line); }
    .rin__caps { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 4px 16px; }
    .rin__cap { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-secondary); font-variant-numeric: tabular-nums; }
    .rin__sw { width: 8px; height: 8px; border-radius: 2px; background: var(--nd-chip-bg, rgba(127,127,127,.2)); flex: none; }
    .rin__sw[data-level='normal'] { background: var(--rin-ok); }
    .rin__sw[data-level='low'], .rin__sw[data-level='high'] { background: var(--rin-warn); }
    .rin__sw[data-level='critical_low'], .rin__sw[data-level='critical_high'] { background: var(--rin-crit); }
    .rin__empty, .rin__quiet { margin: 0; font-size: 12px; color: var(--text-tertiary); }

    .rin__issue { display: flex; align-items: flex-start; gap: 7px; margin: 0; font-size: 12px; line-height: 1.45; color: var(--text-secondary); }
    .rin__issue-ico { flex: none; margin-top: 1px; color: var(--rin-warn); }
    .rin__issue--err { color: var(--rin-crit); }
    .rin__issue--err .rin__issue-ico { color: var(--rin-crit); }
    .rin__issue strong { font-weight: 600; }

    .rin__try { display: flex; flex-direction: column; gap: 10px; padding-top: 12px; border-top: 1px solid var(--rin-line); }
    .rin__tryrow { display: flex; align-items: flex-end; gap: 12px; flex-wrap: wrap; }
    .rin__fld { display: flex; flex-direction: column; gap: 6px; }
    .rin__lbl { font-size: 12px; font-weight: 500; color: var(--text-secondary); }
    .rin__in { height: 40px; padding: 0 12px; border-radius: 10px; font: inherit; font-size: 14px;
      font-variant-numeric: tabular-nums; color: var(--text-primary);
      background: var(--nd-card-bg, var(--input-bg, transparent)); border: 1px solid var(--rin-line); }
    .rin__in:focus { outline: none; border-color: color-mix(in srgb, var(--color-primary, #7c3aed) 55%, transparent);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary, #7c3aed) 14%, transparent); }
    .rin__in--val { width: 140px; }
    .rin__in--age { width: 96px; }
    .rin__seg { display: inline-flex; padding: 2px; gap: 2px; height: 40px; box-sizing: border-box; border-radius: 10px;
      background: var(--nd-chip-bg, rgba(127,127,127,.1)); border: 1px solid var(--rin-line); }
    .rin__segi { padding: 0 12px; border: 0; border-radius: 8px; background: transparent; color: var(--text-secondary);
      font: inherit; font-size: 12.5px; cursor: pointer; }
    .rin__segi[aria-checked='true'] { background: var(--nd-card-bg, var(--bg-secondary)); color: var(--text-primary);
      box-shadow: 0 1px 2px rgba(0,0,0,.12); font-weight: 500; }
    .rin__segi:focus-visible { outline: 2px solid color-mix(in srgb, var(--color-primary, #7c3aed) 55%, transparent); outline-offset: 1px; }
    .rin__verdict { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
    .rin__flag { display: inline-flex; align-items: center; height: 26px; padding: 0 10px; border-radius: 999px;
      font-size: 12.5px; font-weight: 600; background: var(--nd-chip-bg, rgba(127,127,127,.12)); color: var(--text-secondary); }
    .rin__flag[data-level='normal'] { background: var(--rin-ok-bg); color: var(--rin-ok); }
    .rin__flag[data-level='low'], .rin__flag[data-level='high'] { background: var(--rin-warn-bg); color: var(--rin-warn); }
    .rin__flag[data-level='critical_low'], .rin__flag[data-level='critical_high'] { background: var(--rin-crit-bg); color: var(--rin-crit); }
    .rin__vtext { font-size: 12.5px; line-height: 1.5; color: var(--text-secondary); text-wrap: pretty; }
    .rin__fired { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
    .rin__fired li { font-size: 12.5px; color: var(--text-primary); line-height: 1.45; }
    .rin__where { color: var(--text-tertiary); margin-right: 4px; }

    @media (max-width: 640px) {
      .rin { padding: 12px; }
      .rin__band { padding: 8px 4px; }
      .rin__zone { min-width: 22px; padding: 0 3px; }
      .rin__zlbl { font-size: 10.5px; }
      .rin__caps { flex-direction: column; }
      .rin__tryrow { flex-direction: column; align-items: stretch; }
      .rin__in, .rin__in--val, .rin__in--age { width: 100%; height: 44px; font-size: 16px; }
      .rin__seg { height: 44px; }
      .rin__segi { flex: 1; }
    }
    @media (prefers-reduced-motion: reduce) { .rin__pin, .rin__band { transition: none; } }
  `],
})
export class RangeInsightComponent {
  private readonly layouts = inject(ReportLayoutService);

  /** The numeric parameter — referenceRanges + criticals + unit, straight from the draft. */
  readonly param = input<InsightParam | null>(null);
  /** The unit printed after the numbers (the parameter's, else the test's). */
  readonly unit = input<string>('');
  /** Saved test id — its report conditions are loaded for the tester. */
  readonly testId = input<string>('');
  /** The parameter name the report conditions refer to. */
  readonly paramName = input<string>('');

  readonly valueText = signal('');
  readonly ageText = signal('');
  readonly sex = signal<'M' | 'F' | null>(null);
  readonly sexes = [{ v: null, l: 'Anyone' }, { v: 'M' as const, l: 'Man' }, { v: 'F' as const, l: 'Woman' }];

  private readonly sections = signal<Array<Record<string, unknown>>>([]);

  constructor() {
    effect(() => {
      const id = this.testId();
      if (!id) { this.sections.set([]); return; }
      this.layouts.getTestLayout(id)
        .then(r => this.sections.set(((r?.sections ?? []) as unknown as Array<Record<string, unknown>>)
          .slice().sort((a, b) => (Number(a['order']) || 0) - (Number(b['order']) || 0))))
        .catch(() => this.sections.set([]));
    });
  }

  private readonly effParam = computed<InsightParam | null>(() => {
    const p = this.param();
    if (!p) return null;
    return { ...p, unit: p.unit || this.unit() || null };
  });

  readonly issues = computed(() => validateRanges(this.effParam()));
  readonly paramIssues = computed(() => this.issues().filter(i => i.band == null));

  readonly bars = computed<BarView[]>(() => {
    const p = this.effParam();
    const bands = p?.referenceRanges ?? [];
    const issues = this.issues();
    return bands.map((b, index) => {
      const zones = bandZones(b, p);
      const w = zoneWeights(zones);
      const total = w.reduce((s, x) => s + x, 0) || 1;
      const ticks = zoneTicks(zones);
      let acc = 0;
      const edges = w.slice(0, -1).map(x => (acc += x) / total * 100);
      return {
        index,
        who: this.whoOf(b),
        zones: zones.map((z, k) => ({ ...z, weight: w[k], label: z.level ? LEVEL_LABEL[z.level] : 'No flag' })),
        ticks: ticks.map((t, k) => ({ pct: edges[k] ?? 0, text: t.text, title: t.title })),
        issues: issues.filter(i => i.band === index),
      };
    });
  });

  private readonly tryNum = computed<number | null>(() => {
    const s = this.valueText().trim().replace(',', '.');
    if (!s) return null;
    const v = Number(s);
    return Number.isFinite(v) ? v : null;
  });

  readonly tried = computed(() => {
    const v = this.tryNum();
    const p = this.effParam();
    if (v == null || !p) return null;
    const a = Number(this.ageText().trim().replace(',', '.'));
    const age = this.ageText().trim() && Number.isFinite(a) ? a : null;
    return { ...tryValue(p, v, this.sex(), age), value: v };
  });

  /** Where the tried value sits on its band's bar (0–100). */
  readonly markerPct = computed<number | null>(() => {
    const t = this.tried();
    if (!t || t.bandIndex == null) return null;
    const bar = this.bars()[t.bandIndex];
    if (!bar?.zones.length) return null;
    const total = bar.zones.reduce((s, z) => s + z.weight, 0) || 1;
    let start = 0;
    for (const z of bar.zones) {
      const inLo = z.lo == null || (z.loIncl ? t.value >= z.lo : t.value > z.lo);
      const inHi = z.hi == null || (z.hiIncl ? t.value <= z.hi : t.value < z.hi);
      if (inLo && inHi) {
        let f = 0.5;
        if (z.lo != null && z.hi != null && z.hi > z.lo) f = (t.value - z.lo) / (z.hi - z.lo);
        else if (z.lo == null && z.hi != null) f = 0.6;
        else if (z.hi == null && z.lo != null) f = 0.4;
        f = Math.min(0.94, Math.max(0.06, f));
        return (start + f * z.weight) / total * 100;
      }
      start += z.weight;
    }
    return null;
  });

  readonly hasRules = computed(() => this.ruleSets().length > 0);

  /** Every conditions array that could react to this parameter. */
  private readonly ruleSets = computed(() => {
    const out: Array<{ where: string; kind: 'block' | 'row'; rules: CondRule[]; section: Record<string, unknown> }> = [];
    this.sections().forEach((s, i) => {
      const conds = s['conditions'] as CondRule[] | undefined;
      if (conds?.length) out.push({ where: `Block ${i + 1} · ${this.blockName(s)}`, kind: 'block', rules: conds, section: s });
      if (s['type'] === 'grid') {
        for (const r of (s['rows'] as Array<Record<string, unknown>> | undefined) ?? []) {
          const rc = r['conditions'] as CondRule[] | undefined;
          if (rc?.length && this.sameName(String(r['parameter_name'] ?? ''), this.paramName()))
            out.push({ where: 'Description', kind: 'row', rules: rc, section: r });
        }
      }
    });
    return out;
  });

  readonly fired = computed<FiredLine[]>(() => {
    const t = this.tried();
    if (!t) return [];
    const name = this.paramName();
    const lookup: CondLookup = n => this.sameName(n, name) ? { value: t.value, level: t.level } : undefined;
    const out: FiredLine[] = [];
    for (const set of this.ruleSets()) {
      const k = evaluateRules(set.rules, lookup);
      if (k == null) continue;
      const rule = set.rules[k];
      const then = (rule.then ?? {}) as Record<string, unknown>;
      if (set.kind === 'block') {
        const hide = then['show'] === false || then['hide_section'] === true;
        out.push({ where: set.where, what: hide ? 'is hidden.' : 'prints.' });
      } else {
        const d = (then['cells'] as Record<string, unknown> | undefined)?.['description'];
        const line = rule.else ? 'the base wording' : `line ${set.rules.slice(0, k + 1).filter(r => !r.else).length}`;
        out.push({ where: set.where, what: d != null ? `says “${String(d)}” (${line}).` : `uses ${line}.` });
      }
    }
    return out;
  });

  readonly samplePlaceholder = computed(() => {
    const b = this.param()?.referenceRanges?.find(x => x.min != null || x.max != null);
    const v = b?.max ?? b?.min;
    return v != null ? fmtNum(v) : '12.5';
  });

  unitSuffix(): string { const u = (this.param()?.unit || this.unit() || '').trim(); return u ? ` ${u}` : ''; }
  levelLabel(l: FlagLevel): string { return LEVEL_LABEL[l]; }
  whoOf(b: InsightBand | null): string {
    if (!b) return '';
    const named = b.label?.trim();
    return named ? `${named} · ${bandWho(b)}` : bandWho(b) || deriveRangeLabel(b) || 'Everyone';
  }
  barLabel(b: BarView): string { return b.zones.map(z => z.caption).join('; '); }
  fieldName(f: RangeIssue['field']): string {
    switch (f) {
      case 'min': return 'Normal low';
      case 'max': return 'Normal high';
      case 'criticalLow': return 'Critical low';
      case 'criticalHigh': return 'Critical high';
      case 'minAge': return 'Age';
      case 'maxAge': return 'Age';
      case 'sex': return 'Who';
      case 'unit': return 'Unit';
      default: return 'Range';
    }
  }
  private blockName(s: Record<string, unknown>): string {
    const label = String(s['label'] ?? '').trim();
    if (label) return label;
    const tpl = String(s['template'] ?? '').trim();
    if (s['type'] === 'paragraph') return tpl ? `Sentence “${tpl.length > 60 ? tpl.slice(0, 57) + '…' : tpl}”` : 'Sentence';
    return ({ grid: 'Results table', image: 'Images', chart: 'Chart' } as Record<string, string>)[String(s['type'])] ?? 'Block';
  }
  private sameName(a: string, b: string): boolean { return a.trim().toLowerCase() === b.trim().toLowerCase(); }
}
