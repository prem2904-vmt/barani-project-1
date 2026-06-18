import { Type } from '@angular/core';

/**
 * An action that can be rendered as a self-contained PANEL inside whatever
 * work-area it's dropped into (the "hybrid portable panels" model). Each
 * action keeps a `native` home screen (where it's hand-built into the bespoke
 * layout); when the admin drags it into a DIFFERENT work-area in /admin/process,
 * <pf-work-area-panels> renders the registered panel on that work-area's screen.
 *
 * To make another action portable, add one entry here + a small standalone
 * panel component — nothing else needs to change.
 */
export interface PortablePanel {
  /** Workflow action type (matches ProcessAction.type / ACTION_CATALOG). */
  type: string;
  /** Work-area id this action lives in by default (its bespoke home screen). */
  native: string;
  /** Section header shown when the panel appears in a foreign work-area. */
  label: string;
  /** Lazily-loaded standalone component to render. */
  load: () => Promise<Type<unknown>>;
}

export const PORTABLE_PANELS: PortablePanel[] = [
  {
    type: 'appointment',
    native: 'frontdesk',
    label: 'Appointments',
    load: () => import('./appointments-panel.component').then(m => m.AppointmentsPanelComponent),
  },
  // Register the rest here as their panels are built (billing, queue, sample
  // collection, validate, results, messages …). Locked actions (e.g. result
  // entry → Lab) stay on their own screen and aren't registered here.
];

export const portablePanel = (type: string): PortablePanel | undefined =>
  PORTABLE_PANELS.find(p => p.type === type);
