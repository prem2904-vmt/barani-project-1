/**
 * Settings — one search-first page (`/settings`) and a "Settings for this
 * screen" sheet, both built from ONE registry of rows (settings-registry.ts).
 *
 * A row never owns its data: it names an ADAPTER (the store it reads and
 * writes) and a KEY inside that store. The same store signal feeds the page,
 * the sheet and the old admin pages, so a change shows everywhere at once.
 */

/** Which store a row reads/writes. One adapter per backing endpoint. */
export type AdapterKey =
  | 'tenant'          // PATCH /api/tenants/current
  | 'blc'             // PATCH /api/tenants/branch-lab-config (per branch)
  | 'autoAssign'      // PUT /api/tenants/auto-assign-configs (per department)
  | 'labModes'        // read-only: billing / collection counters (Workflow)
  | 'billing'         // POST /api/config/billing (whole object)
  | 'invoice'         // POST /api/config/invoice-template (whole object)
  | 'gst'             // POST /api/config/gst (per branch, write-only)
  | 'idFormat'        // POST /api/config/{patient|sample|order}-id
  | 'appointments'    // PUT /api/appointments/config (per branch, whole object)
  | 'micro'           // PUT /api/microbiology/settings (whole object)
  | 'opd'             // PUT /api/opd/settings (whole object)
  | 'alerts'          // POST /api/config/notifications (per event)
  | 'print'           // localStorage, this device
  | 'me'              // the signed-in user (signature, registration number)
  | 'modules';        // PUT /api/tenants/modules (Add-ons)

export type GroupId =
  | 'frontdesk' | 'collection' | 'lab' | 'reports' | 'money' | 'alerts' | 'people' | 'setup';

/** Who a row's value applies to — drives the scope chip under the label. */
export type SettingScope = 'tenant' | 'branch' | 'dept' | 'device' | 'user' | 'none';

/** Screens that carry the ⚙ "Settings for this screen" sheet. */
export type ScreenKey =
  | 'frontdesk' | 'billing' | 'appointments' | 'collect' | 'receive'
  | 'mywork' | 'result' | 'pathologist' | 'culture' | 'home-collection';

export type ControlKind =
  | 'switch' | 'segmented' | 'select' | 'number' | 'text' | 'time'
  | 'readonly' | 'link' | 'composite'
  | 'logo' | 'dept-pool' | 'tiers';

export interface SettingOption<V = unknown> { value: V; label: string }

/** Reads another key of the SAME adapter (composite previews / fields). */
export type KeyReader = (key: string) => unknown;

export interface ControlDef {
  kind: ControlKind;
  options?: SettingOption[];
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  maxLength?: number;
  /** Numbers: an empty box is a real value (null = "use the default"). */
  allowEmpty?: boolean;
  /** Text: clean what is typed (e.g. the sign-in name). */
  sanitize?: (v: string) => string;
  /** A secondary action on the row ("Change in Workflow ›", "Draw ›"). */
  link?: { label: string; href: string; permission?: readonly string[] };
  /** composite: the fields "Change" reveals under the row. */
  fields?: FieldDef[];
  /** composite / readonly: the one-line value ("Looks like: …"). */
  preview?: (read: KeyReader) => string;
  /** dept-pool: which leg (technicians who enter / doctors who check). */
  leg?: 'tech' | 'validator';
  /** select: read the options from this adapter key (e.g. system printers). */
  optionsKey?: string;
  /** composite: the fields show at once (no "Change" step). A switch with
   *  `fields` shows them under the row while it is on. */
  inline?: boolean;
  /** composite: "Reset to default" writes these values. */
  reset?: Record<string, unknown>;
}

export interface FieldDef {
  key: string;
  label: string;
  control: ControlDef;
  /** Hide the field unless this holds (e.g. letter count only with letters). */
  visibleWhen?: (read: KeyReader) => boolean;
}

/** What a row may depend on when deciding if it shows at all. */
export interface RowContext {
  /** Current value of another row (by id). */
  value: (id: string) => unknown;
  isElectron: boolean;
}

export interface ConfirmDef {
  title: string;
  message?: string;
  confirmLabel?: string;
  tone?: 'primary' | 'danger';
}

export interface SettingDef {
  id: string;
  group: GroupId;
  /** Also listed in these groups (same row, same store). */
  alsoIn?: GroupId[];
  /** Small sub-heading inside the group (Alerts: where it happens). */
  subgroup?: string;
  /** A static chip beside the scope chip (Alerts: who gets it). */
  note?: string;
  /** 2–6 plain words. */
  label: string;
  /** Optional one-liner, 12 words or fewer. */
  help?: string;
  /** Words people type that aren't in the label ("barcode", "QR"). */
  synonyms?: string[];
  control: ControlDef;
  scope: SettingScope;
  /** Sits under the group's "More options (n)". */
  advanced?: boolean;
  /** Screens whose ⚙ sheet lists this row. */
  screens?: ScreenKey[];
  /** Any-of permission codes — the SAME codes that guard the old page.
   *  Empty = anyone who can open Settings / the screen (device, only me). */
  permission: readonly string[];
  /** Hidden when this tenant module / Lab feature is off. */
  module?: 'inventory' | 'homeCollection' | 'opd' | 'lab';
  adapter: AdapterKey;
  key: string;
  /** Ask first (sign-in name, lab structure, ID formats). For composite rows
   *  the ask happens once, when "Change" opens the editor. */
  confirm?: ConfirmDef;
  /** Show the row only when this holds (e.g. paper size for Cash bill). */
  visibleWhen?: (ctx: RowContext) => boolean;
}

export interface SettingsGroup {
  id: GroupId;
  label: string;
  /** SVG path data for the violet icon chip (stroked, 24×24). */
  icon: string;
}

/** Record editors that aren't simple settings: shown as "Tools" links. */
export interface SettingsTool {
  id: string;
  group: GroupId;
  label: string;
  help?: string;
  href: string;
  synonyms?: string[];
  permission: readonly string[];
  module?: 'inventory' | 'homeCollection' | 'opd' | 'lab';
  screens?: ScreenKey[];
}
