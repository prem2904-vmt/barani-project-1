/**
 * Plain-language RBAC catalog (owner's 2026-09-20 redesign brief: "collect
 * sample means the user can collect the sample — with a clear definition of
 * what can be done… doctors must understand what a role is").
 *
 * Every permission code the mw seeds (PermissionSeeder.cs) gets:
 *   - a short human title (overrides the DB name where the DB name is vague),
 *   - one sentence describing WHAT THE USER CAN ACTUALLY DO,
 *   - a workflow group (the lab journey, not "module"),
 *   - an optional "high impact" flag for grants an admin should think twice
 *     about (RBAC best practice: surface sensitive permissions distinctly).
 *
 * Unknown codes (added later in mw) fall back to the DB name under "Other" —
 * the screen never hides a permission it doesn't recognise.
 */

export interface PermissionInfo {
  title: string;
  /** One sentence, plain words, present tense: what this lets the user do. */
  what: string;
  group: string;
  /** Grants that widen money/data/control reach — shown with a flag. */
  sensitive?: boolean;
}

export interface PermissionGroupInfo {
  key: string;
  label: string;
  /** One line under the group heading — where in the lab day this lives. */
  blurb: string;
}

/** Workflow order — mirrors a sample's journey through the lab. */
export const PERMISSION_GROUPS: PermissionGroupInfo[] = [
  { key: 'frontdesk',  label: 'Front desk & patients',
    blurb: 'Greeting, registering and looking up patients.' },
  { key: 'orders',     label: 'Orders & tests',
    blurb: 'Booking tests and following an order through the lab.' },
  { key: 'billing',    label: 'Billing & payments',
    blurb: 'Money — bills, payments, discounts and refunds.' },
  { key: 'collection', label: 'Sample collection & movement',
    blurb: 'Drawing samples, labelling tubes, moving them to the lab.' },
  { key: 'bench',      label: 'Lab bench — results',
    blurb: 'Entering and correcting results at the bench.' },
  { key: 'signout',    label: 'Doctor review & sign-out',
    blurb: 'The medical review that releases a report to the patient.' },
  { key: 'reports',    label: 'Patient reports',
    blurb: 'Opening finished reports and getting them to the patient.' },
  { key: 'inventory',  label: 'Inventory & stores',
    blurb: 'Reagents and consumables — stock in, stock out.' },
  { key: 'oversight',  label: 'Management & oversight',
    blurb: 'Dashboards, audit trail and branch administration.' },
  { key: 'setup',      label: 'Setup & configuration',
    blurb: 'Changing how the lab itself works — admin territory.' },
  { key: 'alerts',     label: 'Alerts this role receives',
    blurb: 'Not abilities — these decide who gets notified when something needs attention.' },
  { key: 'other',      label: 'Other',
    blurb: 'Permissions added after this screen was written.' },
];

