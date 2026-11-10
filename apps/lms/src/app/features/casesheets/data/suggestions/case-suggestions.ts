import { Injectable, inject } from '@angular/core';
import { FieldSuggestion, SuggestionSource } from '@prefrontal/forms-engine';
import { CasesApi } from '../cases/cases-api';
import { CaseSession } from '../cases/case-session';

/**
 * The suggestion chips of one open case sheet (FE_SUGGESTIONS): the doctor's own wording for each text field of
 * THIS form, learned by the API at Finish (legacy SuggestionsService). The top 5 per field are fetched once and
 * kept for the sheet; a search while typing always asks the API. Offline = no chips, never an error.
 */
@Injectable()
export class CaseSuggestions implements SuggestionSource {
  private readonly api = inject(CasesApi);
  private readonly session = inject(CaseSession);
  private readonly top = new Map<string, Promise<FieldSuggestion[]>>();

  private formId(): string | null {
    return this.session.sheet()?.formId ?? null;
  }

  list(fieldKey: string, q?: string): Promise<FieldSuggestion[]> {
    const formId = this.formId();
    if (!formId) return Promise.resolve([]);
    if (q?.trim()) return this.api.suggestions(formId, fieldKey, q.trim(), 5);
    const key = `${formId}::${fieldKey}`;
    let hit = this.top.get(key);
    if (!hit) {
      hit = this.api.suggestions(formId, fieldKey, undefined, 5).catch((e) => {
        this.top.delete(key); // try again next time
        throw e;
      });
      this.top.set(key, hit);
    }
    return hit;
  }

  async remove(fieldKey: string, id: string): Promise<void> {
    const formId = this.formId();
    if (formId) this.top.delete(`${formId}::${fieldKey}`);
    await this.api.deleteSuggestion(id);
  }
}
