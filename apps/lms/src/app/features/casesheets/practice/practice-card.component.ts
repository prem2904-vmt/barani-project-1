import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { PfIconComponent } from '@prefrontal/forms-engine';
import { SkeletonFormComponent } from '@prefrontal/shared';
import { DialogService } from '../../../core/services/dialog.service';
import { PracticeApi, PracticeSettings } from './practice-api';

type TextKey = 'practiceName' | 'doctorName' | 'addressLine1' | 'addressLine2' | 'phone' | 'email' | 'website';

interface TextRow {
  key: TextKey;
  label: string;
  placeholder: string;
  type?: 'tel' | 'email' | 'url';
  half?: boolean;
}

const ROWS: TextRow[] = [
  { key: 'practiceName', label: 'Practice or clinic name', placeholder: 'Sunrise ENT Clinic' },
  { key: 'doctorName', label: 'Your name as it prints', placeholder: 'Dr Meera Raghavan, MS (ENT)' },
  { key: 'addressLine1', label: 'Address', placeholder: '12 Park Road' },
  { key: 'addressLine2', label: 'Address, second line', placeholder: 'Coimbatore 641001' },
  { key: 'phone', label: 'Phone', placeholder: '+91 98765 43210', type: 'tel', half: true },
  { key: 'email', label: 'E-mail', placeholder: 'clinic@example.com', type: 'email', half: true },
  { key: 'website', label: 'Website', placeholder: 'www.example.com', type: 'url' },
];

export const MAX_IMAGE_BYTES = 1_000_000;

/**
 * Practice settings (personal spaces only): the header and signature every case-sheet PDF carries. Text fields, a
 * logo and a signature picture (PNG or JPEG, up to 1 MB), and a switch to print them or not. Only the doctor's own.
 *
 * PORTED from prefrontal-prepare-ui `features/settings/practice-card.component.ts` (logic unchanged). Adapted: the
 * LMS kit's field / input / toggle classes instead of the engine's fill classes, PracticeApi (practice-api.ts)
 * instead of CasesApi, the LMS DialogService, the file input found through a view query.
 */
