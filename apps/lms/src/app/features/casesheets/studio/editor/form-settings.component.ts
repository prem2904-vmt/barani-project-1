import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from '@angular/core';
import { PfIconComponent, edit } from '@prefrontal/forms-engine';
import { PfSelectOption, SelectComponent } from '@prefrontal/shared';
import { DialogService } from '../../../../core/services/dialog.service';
import { StudioApi } from '../data/studio-api';
import { DepartmentRow, FormPatched, StudioError, plainError } from '../data/studio-models';
import { EditorStore } from './editor-store';

/** The words of a key change's confirm: what follows the new key. Exported for its spec. */
export function renameConfirmWords(from: string, to: string, isMaster: boolean): string {
  const follows = isMaster
    ? 'Every lab’s copy of it, the updates offered to labs and the suggested changes waiting for approval all follow the new key, in one step. Case sheets already filled keep reading the version they were started on.'
    : 'This lab’s saved case sheets keep reading the version they were started on, so nothing filled so far is lost.';
  return `The key changes from “${from}” to “${to}”. ${follows}`;
}

/** What a finished rename says (the counts come back from the server). */
export function renameResultWords(r: NonNullable<FormPatched['rename']>): string {
  const bits: string[] = [];
  if (r.labCopies) bits.push(`${r.labCopies} lab ${r.labCopies === 1 ? 'copy' : 'copies'}`);
  if (r.offers) bits.push(`${r.offers} ${r.offers === 1 ? 'update offer' : 'update offers'}`);
  if (r.proposals) bits.push(`${r.proposals} ${r.proposals === 1 ? 'suggestion' : 'suggestions'}`);
  return `The key is now “${r.to}”.` + (bits.length ? ` ${bits.join(', ').replace(/, ([^,]*)$/, ' and $1')} followed it.` : '');
}

/**
 * The legacy "Settings" box: display name, key ("Internal Name"), department ("Specialty") and description. The key is
 * ALWAYS editable (owner 2026-11-12): changing it asks first, naming what follows, and the server re-points everything in
 * one step (409 key_taken when another case sheet has it).
 */
@Component({
  selector: 'st-form-settings',
  standalone: true,
  imports: [PfIconComponent, SelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="lg-scrim" aria-hidden="true" (click)="closed.emit()"></div>
    <section class="lg-modal" role="dialog" aria-modal="true" aria-labelledby="fs-h" tabindex="-1" data-form-settings (keydown.escape)="$event.preventDefault(); closed.emit()">
      <header class="lg-modal__head">
        <h2 class="lg-modal__title" id="fs-h">Settings</h2>
        <button type="button" class="pf-btn pf-btn--icon" aria-label="Close" (click)="closed.emit()"><pf-icon name="x" [size]="18" /></button>
      </header>
      <div class="lg-modal__body">
        <div class="lg-field">
          <label class="lg-lbl" for="fs-name">Display Name</label>
          <input id="fs-name" class="pf-input" type="text" [value]="name()" (input)="name.set($any($event.target).value)" />
        </div>
        <div class="lg-field">
          <label class="lg-lbl" for="fs-key">Internal Name (key)</label>
          <input id="fs-key" class="pf-input" type="text" autocomplete="off" spellcheck="false" [value]="key()" (input)="key.set($any($event.target).value); error.set('')" />
          <p class="lg-help">Lower-case letters, digits and hyphens. Changing it is safe: lab copies, offers and suggestions follow it.</p>
        </div>
        <div class="lg-field">
          <span class="lg-lbl">Department</span>
          <pf-select [options]="deptOptions()" [value]="dept()" [searchable]="true" (valueChange)="dept.set($event ?? '')" />
        </div>
        <div class="lg-field">
          <label class="lg-lbl" for="fs-desc">Description</label>
          <textarea id="fs-desc" class="pf-input" rows="3" [value]="desc()" (input)="desc.set($any($event.target).value)"></textarea>
        </div>
        @if (error()) {
          <p class="lg-modal__err" role="alert" data-error>{{ error() }}</p>
        }
      </div>
      <footer class="lg-modal__foot">
        <button type="button" class="pf-btn pf-btn--secondary" (click)="closed.emit()">Cancel</button>
        <button type="button" class="pf-btn pf-btn--primary" data-act="save-settings" [disabled]="busy() || !name().trim() || !key().trim()" [attr.aria-busy]="busy() ? 'true' : null" (click)="save()">Save Changes</button>
      </footer>
    </section>
  `,
  styleUrls: ['../shared/lg-form.scss', '../shared/lg-modal-host.scss', '../shared/lg-modal.scss'],
})
export class FormSettingsComponent {
  readonly closed = output<void>();
  readonly saved = output<string>();

  private readonly store = inject(EditorStore);
  private readonly api = inject(StudioApi);
  private readonly dialog = inject(DialogService);

  protected readonly name = signal('');
  protected readonly key = signal('');
  protected readonly dept = signal('');
  protected readonly desc = signal('');
  protected readonly error = signal('');
  protected readonly busy = signal(false);
  private readonly departments = signal<DepartmentRow[]>([]);
  protected readonly deptOptions = computed<PfSelectOption<string>[]>(() => [{ value: '', label: 'Other' }, ...this.departments().map((d) => ({ value: d.key, label: d.name }))]);

  constructor() {
    queueMicrotask(() => {
      const f = this.store.session.form();
      this.name.set(this.store.def()?.title ?? f?.title ?? '');
      this.key.set(f?.key ?? '');
      this.dept.set(f?.departmentKey ?? '');
      this.desc.set(this.store.def()?.description ?? '');
    });
    void this.api
      .departments()
      .then((d) => this.departments.set(d))
      .catch(() => undefined);
  }

  protected async save(): Promise<void> {
    const sess = this.store.session;
    const form = sess.form();
    const id = sess.formId();
    if (!form || !id) return;
    const key = this.key().trim().toLowerCase();
    const wantKey = key !== form.key;
    const wantDept = this.dept() !== (form.departmentKey ?? '');
    this.busy.set(true);
    this.error.set('');
    try {
      if (wantKey) {
        const ok = await this.dialog.confirm({
          title: 'Change the key?',
          message: renameConfirmWords(form.key, key, form.origin === 'master'),
          confirmLabel: 'Change the key',
          cancelLabel: 'Keep it',
        });
        if (!ok) return;
      }
      let note = '';
      if (wantKey || wantDept) {
        let r: FormPatched;
        try {
          r = await this.api.updateForm(id, { ...(wantKey ? { key } : {}), ...(wantDept ? { departmentKey: this.dept() } : {}) });
        } catch (e) {
          // 409: another case sheet has that key; say so here, beside the box, and change nothing
          this.error.set(e instanceof StudioError && e.code === 'key_taken' ? `Another case sheet already uses the key “${key}”. Pick a different one.` : plainError(e));
          return;
        }
        sess.form.set({ ...form, key: r.key, departmentKey: r.departmentKey });
        if (r.rename) note = renameResultWords(r.rename);
      }
      const name = this.name().trim();
      const desc = this.desc().trim();
      if (name !== (this.store.def()?.title ?? '') || desc !== (this.store.def()?.description ?? '')) {
        this.store.edit((d) => edit(d, (x) => ((x.title = name), (x.description = desc || undefined))));
      }
      this.saved.emit(note);
      this.closed.emit();
    } finally {
      this.busy.set(false);
    }
  }
}
