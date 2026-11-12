import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FieldDef, IconName, PALETTE, PALETTE_GROUPS, PaletteEntry, PfIconComponent, addPaletteField, allFields, findField, insertFieldTemplate } from '@prefrontal/forms-engine';
import { DialogService } from '../../../../core/services/dialog.service';
import { StudioApi } from '../data/studio-api';
import { TemplateRow, plainError } from '../data/studio-models';
import { EditorStore } from './editor-store';

/**
 * The legacy Studio's right panel when no question is selected: "Components - Click to add to selected page", in the
 * legacy groups (Input Fields, Selection Fields, Special Fields) with a 4th group "Department" for the kinds the old
 * Studio never had, then "Saved Templates". One click adds the question at the end of the page.
 */
@Component({
  selector: 'st-components-panel',
  standalone: true,
  imports: [PfIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="cp" data-components>
      <div class="cp-head">
        <h3 class="cp-title">Components</h3>
        <p class="cp-hint">Click to add to selected page</p>
      </div>
      @for (g of groups; track g.title) {
        <section class="cp-sec" [attr.data-group]="g.title">
          <h4 class="cp-sec__t">{{ g.title }}</h4>
          <div class="cp-grid">
            @for (e of g.entries; track e.id) {
              <button type="button" class="cp-btn" [attr.data-component]="e.id" [attr.title]="e.label + ': ' + e.hint" [disabled]="!hasPage()" (click)="add(e)">
                <span class="cp-ic"><pf-icon [name]="icon(e)" [size]="20" /></span>
                <span class="cp-lbl">{{ e.label }}</span>
              </button>
            }
          </div>
        </section>
      }
      @if (saved().length) {
        <section class="cp-sec" data-group="Saved Templates">
          <h4 class="cp-sec__t">Saved Templates</h4>
          <ul class="cp-tpl" role="list">
            @for (t of saved(); track t.id) {
              <li class="cp-tpl__row">
                <button type="button" class="cp-tpl__b" [attr.data-template]="t.id" [attr.title]="t.category || t.title" [disabled]="!hasPage() || busy()" (click)="addSaved(t)">
                  <pf-icon name="copy" [size]="16" />
                  <span class="cp-tpl__n">{{ t.title }}</span>
                </button>
                <button type="button" class="pf-btn pf-btn--icon cp-tpl__x" [attr.aria-label]="'Delete the saved template ' + t.title" (click)="remove(t)"><pf-icon name="x" [size]="16" /></button>
              </li>
            }
          </ul>
        </section>
      }
      @if (error()) {
        <p class="cp-err" role="alert">{{ error() }}</p>
      }
      <p class="cp-tip"><pf-icon name="info" [size]="16" /> Drag questions within the page to reorder them</p>
    </div>
  `,
  styles: [
    `
      .cp {
        display: grid;
        gap: 18px;
        align-content: start;
      }
      .cp-title {
        margin: 0 0 2px;
        font-size: 16px;
        font-weight: 600;
      }
      .cp-hint {
        margin: 0;
        font-size: 12.5px;
        color: var(--text-tertiary);
      }
      .cp-sec__t {
        margin: 0 0 10px;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--text-tertiary);
      }
      .cp-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
      }
      .cp-btn {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        min-height: 72px;
        padding: 10px 6px;
        border: 1px solid var(--pf-line);
        border-radius: 12px;
        background: var(--pf-card-bg);
        color: var(--text-secondary);
        font: inherit;
        cursor: pointer;
        transition: border-color 0.15s, background 0.15s;
      }
      .cp-btn:hover:not(:disabled) {
        border-color: var(--color-primary, #7c3aed);
        background: color-mix(in srgb, var(--color-primary, #7c3aed) 7%, var(--pf-card-bg));
      }
      .cp-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .cp-ic {
        color: var(--violet-text, #7c3aed);
        line-height: 0;
      }
      .cp-lbl {
        font-size: 12px;
        line-height: 1.25;
        text-align: center;
      }
      .cp-tpl {
        display: grid;
        gap: 6px;
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .cp-tpl__row {
        display: flex;
        align-items: center;
        gap: 4px;
      }
      .cp-tpl__b {
        display: flex;
        flex: 1;
        align-items: center;
        gap: 8px;
        min-width: 0;
        padding: 8px 10px;
        border: 1px solid var(--pf-line);
        border-radius: 10px;
        background: var(--pf-card-bg);
        color: var(--text-primary);
        font: inherit;
        font-size: 13px;
        text-align: left;
        cursor: pointer;
      }
      .cp-tpl__b:hover:not(:disabled) {
        border-color: var(--color-primary, #7c3aed);
      }
      .cp-tpl__n {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .cp-err {
        margin: 0;
        color: var(--red-text, #b91c1c);
        font-size: 13px;
      }
      .cp-tip {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        margin: 0;
        padding-top: 12px;
        border-top: 1px solid var(--pf-line);
        font-size: 12.5px;
        line-height: 1.4;
        color: var(--text-tertiary);
      }
      .cp-tip pf-icon {
        flex: none;
        margin-top: 1px;
      }
    `,
  ],
})
export class ComponentsPanelComponent {
  private readonly store = inject(EditorStore);
  private readonly api = inject(StudioApi);
  private readonly dialog = inject(DialogService);

  protected readonly saved = signal<TemplateRow[]>([]);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly hasPage = computed(() => !!this.store.page());

  /** The tiles the API's catalogue still offers (a kind the server dropped disappears); all of them while it has not loaded. */
  protected get groups() {
    const names = this.store.catalogue().map((k) => k.name);
    const offered = (e: PaletteEntry) => !names.length || names.includes(e.kind);
    return PALETTE_GROUPS.map((title) => ({ title, entries: PALETTE.filter((e) => e.group === title && offered(e)) })).filter((g) => g.entries.length);
  }

  constructor() {
    void this.api
      .templates('field')
      .then((t) => this.saved.set(t))
      .catch(() => undefined);
  }

  protected icon(e: PaletteEntry): IconName {
    return e.icon as IconName;
  }

  protected add(e: PaletteEntry): void {
    const p = this.store.page();
    if (!p) return;
    let key = '';
    this.store.edit((d) => {
      const r = addPaletteField(d, { pageKey: p.key }, e, this.store.defaultsFor(e.kind));
      key = r.key;
      return r.def;
    });
    this.store.afterAdd(key);
  }

  protected async addSaved(t: TemplateRow): Promise<void> {
    const d = this.store.def();
    const p = this.store.page();
    if (!d || !p) return;
    this.busy.set(true);
    try {
      const ex = await this.api.expandTemplate(t.id, allFields(d).map((f) => f.key), d.pages.map((x) => x.key));
      let keys: string[] = [];
      this.store.edit((x) => {
        const r = insertFieldTemplate(x, { pageKey: p.key }, [ex.body as FieldDef]);
        keys = r.keys;
        return r.def;
      });
      if (keys[0] && findField(this.store.def()!, keys[0])) this.store.afterAdd(keys[0]);
    } catch (e) {
      this.error.set(plainError(e, "Couldn't add that saved template."));
    } finally {
      this.busy.set(false);
    }
  }

  protected async remove(t: TemplateRow): Promise<void> {
    const ok = await this.dialog.confirm({
      title: `Delete the saved template “${t.title}”?`,
      message: 'Case sheets that already use it keep their copy.',
      confirmLabel: 'Delete',
      cancelLabel: 'Keep it',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await this.api.deleteTemplate(t.id);
      this.saved.update((l) => l.filter((x) => x.id !== t.id));
    } catch (e) {
      this.error.set(plainError(e, "Couldn't delete that template."));
    }
  }
}
