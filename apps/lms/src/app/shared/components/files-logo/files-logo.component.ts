import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { ThemeService } from '../../../core/services/theme.service';
import { FILES_APPS, FilesApp, LogoPart, filesApp } from '../../../features/files/files-registry';

/**
 * An app's logo (Neuron, Synapse, Axon, Myelin, Retina), drawn from its registry entry: a rounded tile in the app colour (the dark
 * variant in dark mode) with a white glyph. At 24px and below the outline is dropped and the strokes are thicker (readable on the bar).
 * Decorative by default (the label beside it names the app); pass `label` where it stands alone.
 */
@Component({
  selector: 'pf-files-logo',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (def(); as a) {
      <svg [attr.width]="size()" [attr.height]="size()" viewBox="0 0 48 48" [attr.role]="label() ? 'img' : null" [attr.aria-label]="label() || null"
           [attr.aria-hidden]="label() ? null : 'true'" [attr.data-files-logo]="a.id">
        <rect width="48" height="48" rx="12" [attr.fill]="fill()" />
        @for (p of parts(); track $index) {
          @switch (p.t) {
            @case ('path') {
              <path [attr.d]="$any(p).d" fill="none" stroke="#ffffff" [attr.stroke-opacity]="$any(p).opacity ?? 1" [attr.stroke-width]="$any(p).stroke ?? 2"
                    stroke-linecap="round" [attr.stroke-linejoin]="$any(p).join ? 'round' : null" [attr.stroke-dasharray]="$any(p).dash ?? null" />
            }
            @case ('circle') { <circle [attr.cx]="$any(p).cx" [attr.cy]="$any(p).cy" [attr.r]="$any(p).r" fill="#ffffff" /> }
            @case ('rect') {
              <rect [attr.x]="$any(p).x" [attr.y]="$any(p).y" [attr.width]="$any(p).w" [attr.height]="$any(p).h" [attr.rx]="$any(p).rx" fill="none" stroke="#ffffff"
                    [attr.stroke-opacity]="$any(p).opacity ?? 1" [attr.stroke-width]="$any(p).stroke ?? 2" />
            }
          }
        }
      </svg>
    }
  `,
  styles: [`:host { display: inline-flex; line-height: 0; flex: none; } svg { display: block; }`],
})
export class FilesLogoComponent {
  readonly app = input.required<string>();
  readonly size = input(24);
  readonly label = input('');
  private readonly theme = inject(ThemeService);
  protected readonly def = computed<FilesApp | undefined>(() => filesApp(this.app()) ?? FILES_APPS.find(a => a.id === this.app()));
  protected readonly fill = computed(() => (this.theme.isDark() ? this.def()?.colorDark : this.def()?.color) ?? '#7c3aed');
  protected readonly parts = computed<readonly LogoPart[]>(() => (this.size() <= 24 ? this.def()?.logoSmall : this.def()?.logo) ?? []);
}
