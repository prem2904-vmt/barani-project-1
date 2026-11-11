import { Injectable, computed, inject, signal } from '@angular/core';
import { StudioSession } from '../data/studio-session';
import { CaseSheetBuilderApi } from './builder-api';
import { CortexProposalStatus, CortexStep, builderWords } from './builder-models';

export interface ChatMessage {
  id: number;
  from: 'user' | 'cortex';
  text: string;
  steps?: CortexStep[];
  /** A refusal or failure, shown as a quiet error line rather than a normal reply. */
  error?: boolean;
}

/** The ONE suggestion this chat is making: still `building` (Send for approval) or sent (`pending`, waiting in Pending changes). */
export interface ChatProposal { id: string; status: CortexProposalStatus }

/**
 * The Cortex chat. Cortex never changes a case sheet: every edit goes into ONE suggestion (`proposalId`) that waits for a person to
 * approve it in Pending changes. With a case sheet open (Studio editor) the chat suggests changes to it — a Prefrontal master too:
 * the approved result becomes the lab's own copy. With none open (Case sheets home) Cortex may suggest a NEW case sheet.
 * Unsaved edits are saved BEFORE a message goes, because a new suggestion starts from the case sheet's newest saved version.
 */
@Injectable()
export class ChatStore {
  private readonly api = inject(CaseSheetBuilderApi);
  private readonly session = inject(StudioSession, { optional: true });

  readonly messages = signal<ChatMessage[]>([]);
  readonly working = signal(false);
  readonly proposal = signal<ChatProposal | null>(null);
  readonly submitting = signal(false);
  /** No case sheet open: the chat may start a new case sheet. */
  readonly newSheet = computed(() => !this.session?.formId());
  readonly canSend = computed(() => !this.working() && (!this.session || !this.session.formId() || this.session.saveState() !== 'conflict'));
  /** "Send for approval" shows while the suggestion is still being made. */
  readonly canSubmit = computed(() => this.proposal()?.status === 'building' && !this.submitting() && !this.working());
  private conversationId: string | undefined;
  private n = 0;

  private push(m: Omit<ChatMessage, 'id'>): void {
    this.messages.update((l) => [...l, { ...m, id: ++this.n }]);
  }

  async send(text: string): Promise<boolean> {
    const message = text.trim();
    const formId = this.session?.formId() ?? null;
    if (!message || this.working()) return false;
    this.push({ from: 'user', text: message });
    this.working.set(true);
    try {
      if (formId && this.session) {
        // a new suggestion starts from the SAVED case sheet: save what is on screen first, and stop if it cannot be saved
        await this.session.flush();
        if (this.session.saveState() !== 'saved') {
          this.push({ from: 'cortex', error: true, text: "Your latest changes aren't saved yet, so Cortex would work on an older copy. Fix the saving problem, then ask again." });
          return false;
        }
      }
      const r = formId ? await this.api.cortex(formId, message, this.conversationId) : await this.api.cortexNew(message, this.conversationId);
      this.conversationId = r.conversationId || this.conversationId;
      this.push({ from: 'cortex', text: r.reply, steps: r.steps });
      if (r.proposalId) this.proposal.set({ id: r.proposalId, status: r.proposalStatus ?? 'building' });
      return true;
    } catch (e) {
      this.push({ from: 'cortex', error: true, text: builderWords(e, "Cortex couldn't answer just now. Please try again.") });
      return false;
    } finally {
      this.working.set(false);
    }
  }

  /** "Send for approval": the suggestion moves to Pending changes. */
  async submit(): Promise<boolean> {
    const p = this.proposal();
    if (!p || !this.canSubmit()) return false;
    this.submitting.set(true);
    try {
      const status = await this.api.submit(p.id);
      this.proposal.set({ id: p.id, status });
      return true;
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (code === 'already_sent') this.proposal.set({ id: p.id, status: 'pending' });
      this.push({ from: 'cortex', error: true, text: builderWords(e, "Couldn't send it for approval just now. Please try again.") });
      return false;
    } finally {
      this.submitting.set(false);
    }
  }
}
