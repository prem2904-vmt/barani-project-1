import { casesheetLinks } from '../../casesheets.routes';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { PfIconComponent } from '@prefrontal/forms-engine';
import { SkeletonRowsComponent } from '@prefrontal/shared';
import { DialogService } from '../../../../core/services/dialog.service';
import { HeroBandComponent } from '../../../../shared/components/hero-band/hero-band.component';
import { StudioApi } from '../data/studio-api';
import { DiffChange, FormDetail, VersionDiff, VersionRow, plainError } from '../data/studio-models';
import { whenText } from '../shared/when';

const STATE_WORDS: Record<string, string> = { draft: 'Draft', in_review: 'In review', published: 'Live', retired: 'Earlier live version' };

/**
 * Version history: who made, saved and published each version, and what
 * changed between two of them in plain words ("Added the question Pain",
 * "Changed what Fever says"), grouped by page. Restore puts an older version
 * back as the new draft.
 */
@Component({
  selector: 'app-studio-history',
  standalone: true,
  imports: [HeroBandComponent, PfIconComponent, SkeletonRowsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pf-page pg st-desk cs-studio">
      <pf-hero-band [back]="true" [backTo]="links.adminForm(id())" [contextBar]="true" [customSearch]="true">
        <div band-search class="pf-ctx">
          <span class="pf-ctx__chip"><span class="pf-ctx__primary">Version history</span>
            @if (form()) { <span class="pf-ctx__k">{{ form()!.versions.length }} {{ form()!.versions.length === 1 ? 'version' : 'versions' }}</span> }
          </span>
        </div>
      </pf-hero-band>
      <div class="pf-body hi-body">
        <aside class="pf-card hi-versions" aria-labelledby="hi-v">
          <header class="pf-card__head">
            <span class="pf-card__icon"><pf-icon name="history" [size]="16" /></span>
            <h2 class="pf-card__label" id="hi-v">Versions</h2>
          </header>
          <div class="pf-card__body">
            @if (!form()) { <pf-skeleton-rows [rows]="4" label="Loading versions" /> }
            <ul class="hi-list" role="list">
              @for (v of form()?.versions ?? []; track v.id) {
                <li>
                  <button type="button" class="hi-row pf-touch" [attr.aria-current]="v.id === to() ? 'true' : null" [attr.data-version]="v.versionNo" (click)="pick(v)">
                    <span class="hi-row__t">Version {{ v.versionNo }} <span class="hi-state" [attr.data-state]="v.state">{{ words(v.state) }}</span></span>
                    <span class="hi-row__m">{{ who(v) }}</span>
                    @if (v.note) { <span class="hi-row__m">{{ v.note }}</span> }
                  </button>
                </li>
              }
            </ul>
          </div>
        </aside>
        <section class="pf-card hi-main" aria-labelledby="hi-c">
          <header class="pf-card__head">
            <span class="pf-card__icon"><pf-icon name="list-check" [size]="16" /></span>
            <h1 class="pf-card__label" id="hi-c">What changed</h1>
            @if (diff(); as d) { <span class="pf-card__count">version {{ d.from.versionNo }} → {{ d.to.versionNo }}</span> }
          </header>
          <div class="pf-card__body">
            @if (error()) { <p class="hi-err" role="alert">{{ error() }}</p> }
            @if (toRow(); as v) {
              <div class="hi-top">
                <!-- nothing to compare with until there are two versions -->
                @if (earlier().length > 0) {
                  <span class="hi-cmp">Compare version {{ v.versionNo }} with</span>
                  <div class="hi-chips" role="radiogroup" aria-label="Compare with">
                    @for (o of earlier(); track o.id) {
                      <button type="button" role="radio" class="fe-chip" [attr.aria-checked]="o.id === from()" [attr.aria-pressed]="o.id === from()" (click)="from.set(o.id); compare()">version {{ o.versionNo }}</button>
                    }
                  </div>
                }
                @if (v.state !== 'draft' && v.state !== 'in_review') {
                  <button type="button" class="pf-btn pf-btn--secondary" data-act="restore" (click)="restore(v)"><pf-icon name="undo" [size]="18" /> Make this the new draft</button>
                }
              </div>
            }
            @if (diff(); as d) {
              <p class="hi-head" data-headline>{{ d.headline }}</p>
              <!-- a computer: one row per change, what it was and what it is now side by side -->
              <div class="hi-cols" aria-hidden="true">
                <span>What changed</span><span>Was (version {{ d.from.versionNo }})</span><span>Now (version {{ d.to.versionNo }})</span><span></span>
              </div>
              @for (g of groups(); track g.title) {
                <section class="hi-grp">
                  <h3 class="hi-grp__t">{{ g.title }}</h3>
                  <ul class="hi-changes" role="list">
                    @for (c of g.changes; track $index) {
                      <li class="hi-ch" [attr.data-type]="c.type">
                        <span class="hi-ch__w"><span class="hi-dot" [attr.data-type]="c.type" aria-hidden="true"></span>{{ c.words }}</span>
                        <span class="hi-was" [class.hi-empty]="!c.before">@if (c.before) { <span class="hi-k">Was: </span>{{ c.before }} }</span>
                        <span class="hi-now" [class.hi-empty]="!c.after">@if (c.after) { <span class="hi-k">Now: </span>{{ c.after }} }</span>
                        <span class="hi-act">
                          @if (c.fieldKey) {
                            <button type="button" class="pf-btn pf-btn--tertiary hi-go" (click)="go(c)">Show it in the form <pf-icon name="chevron-right" [size]="14" /></button>
                          }
                        </span>
                      </li>
                    }
                  </ul>
                </section>
              }
            } @else if (form() && form()!.versions.length < 2) {
              <div class="pf-empty pf-empty--compact"><h2 class="pf-empty__title">Only one version so far</h2><p class="pf-empty__body">After the next publish, the changes between versions show here.</p></div>
            }
          </div>
        </section>
      </div>
    </div>
  `,
  styleUrls: ['../shared/page.scss', './history.page.scss'],
})
export class StudioHistoryPage {
  protected readonly links = casesheetLinks;
  readonly id = input.required<string>();
  private readonly api = inject(StudioApi);
  private readonly dialog = inject(DialogService);
  private readonly router = inject(Router);

  protected readonly form = signal<FormDetail | null>(null);
  protected readonly diff = signal<VersionDiff | null>(null);
  protected readonly from = signal<string | null>(null);
  protected readonly to = signal<string | null>(null);
  protected readonly error = signal('');

  constructor() {
    effect(() => {
      const id = this.id();
      untracked(() => void this.load(id));
    });
  }

  private async load(id: string): Promise<void> {
    try {
      const f = await this.api.form(id);
      this.form.set(f);
      const [newest, prev] = f.versions;
      if (newest) this.pick(newest, prev);
    } catch (e) {
      this.error.set(plainError(e, "Can't load the history."));
    }
  }

  protected words(state: string): string {
    return STATE_WORDS[state] ?? state;
  }

  protected who(v: VersionRow): string {
    if (v.publishedAt) return `Published ${whenText(v.publishedAt)}${v.publishedBy ? ' by ' + (v.publishedBy.name || v.publishedBy.email) : ''}`;
    const by = v.savedBy ?? v.createdBy;
    return `Saved ${whenText(v.updatedAt)}${by ? ' by ' + (by.name || by.email) : ''}`;
  }

  protected readonly toRow = computed(() => this.form()?.versions.find((v) => v.id === this.to()) ?? null);
  protected readonly earlier = computed(() => {
    const t = this.toRow();
    return (this.form()?.versions ?? []).filter((v) => t && v.versionNo < t.versionNo);
  });

  protected pick(v: VersionRow, against?: VersionRow): void {
    this.to.set(v.id);
    const prev = against ?? this.form()?.versions.find((x) => x.versionNo < v.versionNo);
    this.from.set(prev?.id ?? null);
    void this.compare();
  }

  async compare(): Promise<void> {
    const from = this.from();
    const to = this.to();
    if (!from || !to) {
      this.diff.set(null);
      return;
    }
    try {
      this.diff.set(await this.api.diff(this.id(), from, to));
    } catch (e) {
      this.error.set(plainError(e, "Can't compare these versions."));
    }
  }

  protected readonly groups = computed(() => {
    const out: { title: string; changes: DiffChange[] }[] = [];
    for (const c of this.diff()?.changes ?? []) {
      const title = c.pageTitle || 'Whole form';
      let g = out.find((x) => x.title === title);
      if (!g) out.push((g = { title, changes: [] }));
      g.changes.push(c);
    }
    return out;
  });

  protected async restore(v: VersionRow): Promise<void> {
    const ok = await this.dialog.confirm({
      title: `Make version ${v.versionNo} the new draft?`,
      message: 'Its pages and questions become a new draft you can change and publish. The live version stays until then.',
      confirmLabel: 'Make the draft',
      cancelLabel: 'Cancel',
    });
    if (!ok) return;
    try {
      await this.api.restore(this.id(), v.id);
      await this.router.navigate([casesheetLinks.adminForm(this.id())]);
    } catch (e) {
      this.error.set(plainError(e));
    }
  }

  protected go(c: DiffChange): void {
    void this.router.navigate([casesheetLinks.adminForm(this.id())], { queryParams: { field: c.fieldKey } });
  }
}
