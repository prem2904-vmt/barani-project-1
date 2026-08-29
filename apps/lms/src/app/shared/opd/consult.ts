/**
 * OPD consult types (slice 1 — shell). Kept separate from the component so
 * later slices (backend persistence as an Order(Module=opd), procedures
 * catalog) can import them without pulling in the UI.
 */

/** A consulting doctor pickable at the current branch. */
export interface ConsultDoctor {
  id: string;
  name: string;
  /** Optional department/speciality label shown beside the name. */
  department?: string | null;
  /** The doctor's default consultation fee — auto-fills the consult (overridable). */
  fee?: number;
}

/** A procedure line — placeholder shape; the real catalog arrives later. */
export interface ConsultProcedure {
  id: string;
  name: string;
  fee: number;
}

/** What the consult builder emits on submit. Not yet persisted (later slice
 *  turns this into an Order with Module = 'opd'). */
export interface ConsultDraft {
  doctorId: string | null;
  doctorName: string | null;
  fee: number;
  procedures: ConsultProcedure[];
}