export const PERMISSION_INFO: Record<string, PermissionInfo> = {
  // ── Front desk & patients ──────────────────────────────────
  register_patient: { group: 'frontdesk', title: 'Register a patient',
    what: 'Create a new patient at the front desk — name, age, contact.' },
  edit_patient: { group: 'frontdesk', title: 'Edit patient details',
    what: 'Correct or update a patient’s details after registration.' },
  view_patient: { group: 'frontdesk', title: 'Look up patients',
    what: 'Search for patients and open their details and history.' },

  // ── Orders & tests ─────────────────────────────────────────
  create_order: { group: 'orders', title: 'Book tests',
    what: 'Create a lab order — pick the tests the patient needs.' },
  view_order: { group: 'orders', title: 'Follow orders',
    what: 'Open orders and see where each one stands in the lab.' },
  cancel_order: { group: 'orders', title: 'Cancel an order',
    what: 'Cancel an order before the lab has processed it.' },
  modify_order: { group: 'orders', title: 'Change a billed order', sensitive: true,
    what: 'Supervisor override — add or remove tests after the bill is raised.' },
  view_test: { group: 'orders', title: 'See the test catalogue',
    what: 'Browse the tests the lab offers, with prices and details.' },

  // ── Billing & payments ─────────────────────────────────────
  create_bill: { group: 'billing', title: 'Raise a bill',
    what: 'Generate the bill for an order.' },
  collect_payment: { group: 'billing', title: 'Take payments',
    what: 'Collect cash / UPI / card and record it against the bill.' },
  view_bill: { group: 'billing', title: 'See bills',
    what: 'Open bills and their payment history.' },
  give_discount: { group: 'billing', title: 'Give a discount',
    what: 'Apply a discount within the lab’s normal limit.' },
  override_discount: { group: 'billing', title: 'Exceed the discount limit', sensitive: true,
    what: 'Go beyond the normal discount limit on a bill.' },
  approve_discount: { group: 'billing', title: 'Approve discounts', sensitive: true,
    what: 'Approve discount requests raised by other staff.' },
  process_refund: { group: 'billing', title: 'Refund a payment', sensitive: true,
    what: 'Record a refund against a bill that was already paid.' },

  // ── Sample collection & movement ───────────────────────────
  collect_sample: { group: 'collection', title: 'Collect samples',
    what: 'Draw the patient’s sample and mark the tubes as collected.' },
  reject_sample: { group: 'collection', title: 'Reject a sample',
    what: 'Mark an unusable sample (clotted, insufficient…) for recollection.' },
  print_barcode: { group: 'collection', title: 'Print tube labels',
    what: 'Print barcode labels for tubes and orders.' },
  dispatch_sample: { group: 'collection', title: 'Dispatch to the lab',
    what: 'Send collected samples off from the desk to the lab.' },
  receive_sample: { group: 'collection', title: 'Receive at the lab',
    what: 'Check samples in when they arrive at the lab bench.' },

  // ── Lab bench — results ────────────────────────────────────
  enter_result: { group: 'bench', title: 'Enter results',
    what: 'Type in results at the bench — including photos and videos where a test allows them.' },
  edit_result: { group: 'bench', title: 'Correct a result',
    what: 'Change a result that was already entered.' },
  culture_workbench: { group: 'bench', title: 'Culture bench (Microbiology)',
    what: 'Work culture cases — plates, organism identification, antibiotic sensitivity.' },

  // ── Doctor review & sign-out ───────────────────────────────
  validate_result: { group: 'signout', title: 'Sign results out',
    what: 'The doctor’s approval — review results and release them into the patient’s report.' },
  validate_own_result: { group: 'signout', title: 'Sign out own entries', sensitive: true,
    what: 'Let the SAME person enter a result and sign it out. Leave off to keep the two-person rule (NABL style).' },
  reject_result: { group: 'signout', title: 'Send a result back',
    what: 'Return a doubtful result to the bench for re-entry, with a note.' },
  reassign_result: { group: 'signout', title: 'Reassign a result',
    what: 'Hand a pending result to a different technician.' },

  // ── Patient reports ────────────────────────────────────────
  view_report: { group: 'reports', title: 'Open reports',
    what: 'View finished patient reports.' },
  deliver_report: { group: 'reports', title: 'Deliver reports',
    what: 'Get the report to the patient — WhatsApp, print or download.' },

  // ── Inventory & stores ─────────────────────────────────────
  inventory_receive: { group: 'inventory', title: 'Receive stock',
    what: 'Book incoming reagents and consumables into the store.' },
  inventory_issue: { group: 'inventory', title: 'Issue stock',
    what: 'Issue or consume items from the store.' },
  inventory_count: { group: 'inventory', title: 'Count & adjust stock',
    what: 'Run stock counts and adjust quantities.' },
  inventory_transfer: { group: 'inventory', title: 'Transfer between branches',
    what: 'Move stock from one branch to another.' },
  manage_inventory: { group: 'inventory', title: 'Set up inventory',
    what: 'Define items, suppliers and reorder rules.' },

  // ── Management & oversight ─────────────────────────────────
  view_dashboard: { group: 'oversight', title: 'Operations dashboard',
    what: 'See the day’s numbers — orders, collections, revenue.' },
  view_tat_dashboard: { group: 'oversight', title: 'Turnaround times',
    what: 'See how fast the lab is against its promised times.' },
  view_audit_log: { group: 'oversight', title: 'Audit trail', sensitive: true,
    what: 'Read the record of who did what, and when.' },
  manage_branch: { group: 'oversight', title: 'Edit this branch',
    what: 'Update this branch’s own details and settings.' },
  manage_branches: { group: 'oversight', title: 'See all branches',
    what: 'Browse and administer the organisation’s branch list.' },
  manage_home_collection: { group: 'oversight', title: 'Home-collection agents',
    what: 'Manage home-collection agents and their pickup runs.' },

  // ── Setup & configuration ──────────────────────────────────
  manage_tests: { group: 'setup', title: 'Test Master', sensitive: true,
    what: 'Edit tests, prices, reference ranges and report layouts.' },
  manage_departments: { group: 'setup', title: 'Departments',
    what: 'Manage lab departments and their option tables.' },
  manage_users: { group: 'setup', title: 'Users', sensitive: true,
    what: 'Create logins and decide who can access the system.' },
  manage_roles: { group: 'setup', title: 'Roles & permissions', sensitive: true,
    what: 'Edit what every role can do — this very screen.' },
  manage_billing_config: { group: 'setup', title: 'Billing setup', sensitive: true,
    what: 'Configure rate lists, taxes and payment modes.' },
  manage_report_template: { group: 'setup', title: 'Report design',
    what: 'Design the printed report — header, patient strip, signatures.' },
  manage_notifications: { group: 'setup', title: 'Notifications',
    what: 'Choose which alerts the lab raises, and their thresholds.' },
  manage_workflows: { group: 'setup', title: 'Workflow stages',
    what: 'Turn lab workflow stages on or off.' },
  manage_lab_settings: { group: 'setup', title: 'Lab settings',
    what: 'Lab-wide switches — scan mode, queue focus, spaces.' },
  manage_tenant: { group: 'setup', title: 'Organisation settings', sensitive: true,
    what: 'The organisation-level admin switch — top of the tree.' },

  // ── Alerts (subscriptions, not abilities) ──────────────────
  'lms.critical_value.notify': { group: 'alerts', title: 'Critical results',
    what: 'Gets alerted the moment a result crosses a critical limit.' },
  'lms.critical_value.escalate': { group: 'alerts', title: 'Critical escalation',
    what: 'Gets the escalation when a critical alert goes unacknowledged.' },
  'lms.tat_breach.notify': { group: 'alerts', title: 'TAT breaches',
    what: 'Gets alerted when an order breaches its promised turnaround time.' },
  'lms.sample_rejection.notify': { group: 'alerts', title: 'Sample rejections',
    what: 'Gets alerted when a sample is rejected.' },
  'lms.report_ready.notify': { group: 'alerts', title: 'Report ready',
    what: 'Gets alerted when a report is ready to hand over.' },
};

