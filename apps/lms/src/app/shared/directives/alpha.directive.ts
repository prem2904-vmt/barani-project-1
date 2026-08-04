import { Directive, HostListener, Input } from '@angular/core';

/**
 * Directive to restrict input to alphabetic characters, spaces, hyphens, and apostrophes (for Name fields)
 * or strictly alphanumeric characters (letters + numbers only) if `allowNumbers` is true.
 * Usage: `<input type="text" pfAlpha />` or `<input pfAlpha [allowNumbers]="true" />`
 */
@Directive({
  selector: '[pfAlpha]',
  standalone: true,
})
export class AlphaDirective {
  @Input() allowNumbers = false;

  @HostListener('keydown', ['$event'])
  onKeyDown(event: KeyboardEvent) {
    const allowedKeys = [
      'Backspace', 'Tab', 'End', 'Home', 'ArrowLeft', 'ArrowRight', 'Delete', 'Enter'
    ];
    if (allowedKeys.includes(event.key) || event.ctrlKey || event.metaKey) {
      return;
    }

    const pattern = this.allowNumbers
      ? /^[a-zA-Z0-9]$/
      : /^[a-zA-Z\u00C0-\u024F\s.'-]$/;

    if (!pattern.test(event.key)) {
      event.preventDefault();
    }
  }

  @HostListener('paste', ['$event'])
  onPaste(event: ClipboardEvent) {
    const clipboardData = event.clipboardData;
    if (!clipboardData) return;
    const pastedText = clipboardData.getData('text');
    const pattern = this.allowNumbers
      ? /[^a-zA-Z0-9]/g
      : /[^a-zA-Z\u00C0-\u024F\s.'-]/g;

    if (pattern.test(pastedText)) {
      event.preventDefault();
      const sanitized = pastedText.replace(pattern, '');
      document.execCommand('insertText', false, sanitized);
    }
  }
}
