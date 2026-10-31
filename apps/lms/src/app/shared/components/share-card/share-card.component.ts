import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ShareService } from '../../../core/services/share.service';
import { ShareCard, cardChip, cardEyebrow, cardIcon } from '../../utils/share-card';

/**
 * The ONE shared-record card (docs/PF-PATTERN.md §18 "Shared records") —
 * Messages (classic + new design), the floating chat windows and the "Send to
 * colleague" sheet preview all draw it. Violet icon chip · eyebrow · title ·
 * subtitle · status chip (a result's flag in words). Tap → the server
 * resolves it for ME → open, or a friendly "no access" / "In Branch X —
 * switch?" (ShareService.openCard). `preview` = a static, non-tappable copy.
 */
@Component({
  selector: 'pf-share-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (preview()) {
      <div class="pf-scard pf-scard--static" [attr.data-type]="card().type" [attr.data-variant]="variant()">
        <ng-container *ngTemplateOutlet="body"></ng-container>
      </div>
    } @else {
      <button type="button" class="pf-scard" [attr.data-type]="card().type" [attr.data-variant]="variant()"
              [attr.aria-busy]="busy() || null" [disabled]="busy()"
              [attr.aria-label]="'Open ' + eyebrow().toLowerCase() + ': ' + card().title + (card().subtitle ? ', ' + card().subtitle : '')"
              (click)="open($event)">
        <ng-container *ngTemplateOutlet="body"></ng-container>
        <svg class="pf-scard__go" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
      </button>
    }
    <ng-template #body>
      <span class="pf-scard__icon" aria-hidden="true">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" [innerHTML]="icon()"></svg>
      </span>
      <span class="pf-scard__meta">
        <span class="pf-scard__k">{{ eyebrow() }}</span>
        <span class="pf-scard__t">{{ card().title }}</span>
        @if (card().subtitle) { <span class="pf-scard__s">{{ card().subtitle }}</span> }
        @if (chip(); as c) { <span class="pf-scard__chip" [attr.data-tone]="c.tone">{{ c.label }}</span> }
      </span>
    </ng-template>
  `,
  imports: [NgTemplateOutlet],
  styles: [`
    :host { display: block; max-width: 100%; }
    .pf-scard {
      display: flex; align-items: center; gap: 10px; width: 100%; min-width: 220px; min-height: 52px; padding: 9px 10px;
      border-radius: 12px; border: 1px solid var(--pf-line, var(--glass-border)); background: var(--pf-card-bg, var(--bg-secondary));
      color: var(--text-primary); text-align: left; font: inherit; cursor: pointer;
      transition: border-color var(--pf-dur-fast, 200ms) ease, opacity var(--pf-dur-fast, 200ms) ease;
    }
    .pf-scard--static { cursor: default; }
    button.pf-scard:hover:not(:disabled) { border-color: var(--pf-hover-border, rgba(124, 58, 237, 0.3)); }
    button.pf-scard:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: 2px; }
    button.pf-scard:disabled { opacity: .6; cursor: progress; }
    .pf-scard__icon {
      flex: none; width: 32px; height: 32px; border-radius: 9px; display: inline-flex; align-items: center; justify-content: center;
      background: color-mix(in srgb, var(--color-primary, #7c3aed) 14%, transparent); color: var(--violet-text, #7c3aed);
    }
    .pf-scard__meta { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 1px; }
    .pf-scard__k { font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--text-tertiary); }
    .pf-scard__t { font-size: 13.5px; font-weight: 600; line-height: 1.3; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
    .pf-scard__s { font-size: 12px; color: var(--text-secondary); overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
    .pf-scard__chip {
      margin-top: 4px; display: inline-flex; align-items: center; min-height: 20px; padding: 0 8px; border-radius: 999px;
      font-size: 11px; font-weight: 600; background: var(--pf-chip-bg, rgba(100, 116, 139, 0.12)); color: var(--text-secondary);
      border: 1px solid var(--pf-line, transparent);
    }
    .pf-scard__chip[data-tone='critical'] {
      color: var(--pf-toggle-urgent, #ef4444); border-color: color-mix(in srgb, var(--pf-toggle-urgent, #ef4444) 35%, transparent);
      background: color-mix(in srgb, var(--pf-toggle-urgent, #ef4444) 8%, transparent);
    }
    .pf-scard__go { flex: none; color: var(--text-tertiary); }
    /* Floating chat windows: one size down. */
    .pf-scard[data-variant='compact'] { min-width: 0; min-height: 44px; padding: 7px 8px; gap: 8px; }
    .pf-scard[data-variant='compact'] .pf-scard__icon { width: 28px; height: 28px; }
    .pf-scard[data-variant='compact'] .pf-scard__t { font-size: 13px; }
    @media (max-width: 640px) { .pf-scard { min-width: 0; } }
    @media (prefers-reduced-motion: reduce) { .pf-scard { transition: none; } }
  `],
})
export class ShareCardComponent {
  private readonly share = inject(ShareService);
  private readonly sanitizer = inject(DomSanitizer);

  readonly card = input.required<ShareCard>();
  /** 'nd' (Messages bubbles), 'classic', 'compact' (floating windows). */
  readonly variant = input<'nd' | 'classic' | 'compact'>('nd');
  /** A static copy (the sheet's "what you're sending"). */
  readonly preview = input(false);
  /** The sender's name — "Ask Priya…" in the no-access notice. */
  readonly from = input<string | null>(null);

  protected readonly eyebrow = computed(() => cardEyebrow(this.card().type));
  protected readonly chip = computed(() => cardChip(this.card()));
  /** Static path data from CARD_ICONS (never user text). */
  protected readonly icon = computed<SafeHtml>(() => this.sanitizer.bypassSecurityTrustHtml(cardIcon(this.card().type)));
  protected readonly busy = computed(() => this.share.opening() === `${this.card().type}:${this.card().id}`);

  protected open(ev: Event): void {
    ev.stopPropagation();
    void this.share.openCard(this.card(), this.from());
  }
}
