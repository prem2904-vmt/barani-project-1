import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { FormDefinition, IconName, PageDef, PfIconComponent, ShowWhenDef, edit, medicalIcon, setPageGroup } from '@prefrontal/forms-engine';
import { PfSelectOption, SelectComponent } from '@prefrontal/shared';
import { ConditionsComponent } from '../shared/conditions.component';
import { IconPickerComponent } from '../shared/icon-picker.component';
import { EditorStore } from './editor-store';

/**
 * The legacy "Page Settings" box: title, subtitle, section, the medical icon, colour, "Required Page", "Can Skip" and
 * "Show page conditionally". Opened from the canvas's page header. Nothing is kept until Save Changes.
 */
@Component({
  selector: 'st-page-settings',
  standalone: true,
  imports: [PfIconComponent, SelectComponent, IconPickerComponent, ConditionsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="lg-scrim" aria-hidden="true" (click)="closed.emit()"></div>
    <section class="lg-modal lg-modal--lg" role="dialog" aria-modal="true" aria-labelledby="ps-h" tabindex="-1" data-page-settings (keydown.escape)="$event.preventDefault(); closed.emit()">
      <header class="lg-modal__head">
        <h2 class="lg-modal__title" id="ps-h">Page Settings</h2>
        <button type="button" class="pf-btn pf-btn--icon" aria-label="Close" (click)="closed.emit()"><pf-icon name="x" [size]="18" /></button>
      </header>
      <div class="lg-modal__body">
        <div class="lg-row2">
          <div class="lg-field">
            <label class="lg-lbl" for="ps-t">Page Title</label>
            <input id="ps-t" class="pf-input" type="text" [value]="title()" (input)="title.set($any($event.target).value)" />
          </div>
          <div class="lg-field">
            <label class="lg-lbl" for="ps-s">Subtitle</label>
            <input id="ps-s" class="pf-input" type="text" [value]="subtitle()" (input)="subtitle.set($any($event.target).value)" />
          </div>
        </div>
        <div class="lg-row2">
          <div class="lg-field">
            <span class="lg-lbl">Internal Name</span>
            <span><code class="lg-code">{{ page().key }}</code></span>
          </div>
          <div class="lg-field">
            <span class="lg-lbl">Section</span>
            <pf-select [options]="groupOptions()" [value]="group()" (valueChange)="group.set($event ?? '')" />
          </div>
        </div>
        <div class="lg-field">
          <span class="lg-lbl">Medical Icon</span>
          <div class="ps-icon">
            @if (glyph(); as g) {
              <span class="ps-icon__p"><pf-icon [name]="g" [size]="26" /></span>
            } @else {
              <span class="lg-help">No icon selected</span>
            }
            <button type="button" class="pf-btn pf-btn--secondary" data-act="browse-icons" (click)="pickerOpen.set(!pickerOpen())">{{ icon() ? 'Change Icon' : 'Browse Icons' }}</button>
            @if (icon()) {
              <button type="button" class="pf-btn pf-btn--tertiary" (click)="icon.set('')">Remove</button>
            }
          </div>
          @if (pickerOpen()) {
            <st-icon-picker [value]="icon()" label="Choose an icon for this page" (valueChange)="icon.set($event ?? ''); pickerOpen.set(false)" />
          }
        </div>
        <div class="lg-field">
          <span class="lg-lbl">Page Color</span>
          <div class="lg-chips">
            @for (c of colors; track c) {
              <button type="button" class="ps-sw" [style.background]="c" [attr.aria-label]="'Colour ' + c" [attr.aria-pressed]="color() === c" (click)="color.set(color() === c ? '' : c)"></button>
            }
            <input class="pf-input ps-hex" type="text" placeholder="#3B82F6" aria-label="Colour as a hex code" [value]="color()" (input)="color.set($any($event.target).value)" />
          </div>
        </div>
        <div class="lg-rule"></div>
        <button type="button" role="switch" class="pf-toggle lg-switch" data-flag="page-required" [attr.aria-checked]="required()" (click)="required.set(!required())">
          <span class="pf-toggle__track"><span class="pf-toggle__knob"></span></span>
          <span>Required Page</span>
        </button>
        <button type="button" role="switch" class="pf-toggle lg-switch" data-flag="can-skip" [attr.aria-checked]="canSkip()" (click)="canSkip.set(!canSkip())">
          <span class="pf-toggle__track"><span class="pf-toggle__knob"></span></span>
          <span>Can Skip</span>
        </button>
        <div class="lg-rule"></div>
        <div class="lg-field" data-page-rule>
          <span class="lg-lbl">Show page conditionally</span>
          @if (def(); as d) {
            <st-conditions [definition]="d" [subject]="'the page ' + title()" [value]="showWhen()" [showDone]="false" (changed)="showWhen.set($event)" />
          }
        </div>
      </div>
      <footer class="lg-modal__foot">
        <button type="button" class="pf-btn pf-btn--secondary" (click)="closed.emit()">Cancel</button>
        <button type="button" class="pf-btn pf-btn--primary" data-act="save-page-settings" [disabled]="!title().trim()" (click)="save()">Save Changes</button>
      </footer>
    </section>
  `,
  styleUrls: ['../shared/lg-form.scss', '../shared/lg-modal-host.scss', '../shared/lg-modal.scss'],
  styles: [
    `
      .ps-icon {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .ps-icon__p {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 48px;
        height: 48px;
        border: 1px solid var(--pf-line);
        border-radius: 12px;
        color: var(--violet-text, #6d28d9);
      }
      .ps-sw {
        width: 26px;
        height: 26px;
        border: 2px solid transparent;
        border-radius: 999px;
        cursor: pointer;
      }
      .ps-sw[aria-pressed='true'] {
        border-color: var(--text-primary);
      }
      .ps-hex {
        width: 120px;
      }
    `,
  ],
})
export class PageSettingsComponent {
  readonly page = input.required<PageDef>();
  readonly closed = output<void>();
  private readonly store = inject(EditorStore);

  protected readonly def = this.store.def;
  protected readonly colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#64748b'];
  protected readonly title = signal('');
  protected readonly subtitle = signal('');
  protected readonly icon = signal('');
  protected readonly color = signal('');
  protected readonly group = signal('');
  protected readonly required = signal(false);
  protected readonly canSkip = signal(false);
  protected readonly showWhen = signal<ShowWhenDef | null>(null);
  protected readonly pickerOpen = signal(false);
  protected readonly glyph = computed<IconName | null>(() => medicalIcon(this.icon()));
  protected readonly groupOptions = computed<PfSelectOption<string>[]>(() => [
    { value: '', label: 'Uncategorized' },
    ...(this.store.def()?.groups ?? []).map((g) => ({ value: g.key, label: g.title })),
  ]);

  constructor() {
    queueMicrotask(() => this.load());
  }

  private load(): void {
    const p = this.page();
    this.title.set(p.title);
    this.subtitle.set(p.subtitle ?? '');
    this.icon.set(p.icon ?? '');
    this.color.set(p.color ?? '');
    this.group.set(p.group ?? '');
    this.required.set(!!p.required);
    this.canSkip.set(!!p.canSkip);
    this.showWhen.set(structuredClone(p.showWhen ?? null));
  }

  protected save(): void {
    const key = this.page().key;
    const t = this.title().trim();
    if (!t) return;
    this.store.edit((d: FormDefinition) => {
      const next = edit(d, (x) => {
        const p = x.pages.find((y) => y.key === key);
        if (!p) return;
        if (p.title !== t) {
          const s = x.narrative?.sections.find((y) => y.key === key);
          if (s && s.title === p.title) s.title = t;
          p.title = t;
        }
        p.subtitle = this.subtitle().trim() || undefined;
        p.icon = this.icon() || undefined;
        p.color = this.color().trim() || undefined;
        p.required = this.required() || undefined;
        p.canSkip = this.canSkip() || undefined;
        p.showWhen = this.showWhen()?.conditions?.length ? this.showWhen() : null;
      });
      return setPageGroup(next, key, this.group() || null);
    });
    this.closed.emit();
  }
}
