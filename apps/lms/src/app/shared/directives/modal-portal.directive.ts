import { Directive, ElementRef, OnDestroy, OnInit, inject } from '@angular/core';
import { DOCUMENT } from '@angular/common';

/**
 * Moves the host element to document.body on initialization to escape
 * any ancestor CSS stacking contexts (like .shell-main + sticky header).
 * Cleans up by removing the element from the body on destruction.
 */
@Directive({
  selector: '[pfModalPortal]',
  standalone: true
})
export class ModalPortalDirective implements OnInit, OnDestroy {
  private readonly el = inject(ElementRef<HTMLElement>).nativeElement;
  private readonly doc = inject(DOCUMENT);
  private originalParent: HTMLElement | null = null;
  private placeholder: Comment | null = null;

  ngOnInit(): void {
    this.originalParent = this.el.parentElement;
    if (this.originalParent) {
      this.placeholder = this.doc.createComment('pfModalPortal-placeholder');
      this.originalParent.insertBefore(this.placeholder, this.el);
      this.doc.body.appendChild(this.el);
    }
  }

  ngOnDestroy(): void {
    if (this.el.parentElement === this.doc.body) {
      this.el.remove();
    }
    if (this.placeholder && this.placeholder.parentElement) {
      this.placeholder.remove();
    }
  }
}
