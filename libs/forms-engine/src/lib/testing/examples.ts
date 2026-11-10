import manifest from './components.manifest.json';
import { Answers, FieldDef } from '../core/types';

export interface CatalogueExample {
  name: string;
  field: FieldDef;
  answers: Answers;
}

/** The API catalogue's own examples for a kind (`GET /api/components`), so every control is tested with what the API documents. */
export function examplesOf(kind: string): CatalogueExample[] {
  const k = (manifest as unknown as { kinds: { name: string; examples: CatalogueExample[] }[] }).kinds.find(
    (x) => x.name === kind,
  );
  if (!k) throw new Error(`kind ${kind} is not in the catalogue`);
  return k.examples;
}

export function defaultsOf(kind: string): Record<string, unknown> {
  const k = (manifest as unknown as { kinds: { name: string; defaults: Record<string, unknown> }[] }).kinds.find(
    (x) => x.name === kind,
  );
  return k?.defaults ?? {};
}