@Component({
  selector: 'pf-cs-practice-card',
  standalone: true,
  imports: [PfIconComponent, SkeletonFormComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pc" aria-labelledby="pc-h">
      <div class="pc__head">
        <h2 class="pc__title" id="pc-h">On your PDFs</h2>
        <p class="pc__hint">The header and signature printed on every finished case sheet.</p>
      </div>
      <div class="pc__body">
        @if (!form()) {
          @if (loadError()) {
            <p class="pc__err" role="alert">{{ loadError() }}</p>
            <button type="button" class="pf-btn pf-btn--secondary pc__retry" (click)="load()">Try again</button>
          } @else {
            <pf-skeleton-form [fields]="6" [cols]="2" label="Loading your practice details" />
          }
        } @else {
          <button type="button" class="pf-toggle pc__switch" role="switch"
                  [attr.aria-checked]="form()!.enabled"
                  data-practice="enabled"
                  (click)="patch('enabled', !form()!.enabled)">
            <span class="pc__switch-lbl">Print my header and signature</span>
            <span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>
          </button>
          <div class="pc__grid">
            @for (r of rows; track r.key) {
              <label class="pf-field pc__f" [class.pc__f--half]="r.half">
                <span class="pf-field__lbl">{{ r.label }}</span>
                <input class="pf-input"
                       [attr.type]="r.type ?? 'text'"
                       [attr.inputmode]="r.type ?? null"
                       [attr.data-practice]="r.key"
                       [placeholder]="r.placeholder"
                       [value]="form()![r.key]"
                       maxlength="200"
                       (input)="patch(r.key, $any($event.target).value)" />
              </label>
            }
          </div>
          <div class="pc__imgs">
            @for (k of images; track k.kind) {
              <div class="pc__img" [attr.data-image]="k.kind">
                <span class="pf-field__lbl">{{ k.label }}</span>
                <div class="pc__frame">
                  @if (form()![k.kind]; as img) {
                    <img [src]="img.url" [alt]="k.label" />
                  } @else {
                    <span class="pc__none"><pf-icon name="image" [size]="22" /> {{ k.empty }}</span>
                  }
                </div>
                <div class="pc__acts">
                  <button type="button" class="pf-btn pf-btn--secondary" [disabled]="busy()" (click)="pick(k.kind)">
                    <pf-icon name="upload" [size]="18" /> {{ form()![k.kind] ? 'Change' : 'Add' }} {{ k.short }}
                  </button>
                  @if (form()![k.kind]) {
                    <button type="button" class="pf-btn pf-btn--tertiary" [disabled]="busy()" (click)="removeImage(k.kind)">
                      Remove
                    </button>
                  }
                </div>
              </div>
            }
            <input #file class="pc__file" type="file" accept="image/png,image/jpeg" tabindex="-1" aria-hidden="true"
                   (change)="upload($any($event.target))" />
          </div>
        }
        @if (message()) {
          <p class="pc__msg" role="status">{{ message() }}</p>
        }
        @if (form()) {
          <button type="button" class="pf-btn pf-btn--primary pc__save" data-testid="practice-save"
                  [disabled]="!dirty() || busy()"
                  [attr.aria-busy]="saving() ? 'true' : null"
                  (click)="save()">
            {{ saving() ? 'Saving…' : dirty() ? 'Save' : 'Saved' }}
          </button>
        }
      </div>
    </section>
  `,
  styles: [`
    .pc { display: flex; flex-direction: column; gap: 14px; padding: 16px 2px; border-top: 1px solid var(--border-muted); }
    .pc__title { margin: 0; font-size: 15px; font-weight: 600; color: var(--text-primary); }
    .pc__hint { margin: 2px 0 0; font-size: 13px; color: var(--text-tertiary); }
    .pc__body { display: flex; flex-direction: column; gap: 18px; }
    .pc__err { margin: 0; font-size: 13.5px; color: var(--red-text, #dc2626); }
    .pc__retry, .pc__save { align-self: flex-start; }
    .pc__save { min-width: 180px; }
    .pc__switch { align-self: flex-start; min-height: 44px; gap: 12px; font-size: 14px; white-space: normal; }
    .pc__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px 16px; }
    .pc__f { grid-column: span 2; }
    .pc__f--half { grid-column: span 1; }
    .pc__f .pf-input { min-height: 44px; font-size: 15px; }
    .pc__imgs { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
    .pc__img { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
    /* The paper the PDF prints on is white in both themes, so the preview frame is too. */
    .pc__frame {
      display: flex; align-items: center; justify-content: center; height: 110px; padding: 10px;
      border-radius: 12px; border: 1px dashed var(--pf-sel-border, #9aa4ae); background: #fff;
    }
    .pc__frame img { max-width: 100%; max-height: 100%; object-fit: contain; }
    .pc__none { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; color: #6b7280; }
    .pc__acts { display: flex; flex-wrap: wrap; gap: 8px; }
    .pc__msg { margin: 0; font-size: 13.5px; color: var(--text-secondary); }
    .pc__file { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; overflow: hidden; }
    @media (max-width: 640px) {
      .pc__f--half { grid-column: span 2; }
      .pc__imgs { grid-template-columns: 1fr; }
      .pc__f .pf-input { font-size: 16px; }
    }
  `],
})
export class PracticeCardComponent {
  private readonly api = inject(PracticeApi);
  private readonly dialog = inject(DialogService);
  private readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('file');

  protected readonly rows = ROWS;
  protected readonly images = [
    { kind: 'logo' as const, label: 'Logo (top of the page)', short: 'logo', empty: 'No logo yet' },
    { kind: 'signature' as const, label: 'Signature (end of the sheet)', short: 'signature', empty: 'No signature yet' },
  ];

  private readonly saved = signal<PracticeSettings | null>(null);
  protected readonly form = signal<PracticeSettings | null>(null);
  protected readonly loadError = signal('');
  protected readonly saving = signal(false);
  protected readonly uploading = signal(false);
  protected readonly busy = computed(() => this.saving() || this.uploading());
  protected readonly message = signal('');
  protected readonly dirty = computed(() => {
    const a = this.form();
    const b = this.saved();
    if (!a || !b) return false;
    return a.enabled !== b.enabled || ROWS.some((r) => (a[r.key] ?? '') !== (b[r.key] ?? ''));
  });
  private pickFor: 'logo' | 'signature' = 'logo';

  constructor() {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.loadError.set('');
    try {
      const s = await this.api.getPractice();
      this.saved.set(s);
      this.form.set({ ...s });
    } catch {
      this.loadError.set('Can’t load your practice details right now.');
    }
  }

  protected patch<K extends keyof PracticeSettings>(key: K, value: PracticeSettings[K]): void {
    this.message.set('');
    this.form.update((f) => (f ? { ...f, [key]: value } : f));
  }

  protected async save(): Promise<void> {
    const f = this.form();
    if (!f || this.saving()) return;
    this.saving.set(true);
    try {
      const s = await this.api.savePractice(f);
      this.saved.set(s);
      this.form.set({ ...s });
      this.message.set('Saved. New PDFs will carry these details.');
    } catch (e) {
      this.message.set(this.problem(e, 'Couldn’t save just now. Please try again.'));
    } finally {
      this.saving.set(false);
    }
  }

  protected pick(kind: 'logo' | 'signature'): void {
    this.pickFor = kind;
    const input = this.fileInput()?.nativeElement;
    if (input) {
      input.value = '';
      input.click();
    }
  }

  protected async upload(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    if (!file) return;
    if (!/^image\/(png|jpeg)$/.test(file.type)) {
      this.message.set('Use a PNG or a JPEG picture.');
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      this.message.set('That picture is larger than 1 MB. Use a smaller one.');
      return;
    }
    this.uploading.set(true);
    try {
      const s = await this.api.uploadPracticeImage(this.pickFor, file);
      this.keepTextEdits(s);
      this.message.set(this.pickFor === 'logo' ? 'Logo added.' : 'Signature added.');
    } catch (e) {
      this.message.set(this.problem(e, 'Couldn’t add the picture just now. Please try again.'));
    } finally {
      this.uploading.set(false);
    }
  }

  protected async removeImage(kind: 'logo' | 'signature'): Promise<void> {
    const ok = await this.dialog.confirm({
      title: kind === 'logo' ? 'Remove the logo?' : 'Remove the signature?',
      message: 'New PDFs will print without it. Finished case sheets keep what they printed.',
      confirmLabel: 'Remove',
      cancelLabel: 'Keep',
      tone: 'danger',
    });
    if (!ok) return;
    this.uploading.set(true);
    try {
      this.keepTextEdits(await this.api.removePracticeImage(kind));
    } catch (e) {
      this.message.set(this.problem(e, 'Couldn’t remove it just now. Please try again.'));
    } finally {
      this.uploading.set(false);
    }
  }

  /** A picture change returns fresh settings; keep any unsaved typing. */
  private keepTextEdits(s: PracticeSettings): void {
    const f = this.form();
    this.saved.update((old) => (old ? { ...old, logo: s.logo, signature: s.signature } : s));
    this.form.set(f ? { ...f, logo: s.logo, signature: s.signature } : { ...s });
  }

  private problem(e: unknown, fallback: string): string {
    if (e instanceof HttpErrorResponse) {
      if (e.status === 0) return 'Can’t reach Prefrontal right now. Check the connection.';
      const err = e.error as { code?: string; detail?: string } | null;
      if (err?.code === 'unsupported_image' || err?.code === 'image_size' || err?.code === 'too_large')
        return err.detail ?? fallback;
      if (e.status === 400) return 'Please check the details: one is too long or has characters that can’t be saved.';
    }
    return fallback;
  }
}
