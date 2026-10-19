import { Directive } from '@angular/core';

/** Apply the shared accessible text-field styles to a native input or textarea. */
@Directive({
  selector: 'input[pfInput], textarea[pfInput]',
  standalone: true,
  host: { class: 'pf-input' },
})
export class PfInputDirective {}