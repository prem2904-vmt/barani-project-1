import { Injectable, computed, inject, signal } from '@angular/core';
import { DialogService } from '../../../../core/services/dialog.service';
import { StudioSession } from '../data/studio-session';
import { CaseSheetBuilderApi } from './builder-api';
import { CortexStep, builderWords } from './builder-models';
import { ChecksStore } from './checks.store';

export interface ChatMessage {
  id: number;
  from: 'user' | 'cortex';
  text: string;
  steps?: CortexStep[];
  /** A refusal or failure, shown as a quiet error line rather than a normal reply. */
  error?: boolean;
}

/**
 * The Cortex chat on one form. Cortex only edits the DRAFT on the server; this keeps the screen honest about it:
 * unsaved edits are saved BEFORE the message goes (the server edits the saved draft), and when the form changed the
 * draft is read again into the editor, asking first if a newer local edit would be replaced.
 */
@Injectable()
export class ChatStore {
  private readonly api = inject(CaseSheetBuilderApi);
  private readonly session = inject(StudioSession);
  private readonly dialog = inject(DialogService);
  private readonly checks = inject(ChecksStore);

  readonly messages = signal<ChatMessage[]>([]);
  readonly working = signal(false);
  readonly canSend = computed(() => !this.working() && !this.session.readOnly() && !!this.session.formId());
  private conversationId: string | undefined;
  private n = 0;

  private push(m: Omit<ChatMessage, 'id'>): void {
    this.messages.update((l) => [...l, { ...m, id: ++this.n }]);
  }

  async send(text: string): Promise<boolean> {
    const message = text.trim();
    const formId = this.session.formId();
    if (!message || !formId || this.working()) return false;
    this.push({ from: 'user', text: message });
    this.working.set(true);
    try {
      // the server edits the SAVED draft: save what is on screen first, and stop if it cannot be saved
      await this.session.flush();
      const st = this.session.saveState();
      if (st !== 'saved') {
        this.push({ from: 'cortex', error: true, text: "Your latest changes aren't saved yet, so Cortex would work on an older copy. Fix the saving problem, then ask again." });
        return false;
      }
      const r = await this.api.cortex(formId, message, this.conversationId);
      this.conversationId = r.conversationId || this.conversationId;
      this.push({ from: 'cortex', text: r.reply, steps: r.steps });
      if (r.formChanged) await this.takeChanges();
      return true;
    } catch (e) {
      this.push({ from: 'cortex', error: true, text: builderWords(e, "Cortex couldn't answer just now. Please try again.") });
      return false;
    } finally {
      this.working.set(false);
    }
  }

  /** Read the changed draft into the editor; a local edit made while Cortex worked is never lost silently. */
  private async takeChanges(): Promise<void> {
    if (this.session.saveState() !== 'saved') {
      const keep = await this.dialog.confirm({
        title: 'Use what Cortex changed?',
        message: 'You changed the form while Cortex was working. Using Cortex’s version replaces those newer changes on this screen.',
        confirmLabel: 'Use Cortex’s version',
        cancelLabel: 'Keep my changes',
        tone: 'danger',
      });
      if (!keep) {
        this.push({ from: 'cortex', text: 'Kept your changes on screen. Saving them may ask you to choose between the two versions.' });
        return;
      }
    }
    const ok = await this.session.reloadDraft();
    if (!ok) {
      this.push({ from: 'cortex', error: true, text: "Cortex changed the draft, but it couldn't be loaded here. Reopen the form to see it." });
      return;
    }
    void this.checks.run();
  }
}
