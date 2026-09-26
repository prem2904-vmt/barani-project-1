import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { ThemeService } from '../../../core/services/theme.service';
import { ADMIN_CATEGORIES, AdminCategory, hubPages, searchAdmin } from '../../admin/admin-catalog';
import {
  AdminAccessService, AdminDirectoryComponent, AdminSearchResultsComponent,
} from '../../admin/admin-directory.component';

/**
 * Lab module settings hub (/lab/settings). The Lab category of the admin
 * catalogue as ONE list (ND-PATTERN "Admin pages"): every lab page one tap
 * away, only what the user may open. The band pill searches those pages AND
 * their single settings, deep-linking to the setting's row.
 */
@Component({
  selector: 'pf-lab-settings-hub',
  standalone: true,
  imports: [ScreenHeaderComponent, HeroBandComponent, AdminDirectoryComponent, AdminSearchResultsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-band-page px-4 md:px-8 lg:px-10 pt-6 pb-10">
      @if (theme.isNewDesign()) {
        <pf-hero-band [back]="true" placeholder="Search lab settings — try scan, report, tests"
                      [value]="q()" (valueChange)="q.set($event)"></pf-hero-band>
      }
      <pf-screen-header class="pf-classic-only"
        eyebrow="Lab"
        title="Lab settings"
        subtitle="Everything for your lab in one list.">
      </pf-screen-header>

      <div class="pf-band-body">
        @if (q().trim()) {
          <pf-admin-search-results [hits]="hits()" [query]="q().trim()"></pf-admin-search-results>
        } @else {
          <pf-admin-directory [categories]="[labCat()]" [showHeads]="false"></pf-admin-directory>
        }
      </div>
    </section>
  `,
})
export class LabSettingsHubComponent implements OnInit {
  protected readonly theme = inject(ThemeService);
  private readonly access = inject(AdminAccessService);
  /** Band pill search (pages + single settings of the Lab hub). */
  readonly q = signal('');

  readonly labCat = computed<AdminCategory>(() => {
    const base = ADMIN_CATEGORIES.find((c) => c.id === 'lab')!;
    return { ...base, pages: hubPages('lab', this.access) };
  });
  readonly hits = computed(() => searchAdmin(this.q(), this.access, [this.labCat()]));

  ngOnInit(): void { this.access.ensureLoaded(); }
}
