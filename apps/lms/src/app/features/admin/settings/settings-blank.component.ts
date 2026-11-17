import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * The body of a setting's own path when that path only forwards to its first category (Outsourcing, Analyzers and
 * bridges, Work steps and forms): the Settings shell shows the categories and hops to the first one on wide
 * screens; on a phone the person picks. Renders nothing itself.
 */
@Component({
  selector: 'pf-settings-blank',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
})
export class SettingsBlankComponent {}
