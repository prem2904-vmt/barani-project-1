import { Injectable, signal } from '@angular/core';

/** What PF Listen reads: the section title, then its words. Empty sections are skipped. */
export function listenScript(sections: readonly { title: string; content: string }[]): string[] {
  return sections
    .filter((s) => s.content.trim())
    .map((s) => `${s.title.trim() ? s.title.trim() + '. ' : ''}${s.content.trim()}`);
}

/**
 * PF Listen (legacy "Edit Your Report" tab): the narrative read aloud by the device's own voice
 * (window.speechSynthesis). Nothing is sent anywhere — no server, no model. Where the browser has no voice,
 * `available` is false and the tab says so in plain words.
 */
@Injectable({ providedIn: 'root' })
export class ReadAloud {
  private readonly synth: SpeechSynthesis | null =
    typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;
  readonly available = signal(!!this.synth && typeof SpeechSynthesisUtterance !== 'undefined');
  /** The index of the part being read (null = silent). */
  readonly speaking = signal<number | null>(null);

  /** Read the parts in order, starting at `from`; reading again stops first. */
  read(parts: readonly string[], from = 0, lang = 'en-IN'): void {
    this.stop();
    const synth = this.synth;
    if (!synth || !this.available()) return;
    const next = (i: number) => {
      if (i >= parts.length) return this.speaking.set(null);
      const u = new SpeechSynthesisUtterance(parts[i]);
      u.lang = lang;
      u.rate = 1;
      u.onend = () => (this.speaking() === i ? next(i + 1) : undefined);
      u.onerror = () => this.speaking.set(null);
      this.speaking.set(i);
      synth.speak(u);
    };
    next(from);
  }

  stop(): void {
    this.speaking.set(null);
    this.synth?.cancel();
  }
}
