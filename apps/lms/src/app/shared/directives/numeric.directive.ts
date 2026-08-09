import { Directive, HostListener, Input } from '@angular/core';

/**
 * Directive to restrict text input to numeric digits (0-9) and enforce max digit length.
 * Usage: `<input type="text" pfNumeric />` or `<input pfNumeric [maxDigits]="10" />`
 */
@Directive({
  selector: '[pfNumeric]',
  standalone: true,
})
export class NumericDirective {
  @Input() allowDecimal = false;
  @Input() maxDigits?: number | null;

  @HostListener('keydown', ['$event'])
  onKeyDown(event: KeyboardEvent) {
    const allowedKeys = [
      'Backspace', 'Tab', 'End', 'Home', 'ArrowLeft', 'ArrowRight', 'Delete', 'Enter'
    ];
    if (allowedKeys.includes(event.key) || event.ctrlKey || event.metaKey) {
      return;
    }

    const input = event.target as HTMLInputElement;

    if (this.allowDecimal && event.key === '.') {
      if (input && !input.value.includes('.')) {
        return;
      }
    }

    if (!/^\d$/.test(event.key)) {
      event.preventDefault();
      return;
    }

    // Check maxDigits limit
    if (this.maxDigits != null && this.maxDigits > 0 && input) {
      const selectionLength = (input.selectionEnd ?? 0) - (input.selectionStart ?? 0);
      if (input.value.length - selectionLength >= this.maxDigits) {
        event.preventDefault();
      }
    }
  }

  @HostListener('paste', ['$event'])
  onPaste(event: ClipboardEvent) {
    const clipboardData = event.clipboardData;
    if (!clipboardData) return;
    event.preventDefault();

    const pastedText = clipboardData.getData('text');
    let sanitized = pastedText.replace(this.allowDecimal ? /[^0-9.]/g : /\D/g, '');

    const input = event.target as HTMLInputElement;
    if (this.maxDigits != null && this.maxDigits > 0 && input) {
      const start = input.selectionStart ?? 0;
      const end = input.selectionEnd ?? 0;
      const spaceLeft = this.maxDigits - (input.value.length - (end - start));
      if (spaceLeft <= 0) return;
      sanitized = sanitized.substring(0, spaceLeft);
    }

    document.execCommand('insertText', false, sanitized);
  }
}
