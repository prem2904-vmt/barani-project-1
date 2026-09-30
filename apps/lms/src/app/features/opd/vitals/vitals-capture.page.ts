import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { map } from 'rxjs';
import { OpdVitalsWorkspaceComponent } from './vitals-workspace.component';

/** OPD → Vitals for one visit (`/opd/vitals/:visitId`) — AGENT B. The same
 *  station workspace with that visit open (desk / visit screen deep link). */
@Component({
  selector: 'pf-opd-vitals-capture',
  standalone: true,
  imports: [OpdVitalsWorkspaceComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<pf-opd-vitals-workspace [visitId]="visitId()"></pf-opd-vitals-workspace>`,
  styles: [':host { display: block; height: 100%; min-height: 0; }'],
})
export class OpdVitalsCapturePage {
  private readonly route = inject(ActivatedRoute);
  readonly visitId = toSignal(this.route.paramMap.pipe(map(p => p.get('visitId'))), { initialValue: null });
}
