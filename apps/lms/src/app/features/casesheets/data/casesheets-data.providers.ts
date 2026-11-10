import { Provider } from '@angular/core';
import { FE_ASSETS, FE_KINDS, FE_VOICE, KIND_SPECS } from '@prefrontal/forms-engine';
import { HttpAssetStore } from './assets/http-asset-store';
import { CasesApi } from './cases/cases-api';
import { HttpCasesApi } from './cases/http-cases-api';
import { VoiceService } from './voice/voice.service';

/**
 * What every case-sheet screen needs (Prepare's app.config providers, minus the app shell): the case-sheet API, the
 * forms engine's kinds (= provideFormsEngine()), dictation and pictures. Provided by each case-sheet PAGE component
 * (Departments, the filler, the sheet list), never in app.config or on the route table: casesheets.routes.ts is in the
 * lab's first download, these files are not — nothing here exists until a case-sheet screen opens.
 * VoiceService is `providedIn: 'root'` in Prepare (its spec relies on that); listing it here gives each page its own
 * instance that sees this CasesApi. Specs swap the API with `TestBed.overrideComponent(Page, { add: { providers } })`.
 */
export const CASESHEETS_DATA_PROVIDERS: Provider[] = [
  { provide: CasesApi, useClass: HttpCasesApi },
  { provide: FE_KINDS, useValue: KIND_SPECS },
  VoiceService,
  { provide: FE_VOICE, useExisting: VoiceService },
  HttpAssetStore,
  { provide: FE_ASSETS, useExisting: HttpAssetStore },
];
