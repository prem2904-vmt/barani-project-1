import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { PfIconComponent } from '@prefrontal/forms-engine';
import { PfSelectOption, SelectComponent } from '@prefrontal/shared';
import { DepartmentRow } from '../data/studio-models';
import { ACCEPT, MAX_FILES, MAX_TOTAL_BYTES, STEPS, addPages, fileType, moveItem, pagesProblem, stepStates } from './cortex-import';
import { CortexImportService } from './cortex-import.service';

const mb = (n: number): string => (n / (1024 * 1024)).toFixed(n >= 10 * 1024 * 1024 ? 0 : 1);

/**
 * "Start from a paper case sheet" (Cortex, dev beta): department, an optional name, the pages (photos or a PDF, in
 * order), then the progress of the job. It is Studio's own overlay (the app's DialogService has no room for a file
 * list); it keeps the app dialog look. Closing it never stops a running job.
 */
@Component({
  selector: 'st-cortex-import',
  standalone: true,
  imports: [PfIconComponent, SelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'close()' },
  template: `
    <div class="ci-root" role="dialog" aria-modal="true" aria-labelledby="ci-title" data-cortex-import>
      <div class="ci-backdrop" (click)="close()"></div>
      <div class="ci-card">
        <header class="ci-head">
          <span class="ci-ic" aria-hidden="true"><pf-icon name="sparkle" [size]="20" /></span>
          <div class="ci-head__t">
            <h2 id="ci-title" class="ci-title">{{ title() }}</h2>
            @if (subtitle(); as sub) { <p class="ci-sub">{{ sub }}</p> }
          </div>
          <button type="button" class="pf-btn pf-btn--icon ci-x" aria-label="Close" data-act="close" (click)="close()"><pf-icon name="x" [size]="18" /></button>
        </header>

        @if (job(); as j) {
          <ol class="ci-steps" aria-label="Progress" data-steps>
            @for (s of steps; track s; let i = $index) {
              <li class="ci-step" [attr.data-state]="states()[i]" [class.is-failed]="j.status === 'failed' && states()[i] === 'active'">
                <span class="ci-mark" aria-hidden="true">
                  @if (states()[i] === 'done') { <pf-icon name="check" [size]="14" /> }
                </span>
                <span class="ci-step__t">{{ s }}</span>
              </li>
            }
          </ol>
          @if (j.status === 'failed') {
            <p class="ci-fail" role="alert" data-failure>{{ j.failure }}</p>
            <footer class="ci-foot">
              <button type="button" class="pf-btn pf-btn--secondary" data-act="cancel" (click)="close()">Close</button>
              <button type="button" class="pf-btn pf-btn--primary" data-act="again" (click)="again()">Try again</button>
            </footer>
          } @else {
            <p class="ci-note" data-bg-note>You can close this. Cortex keeps working, and Studio shows it until the draft is ready.</p>
            <footer class="ci-foot">
              <button type="button" class="pf-btn pf-btn--secondary" data-act="cancel" (click)="close()">Close</button>
            </footer>
          }
        } @else {
          <div class="ci-body">
            <div class="ci-field">
              <span class="ci-lbl" id="ci-dept-l">Department</span>
              @if (departments().length) {
                <pf-select class="ci-dept" aria-labelledby="ci-dept-l" data-dept [options]="deptOptions()" [value]="dept()" placeholder="Pick a department" (valueChange)="dept.set($event)" />
              } @else {
                <p class="ci-hint">No departments to pick from yet.</p>
              }
            </div>
            <div class="ci-field">
              <label class="ci-lbl" for="ci-name">Name <span class="ci-opt">optional</span></label>
              <input id="ci-name" class="pf-input" type="text" data-name placeholder="Cortex suggests one if you leave this empty" [value]="name()" (input)="name.set($any($event.target).value)" />
            </div>
            <div class="ci-field">
              <span class="ci-lbl">Pages</span>
              <input #fileEl class="ci-file" type="file" [accept]="accept" multiple aria-label="Add photos or a PDF" data-file (change)="picked($event)" />
              <button type="button" class="pf-btn pf-btn--secondary ci-add" data-act="add" [disabled]="files().length >= max" (click)="fileEl.click()">
                <pf-icon name="camera" [size]="18" /> Add photos or a PDF
              </button>
              @if (files().length) {
                <ul class="ci-pages" role="list" data-pages>
                  @for (f of files(); track f; let i = $index) {
                    <li class="ci-page" [attr.data-page]="i">
                      <span class="ci-thumb">
                        @if (thumb(f); as src) { <img [src]="src" alt="" /> } @else { <pf-icon name="file" [size]="22" /> }
                      </span>
                      <span class="ci-page__t">
                        <span class="ci-page__n">Page {{ i + 1 }}</span>
                        <span class="ci-page__f">{{ f.name }} · {{ size(f.size) }} MB</span>
                      </span>
                      <button type="button" class="pf-btn pf-btn--icon" [attr.aria-label]="'Move page ' + (i + 1) + ' up'" data-act="up" [disabled]="i === 0" (click)="move(i, i - 1)"><pf-icon name="arrow-up" [size]="16" /></button>
                      <button type="button" class="pf-btn pf-btn--icon" [attr.aria-label]="'Move page ' + (i + 1) + ' down'" data-act="down" [disabled]="i === files().length - 1" (click)="move(i, i + 1)"><pf-icon name="arrow-down" [size]="16" /></button>
                      <button type="button" class="pf-btn pf-btn--icon" [attr.aria-label]="'Remove page ' + (i + 1)" data-act="remove" (click)="remove(i)"><pf-icon name="trash" [size]="16" /></button>
                    </li>
                  }
                </ul>
                <p class="ci-count" data-count>{{ files().length }} of {{ max }} pages · {{ totalMb() }} of {{ limitMb }} MB</p>
              }
              @if (shownProblem(); as p) { <p class="ci-err" role="alert" data-problem>{{ p }}</p> }
            </div>
            <p class="ci-privacy" data-privacy>
              <pf-icon name="lock" [size]="16" />
              <span>Use a blank sheet. Don't upload a sheet filled in for a patient.</span>
            </p>
            @if (svc.startError(); as e) { <p class="ci-err" role="alert" data-start-error>{{ e }}</p> }
          </div>
          <footer class="ci-foot">
            <button type="button" class="pf-btn pf-btn--secondary" data-act="cancel" (click)="close()">Cancel</button>
            <button type="button" class="pf-btn pf-btn--primary" data-act="read" [disabled]="!canRead()" [attr.aria-busy]="svc.starting() ? 'true' : null" (click)="read()">
              <pf-icon name="sparkle" [size]="18" /> {{ svc.starting() ? 'Sending…' : 'Read the sheet' }}
            </button>
          </footer>
        }
      </div>
    </div>
  `,
  styleUrl: './cortex-import.dialog.scss',
})
export class CortexImportDialog {
  readonly departments = input<DepartmentRow[]>([]);
  readonly closed = output<void>();