/** Who each pre-seeded role IS, in one breath — shown on the editor and the
 *  template picker so an admin never guesses from the name alone. */
export const ROLE_INFO: Record<string, string> = {
  'Receptionist':
    'The front desk. Registers patients, books tests, bills and takes payment, collects walk-in samples and hands reports over.',
  'Billing Counter':
    'A cash counter only — bills, payments and discounts. No registration, no lab work.',
  'Lab Technician':
    'Works the bench — receives samples, enters and corrects results. Cannot sign a report out.',
  'Microbiology Technician':
    'A bench technician for the culture workbench — plates, organisms, antibiotic sensitivity. Sign-out still needs a pathologist.',
  'Sample Collector':
    'The phlebotomist — collects samples and prints tube labels. Nothing else.',
  'Home Collection Agent':
    'Collects samples at the patient’s home — a sample collector on the road.',
  'Pathologist':
    'The signing doctor. Reviews every result, signs reports out, and sends anything doubtful back to the bench.',
  'Branch Manager':
    'Runs a branch — dashboards, turnaround times, audit trail and branch settings. Oversees the lab rather than operating it.',
  'Store Keeper':
    'Runs the store room — receives, issues and counts stock.',
  'Inventory Manager':
    'Owns inventory — everything a store keeper does, plus item setup and transfers between branches.',
  'Lab Admin':
    'The owner’s seat. Everything — front desk, bench, sign-out, billing, and all configuration.',
};
