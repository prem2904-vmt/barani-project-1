import { casesheetLinks } from '../../casesheets.routes';
import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { kindBuild } from '@prefrontal/forms-engine';
import { PfIconComponent } from '@prefrontal/forms-engine';
import { HeroBandComponent } from '../../../../shared/components/hero-band/hero-band.component';
import { StudioApi } from '../data/studio-api';
import { ImportItem, ImportResult, plainError } from '../data/studio-models';

const MAX_BYTES = 25_000_000;

/**
 * Bring in a form from the old app: pick its file (the JSON the old Studio
 * exported) → a report in plain words (what came in, what needs a look, what
 * must be fixed) → bring it in as a draft and open it. Nothing is live until
 * it is published.
 */
@Component({
  selector: 'app-studio-import',
  standalone: true,
  imports: [HeroBandComponent, PfIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pf-page pg st-desk cs-studio">
      <pf-hero-band [back]="true" [backTo]="links.adminHome()" [contextBar]="true" [customSearch]="true">
        <div band-search class="pf-ctx"><span class="pf-ctx__chip"><span class="pf-ctx__primary">From the old Resident app</span><span class="pf-ctx__k">a .json file</span></span></div>
      </pf-hero-band>
      <div class="pf-body pf-body--split">
        <section class="pf-card main" aria-labelledby="im-h">
          <header class="pf-card__head">
            <span class="pf-card__icon"><pf-icon name="upload" [size]="16" /></span>
            <h1 class="pf-card__label" id="im-h">{{ result() ? 'What came in' : 'Pick the form file' }}</h1>
          </header>
          <div class="pf-card__body">
            <input #fileEl class="im-file" type="file" accept="application/json,.json" aria-label="Form file" (change)="picked($event)" />
            @if (!result()) {
              <div class="pf-empty">
                <span class="pf-empty__icon"><pf-icon name="file" [size]="26" /></span>
                <h2 class="pf-empty__title">Choose the old form’s file</h2>
                <p class="pf-empty__body">MyPrefrontal reads it, tells you in plain words what came across and what needs a look, and only then brings it in as a draft.</p>
                <button type="button" class="pf-btn pf-btn--primary" data-act="choose-file" [disabled]="busy()" [attr.aria-busy]="busy() ? 'true' : null" (click)="fileEl.click()">
                  <pf-icon name="upload" [size]="18" /> {{ busy() ? 'Reading…' : 'Choose a file' }}
                </button>
                @if (error()) { <p class="im-err" role="alert">{{ error() }}</p> }
              </div>
            } @else {
              @let r = result()!;
              <p class="im-summary" data-summary>{{ r.report.summary }}</p>
              <ul class="im-counts" role="list">
                <li><strong>{{ r.report.counts.pages }}</strong> pages</li>
                <li><strong>{{ r.report.counts.fields }}</strong> questions</li>
                <li><strong>{{ r.report.counts.attention }}</strong> need a look</li>
                <li [class.im-bad]="r.report.counts.problems"><strong>{{ r.report.counts.problems }}</strong> to fix before publishing</li>
              </ul>
              <div class="im-groups">
              @for (g of groups(); track g.level) {
                <section class="im-grp" [attr.data-level]="g.level">
                  <h2 class="im-grp__t">{{ g.title }}</h2>
                  <ul class="im-items" role="list">
                    @for (i of g.items; track $index) {
                      <li class="im-item">
                        @if (i.pageTitle || i.fieldLabel) { <span class="im-where">{{ i.pageTitle }}@if (i.fieldLabel) { · {{ i.fieldLabel }} }</span> }
                        <span>{{ i.message }}</span>
                      </li>
                    }
                  </ul>
                </section>
              }
              </div>
              @if (!groups().length) { <p class="im-ok"><pf-icon name="check" [size]="18" /> Everything came across.</p> }
              <!-- the form as it will come in: every page and its questions (wide screens: side by side) -->
              <section class="im-outline" aria-labelledby="im-o" data-outline>
                <h2 class="im-grp__t" id="im-o">The form as it comes in</h2>
                <ol class="im-pages" role="list">
                  @for (pg of outline(); track pg.key) {
                    <li class="im-page">
                      <span class="im-page__t">{{ pg.title }}</span>
                      <span class="im-page__n">{{ pg.fields.length }} {{ pg.fields.length === 1 ? 'question' : 'questions' }}</span>
                      <ul class="im-fields" role="list">
                        @for (f of pg.fields; track f.key) {
                          <li><span class="im-f__l">{{ f.label }}</span> <span class="im-f__k">{{ f.kind }}</span></li>
                        }
                      </ul>
                    </li>
                  }
                </ol>
              </section>
            }
          </div>
        </section>
        <aside class="pf-card side" aria-labelledby="im-s">
          <header class="pf-card__head">
            <span class="pf-card__icon"><pf-icon name="forms" [size]="16" /></span>
            <h2 class="pf-card__label" id="im-s">Bring it in</h2>
          </header>
          <div class="pf-card__body">
            @if (result()) {
              <label class="im-lbl" for="im-title">Form name</label>
              <input id="im-title" class="pf-input" type="text" [value]="title()" (input)="title.set($any($event.target).value)" />
              <p class="im-note">It comes in as a draft: nothing is live until you publish it. {{ result()!.report.canPublish ? 'It can be published as it is.' : 'Fix the things listed first.' }}</p>
              @if (error()) { <p class="im-err" role="alert">{{ error() }}</p> }
            } @else {
              <p class="im-note">After you choose a file, its report shows here and you can bring it in.</p>
            }
          </div>
          @if (result()) {
            <footer class="pf-card__foot">
              <button type="button" class="pf-btn pf-btn--secondary" (click)="reset(); fileEl.click()">Another file</button>
              <button type="button" class="pf-btn pf-btn--primary" data-act="import" [disabled]="busy() || !title().trim()" [attr.aria-busy]="busy() ? 'true' : null" (click)="bringIn()">
                {{ busy() ? 'Bringing in…' : 'Bring in as a draft' }}
              </button>
            </footer>
          }
        </aside>
      </div>
    </div>
  `,
  styleUrls: ['../shared/page.scss', './import.page.scss'],
})
export class StudioImportPage {
  protected readonly links = casesheetLinks;
  private readonly api = inject(StudioApi);
  private readonly router = inject(Router);
  private readonly fileEl = viewChild<ElementRef<HTMLInputElement>>('fileEl');

  protected readonly result = signal<ImportResult | null>(null);
  protected readonly title = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  private legacy: unknown = null;

  /** Every page with its questions, named the way Studio names them (never keys). */
  protected readonly outline = computed(() =>
    (this.result()?.definition.pages ?? []).map((p) => ({
      key: p.key,
      title: p.title || 'Untitled page',
      fields: (p.fields ?? []).map((f) => ({ key: f.key, label: f.label || 'Untitled question', kind: kindBuild(f.kind).name })),
    })),
  );

  protected readonly groups = computed(() => {
    const items = this.result()?.report.items ?? [];
    const by = (level: ImportItem['level']) => items.filter((i) => i.level === level);
    return [
      { level: 'problem', title: 'Must be fixed before publishing', items: by('problem') },
      { level: 'attention', title: 'Needs a look', items: by('attention') },
      { level: 'info', title: 'Good to know', items: by('info') },
    ].filter((g) => g.items.length);
  });

  async picked(e: Event): Promise<void> {
    const file = (e.target as HTMLInputElement).files?.[0];
    (e.target as HTMLInputElement).value = '';
    if (!file) return;
    await this.read(file);
  }

  /** Read a file and ask the API for the report (nothing saved yet). */
  async read(file: Blob): Promise<void> {
    this.error.set('');
    if (file.size > MAX_BYTES) {
      this.error.set('That file is too big for a form (over 25 MB).');
      return;
    }
    this.busy.set(true);
    try {
      const text = await file.text();
      try {
        this.legacy = JSON.parse(text);
      } catch {
        this.error.set("That file isn't a form from the old app (it isn't readable form data).");
        return;
      }
      const r = await this.api.importLegacy(this.legacy, { dryRun: true });
      this.result.set(r);
      this.title.set(r.definition.title ?? '');
    } catch (err) {
      this.error.set(plainError(err, "Couldn't read that form."));
    } finally {
      this.busy.set(false);
    }
  }

  protected reset(): void {
    this.result.set(null);
    this.legacy = null;
    this.error.set('');
  }

  protected async bringIn(): Promise<void> {
    if (!this.legacy) return;
    this.busy.set(true);
    this.error.set('');
    try {
      const r = await this.api.importLegacy(this.legacy, { dryRun: false, title: this.title().trim() });
      if (r.formId) await this.router.navigate([casesheetLinks.adminForm(r.formId)]);
    } catch (e) {
      this.error.set(plainError(e, "Couldn't bring it in."));
    } finally {
      this.busy.set(false);
    }
  }
}
