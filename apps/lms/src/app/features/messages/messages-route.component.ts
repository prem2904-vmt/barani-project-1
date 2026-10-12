import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ThemeService } from '../../core/services/theme.service';
import { MessagesPageComponent } from './messages-page.component';
import { MessagesNdComponent } from './messages-nd.component';

/**
 * /messages — picks the screen for the active design, live (the avatar
 * menu can switch New ⇄ Classic without a reload). The new design is the
 * pf-kit screen (MessagesNdComponent); classic keeps its page untouched.
 * `display: contents` so the chosen page sits in the shell exactly as if it
 * were routed directly (the band page fills .shell-main's height).
 */
@Component({
  selector: 'pf-messages-route',
  standalone: true,
  imports: [MessagesPageComponent, MessagesNdComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (theme.isNewDesign()) {
      <pf-messages-nd></pf-messages-nd>
    } @else {
      <app-messages-page></app-messages-page>
    }
  `,
  styles: [`:host { display: contents; }`]
})
export class MessagesRouteComponent {
  protected readonly theme = inject(ThemeService);
}
