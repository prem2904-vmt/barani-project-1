import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import {
  PickCell, PickLeaf, SampleIdFormat, extractSampleId, pathLabel, pickModel, rangeOf, rangePath,
} from '../../../shared/instruments/sample-id-path';

/** Long lines / messages: the picker shows this much (a sample number sits near the start). */
const MAX_LINES = 200;
const MAX_CHARS = 400;

/**
 * "Custom — pick from a received message": shows the last message the
 * analyzer sent, as tappable fields. Tapping the sample number computes its
 * path (PID.5.2, O.3, 2:12-16, Patient.medicalRecordNo) and emits it; the
 * editor saves it as parser.<format>.sampleIdPath. Live preview of what the
 * connector will read (sample-id-path.ts mirrors the connector).
 */
@Component({
  selector: 'pf-sample-id-picker',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sample-id-picker.component.html',
  styleUrl: './sample-id-picker.component.scss',
})
export class SampleIdPickerComponent {
  /** The received message (raw text), or null when nothing has arrived yet. */
  readonly raw = input<string | null>(null);
  readonly format = input.required<SampleIdFormat>();
  /** The saved / picked path ('' = none yet). */
  readonly path = input<string>('');
  readonly loading = input(false);
  /** "today 10:42 · sample 26703" — where the message came from. */
  readonly source = input<string>('');
  readonly pathChange = output<string>();
  readonly reload = output<void>();

  readonly model = computed(() => {
    const m = pickModel(this.raw(), this.format());
    return { ...m, lines: m.lines.slice(0, MAX_LINES).map((l) => ({ ...l, chars: Array.from(l.text.slice(0, MAX_CHARS)) })) };
  });
  readonly isRows = computed(() => this.format() === 'hl7' || this.format() === 'astm');
  readonly isText = computed(() => this.format() === 'text' || this.format() === 'hbpro');
  readonly preview = computed(() => extractSampleId(this.raw(), this.format(), this.path()));
  readonly label = computed(() => pathLabel(this.format(), this.path()));
  readonly range = computed(() => (this.isText() ? rangeOf(this.path()) : null));
  readonly leafGroups = computed(() => {
    const groups: { name: string; leaves: PickLeaf[] }[] = [];
    for (const l of this.model().leaves) {
      let g = groups.find((x) => x.name === l.group);
      if (!g) { g = { name: l.group, leaves: [] }; groups.push(g); }
      g.leaves.push(l);
    }
    return groups;
  });
  readonly hasContent = computed(() => {
    const m = this.model();
    return m.rows.some((r) => r.cells.length) || m.lines.length > 0 || m.leaves.length > 0;
  });

  /** Text: the first tap of a two-tap range. */
  readonly anchor = signal<{ line: number; idx: number } | null>(null);

  pickCell(c: PickCell | PickLeaf) { this.anchor.set(null); this.pathChange.emit(c.path); }

  tapChar(line: number, idx: number) {
    const a = this.anchor();
    if (!a || a.line !== line) { this.anchor.set({ line, idx }); return; }
    this.anchor.set(null);
    this.pathChange.emit(rangePath(this.format(), line, a.idx, idx));
  }

  charState(line: number, idx: number): 'anchor' | 'on' | '' {
    const a = this.anchor();
    if (a) return a.line === line && a.idx === idx ? 'anchor' : '';
    const r = this.range();
    return r && r.line === line && idx >= r.start && idx < r.end ? 'on' : '';
  }

  clear() { this.anchor.set(null); this.pathChange.emit(''); }
}
