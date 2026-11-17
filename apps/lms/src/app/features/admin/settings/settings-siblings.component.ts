import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter, map, startWith } from 'rxjs';
import { SegmentedComponent, SegmentedOption } from '../../../shared/primitives/segmented.component';
import { SettingsAccessService } from './settings-access.service';
import { normPath, settingForPath, settingsPages } from './settings-map';

/**
 * The small page switch in a FULL-SCREEN settings page's band (DESIGN-V2 rule 2), like Test Master's view switch:
 * a setting made of several pages (Analyzers · Bridges, Referral labs · Partner prices, Work steps · Custom forms,
 * Report design · Report options …) lists them here. Renders nothing for a setting with one page. Pages come from
 * the ONE settings map; who sees which from SettingsAccessService.
 *
 * Drop it into the page's `band-tools`: `<pf-settings-siblings></pf-settings-siblings>`.
 */
@Component({
  selector: 'pf-settings-siblings',
  standalone: true,
  imports: [SegmentedComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (options().length > 1) {
      <pf-segmented class="pf-ssib" data-testid="settings-siblings" size="sm" [options]="options()" [value]="current()"
                    (valueChange)="open($event)" [attr.aria-label]="label()"></pf-segmented>
    }
  `,
  styles: [`:host { display: contents; } .pf-ssib { flex-shrink: 0; }`],
})
export class SettingsSiblingsComponent {
  private readonly router = inject(Router);
  private readonly access = inject(SettingsAccessService);

  private readonly path = toSignal(
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd), map(() => this.router.url), startWith(this.router.url)),
    { initialValue: this.router.url },
  );
  private readonly here = computed(() => normPath(this.path()));
  private readonly owner = computed(() => settingForPath(this.here()));
  private readonly pages = computed(() => {
    const o = this.owner();
    return o ? settingsPages(o.item, this.access.visibleCategories(o.item)) : [];
  });
  readonly label = computed(() => this.owner()?.item.label ?? 'Pages');
  readonly options = computed<SegmentedOption<string>[]>(() => this.pages().map((p) => ({ value: p.path, label: p.label })));
  readonly current = computed(() => this.here());

  open(path: string): void {
    const p = this.pages().find((x) => x.path === path);
    if (!p || p.path === this.here()) return;
    void this.router.navigate([p.path], { queryParams: p.query });
  }
}
