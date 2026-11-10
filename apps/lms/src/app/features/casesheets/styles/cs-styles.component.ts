import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, ViewEncapsulation, inject, input } from '@angular/core';

/** The class on <html> while any case-sheet screen is open (styles/_touch.scss scopes the 48px raise to it). */
export const CS_TOUCH_CLASS = 'cs-touch';

let open = 0;

/**
 * Drop `<cs-styles />` into every case-sheet screen (WP5 filler / Departments / sheets; WP6 / WP7 may reuse it).
 *  - Its stylesheet (ViewEncapsulation.None) is the case sheets' global CSS: the forms engine's `fe-*` fill controls and
 *    the touch rules. Angular adds it to the document the first time a case-sheet screen renders, so the lab's own
 *    stylesheet and first download never carry it.
 *  - While at least one is on screen, `<html>` carries `cs-touch`: the kit's buttons, inputs, pf-select and dialog
 *    buttons are 48px (Prepare's app-wide rule), and only then — every lab screen keeps the kit as it is.
 */
@Component({
  selector: 'cs-styles',
  standalone: true,
  template: '',
  styleUrl: './_cs-global.scss',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { hidden: '', 'aria-hidden': 'true' },
})
export class CsStylesComponent implements OnInit, OnDestroy {
  private readonly doc = inject(DOCUMENT);
  /** Studio (the desk editor) needs the `fe-*` controls styled but not the 48px touch raise: `[touch]="false"`. */
  readonly touch = input(true);
  private counted = false;

  ngOnInit(): void {
    if (!this.touch()) return;
    this.counted = true;
    if (open++ === 0) this.doc.documentElement.classList.add(CS_TOUCH_CLASS);
  }

  ngOnDestroy(): void {
    if (!this.counted) return;
    if (--open <= 0) {
      open = 0;
      this.doc.documentElement.classList.remove(CS_TOUCH_CLASS);
    }
  }
}
