import { Directive, ElementRef, afterNextRender, inject, input } from '@angular/core';

/**
 * Focus a box the moment it appears (the HTML `autofocus` attribute only works
 * once per page load). Studio's in-place edits (a question's name, a sentence)
 * open ready to type; `stAutofocusSelect` also selects the old text.
 */
@Directive({ selector: '[stAutofocus]', standalone: true })
export class AutofocusDirective {
  readonly stAutofocusSelect = input(false);
  private readonly el = inject<ElementRef<HTMLInputElement | HTMLTextAreaElement>>(ElementRef);

  constructor() {
    afterNextRender(() => {
      const box = this.el.nativeElement;
      box.focus({ preventScroll: true });
      if (this.stAutofocusSelect()) box.select?.();
      else if (typeof box.value === 'string') box.setSelectionRange?.(box.value.length, box.value.length);
    });
  }
}
