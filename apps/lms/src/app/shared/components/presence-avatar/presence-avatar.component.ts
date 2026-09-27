import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { PresenceService } from '../../../core/services/presence.service';
import { presenceText, presenceTone } from '../../models/presence.model';

/**
 * The presence DOT on its own — for surfaces that already draw their own
 * avatar (the messages list / thread header). Place it inside a
 * `position: relative` avatar; it pins to the bottom-right with a ring in
 * the surface colour. One resolver for every avatar in messaging:
 * PresenceService.displayStatus (hub snapshot + live deltas + custom
 * statuses) — it updates while visible and resets on account switch.
 */
@Component({
  selector: 'pf-presence-dot',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'pf-pdot',
    role: 'img',
    '[attr.data-tone]': 'tone()',
    '[attr.aria-label]': 'label()',
    '[attr.title]': 'label()',
    '[attr.data-testid]': '"presence-dot"',
    '[hidden]': '!status()',
  },
  template: '',
  styles: [`
    :host {
      position: absolute; right: -1px; bottom: -1px; z-index: 1;
      width: var(--pf-pdot-size, 11px); height: var(--pf-pdot-size, 11px);
      border-radius: 9999px; box-sizing: border-box;
      border: 2px solid var(--pf-pdot-ring, var(--nd-card-bg, #fff));
      background: var(--nd-toggle-on, #aeb8c2);
      pointer-events: none;
    }
    :host([hidden]) { display: none; }
    /* Online = the app's reachable token (violet in the new design). */
    :host([data-tone='on']) { background: var(--pf-presence-on, var(--color-violet-600, #7c3aed)); }
    :host([data-tone='busy']) { background: var(--nd-toggle-on, #aeb8c2); }
    :host([data-tone='away']) { background: var(--nd-sel-border, #9aa4ae); }
    :host([data-tone='dnd']) { background: var(--nd-toggle-urgent, #d0706f); }
    :host([data-tone='off']) {
      background: var(--pf-pdot-ring, var(--nd-card-bg, #fff));
      box-shadow: inset 0 0 0 1.5px var(--nd-sel-border, #9aa4ae);
    }
    :host-context(.dark), :host-context([data-theme='dark']) { --pf-presence-on: #a78bfa; }
  `],
})
export class PresenceDotComponent {
  private readonly presence = inject(PresenceService);
  /** AuthId (sub). Empty / null → no dot (groups, notes-to-self). */
  readonly userId = input<string | null | undefined>(null);

  protected readonly status = computed(() => this.presence.displayStatus(this.userId()));
  protected readonly tone = computed(() => presenceTone(this.status()));
  protected readonly label = computed(() => this.status() ? presenceText(this.status()) : null);
}

/**
 * Avatar WITH presence — the one shared person avatar for messaging
 * surfaces that don't have their own (navbar Messages popover, chat
 * windows, call tiles, pickers). Neutral initials avatar (nd-kit anatomy)
 * + the presence dot. Groups pass `group` and get the group glyph, no dot.
 */
@Component({
  selector: 'pf-presence-avatar',
  standalone: true,
  imports: [PresenceDotComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'pf-pav', '[attr.data-size]': 'size()' },
  template: `
    <span class="pf-pav__face" aria-hidden="true">
      @if (group()) {
        <svg width="45%" height="45%" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
          <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
        </svg>
      } @else {
        {{ initialsText() }}
      }
    </span>
    @if (!group() && userId()) { <pf-presence-dot [userId]="userId()" /> }
  `,
  styles: [`
    :host {
      position: relative; display: inline-flex; flex: none;
      width: var(--pf-pav-size, 36px); height: var(--pf-pav-size, 36px);
    }
    :host([data-size='xs']) { --pf-pav-size: 26px; --pf-pav-font: 10.5px; --pf-pdot-size: 9px; }
    :host([data-size='sm']) { --pf-pav-size: 32px; --pf-pav-font: 12px; --pf-pdot-size: 10px; }
    :host([data-size='md']) { --pf-pav-size: 36px; --pf-pav-font: 13px; }
    :host([data-size='lg']) { --pf-pav-size: 64px; --pf-pav-font: 20px; --pf-pdot-size: 16px; }
    :host([data-size='xl']) { --pf-pav-size: 88px; --pf-pav-font: 28px; --pf-pdot-size: 20px; }
    .pf-pav__face {
      width: 100%; height: 100%;
      display: inline-flex; align-items: center; justify-content: center;
      border-radius: 9999px; box-sizing: border-box;
      background: var(--nd-chip-bg, #f3f4f6);
      border: 1px solid var(--nd-line, var(--border-muted, #e5e7eb));
      color: var(--text-secondary);
      font-size: var(--pf-pav-font, 13px); font-weight: 600; line-height: 1;
    }
  `],
})
export class PresenceAvatarComponent {
  /** Display name — initials are derived from it. */
  readonly name = input<string>('');
  /** Explicit initials (overrides `name`). */
  readonly initials = input<string | null>(null);
  /** AuthId for the presence dot; omit for no dot. */
  readonly userId = input<string | null | undefined>(null);
  readonly size = input<'xs' | 'sm' | 'md' | 'lg' | 'xl'>('md');
  readonly group = input(false);

  protected readonly initialsText = computed(() => {
    const explicit = this.initials();
    if (explicit) return explicit;
    const words = (this.name() || '?').trim().split(/\s+/).filter(Boolean);
    if (!words.length) return '?';
    const first = words[0][0] ?? '';
    const last = words.length > 1 ? (words[words.length - 1][0] ?? '') : '';
    return (first + last).toUpperCase() || '?';
  });
}