  protected readonly svc = inject(CortexImportService);

  protected readonly accept = ACCEPT;
  protected readonly max = MAX_FILES;
  protected readonly limitMb = mb(MAX_TOTAL_BYTES);
  protected readonly steps = STEPS;

  protected readonly dept = signal('');
  protected readonly name = signal('');
  protected readonly files = signal<File[]>([]);
  private readonly rejected = signal<string[]>([]);
  private readonly tried = signal(false);

  protected readonly job = computed(() => (this.svc.viewing() ? this.svc.job() : null));
  protected readonly states = computed(() => stepStates(this.job()?.status ?? 'queued'));
  /** A failed read says so in the heading too (it used to keep "Cortex is reading your sheet / Hold on" above the refusal). */
  protected readonly title = computed(() => {
    const j = this.job();
    return !j ? 'Start from a paper case sheet' : j.status === 'failed' ? 'Cortex could not use this sheet' : 'Cortex is reading your sheet';
  });
  protected readonly subtitle = computed(() => {
    const j = this.job();
    return !j ? 'Cortex turns a photo or PDF of your blank paper sheet into a draft form you can edit.'
      : j.status === 'failed' ? '' : 'Hold on, this takes about a minute.';   // the failure line below says the rest
  });
  protected readonly deptOptions = computed<PfSelectOption<string>[]>(() => this.departments().map((d) => ({ value: d.key, label: d.name })));
  protected readonly totalMb = computed(() => mb(this.files().reduce((n, f) => n + f.size, 0)));
  private readonly problem = computed(() => pagesProblem(this.files()));
  /** The reason the pages can't go, shown once there is something to say (not before the first page is added). */
  protected readonly shownProblem = computed(() => {
    const rej = this.rejected();
    if (rej.length) return `${rej.length === 1 ? `“${rej[0]}” isn't` : `${rej.length} files aren't`} a photo or a PDF. Use JPEG, PNG, WebP or PDF.`;
    return this.files().length || this.tried() ? this.problem() : '';
  });
  protected readonly canRead = computed(() => !this.problem() && !!this.dept() && !this.svc.starting() && !this.svc.running());

  private readonly urls = new Map<File, string>();

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      for (const u of this.urls.values()) this.revoke(u);
      this.urls.clear();
    });
    // a single department needs no picking
    effect(() => {
      const d = this.departments();
      if (d.length === 1 && !untracked(() => this.dept())) this.dept.set(d[0].key);
    });
  }

  protected size(n: number): string {
    return mb(n);
  }

  protected thumb(f: File): string | null {
    if (!fileType(f).startsWith('image/')) return null;
    let u = this.urls.get(f);
    if (!u) {
      try {
        u = URL.createObjectURL(f);
      } catch {
        return null;
      }
      this.urls.set(f, u);
    }
    return u;
  }

  private revoke(u: string): void {
    try {
      URL.revokeObjectURL(u);
    } catch {
      /* nothing to free */
    }
  }

  protected picked(e: Event): void {
    const el = e.target as HTMLInputElement;
    this.addFiles(Array.from(el.files ?? []));
    el.value = '';
  }

  /** Add picked files (also used by the specs). Wrong types are named, not added. */
  addFiles(picked: File[]): void {
    const r = addPages(this.files(), picked);
    this.files.set(r.files);
    this.rejected.set(r.rejected);
  }

  protected move(from: number, to: number): void {
    this.files.set(moveItem(this.files(), from, to));
  }

  protected remove(i: number): void {
    const f = this.files()[i];
    const u = f && this.urls.get(f);
    if (u) {
      this.revoke(u);
      this.urls.delete(f);
    }
    this.files.set(this.files().filter((_, k) => k !== i));
    this.rejected.set([]);
  }

  protected async read(): Promise<void> {
    this.tried.set(true);
    if (!this.canRead()) return;
    await this.svc.start({ files: this.files(), departmentKey: this.dept(), title: this.name().trim() || undefined });
  }

  /** After a failed job: back to the form (a sheet with a patient's details is not kept at all). */
  protected again(): void {
    if (this.svc.job()?.failure?.includes("patient's details")) this.files.set([]);
    this.svc.dismiss();
  }

  protected close(): void {
    if (this.svc.viewing()) this.svc.hide();
    this.closed.emit();
  }
}
