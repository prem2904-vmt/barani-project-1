import { ADMIN_PERMS } from './settings-access';
import { GroupId, SettingDef, SettingsGroup, SettingsTool } from './settings.model';

/**
 * THE list of settings. Every row names its store (adapter + key), who may
 * change it (the SAME permission that guards its old page in app.routes.ts),
 * its scope and the screens whose ⚙ sheet shows it.
 *
 * Copy rules (owner): labels 2–6 plain words; one-liners 12 words or fewer,
 * for a technician who didn't finish school. No paragraphs.
 */

const LAB_SETTINGS = ['manage_lab_settings'] as const;
const TENANT = ['manage_tenant'] as const;
const ADMIN = ADMIN_PERMS;

export const SETTINGS_GROUPS: readonly SettingsGroup[] = [
  { id: 'frontdesk', label: 'Front desk', icon: 'M3 21h18M5 21V8l7-5 7 5v13M9 21v-6h6v6' },
  { id: 'collection', label: 'Collection', icon: 'M9 3h6M10 3v12a2 2 0 0 0 4 0V3M10 9h4' },
  { id: 'lab', label: 'Lab work', icon: 'M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3' },
  { id: 'reports', label: 'Reports & printing', icon: 'M6 9V3h12v6M6 18H4a1 1 0 0 1-1-1v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a1 1 0 0 1-1 1h-2M8 14h8v6H8z' },
  { id: 'money', label: 'Billing & money', icon: 'M3 6h18v12H3zM3 10h18M7 15h3' },
  { id: 'alerts', label: 'Alerts', icon: 'M6 16V11a6 6 0 0 1 12 0v5l2 2H4l2-2ZM10 20a2 2 0 0 0 4 0' },
  { id: 'people', label: 'People & access', icon: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM2.5 21a6.5 6.5 0 0 1 13 0M17 11a3 3 0 1 0 0-6M21.5 20a5 5 0 0 0-4.5-4' },
  { id: 'setup', label: 'Lab setup', icon: 'M4 21V7l8-4 8 4v14M9 21v-5h6v5' },
];

export const SETTINGS: readonly SettingDef[] = [
  // ── Front desk ─────────────────────────────────────────────────────────
  {
    id: 'fd.paymentsDue', group: 'frontdesk', label: 'Show Payments due list',
    help: 'Orders where the patient still owes money.',
    synonyms: ['balance', 'unpaid', 'outstanding', 'tab', 'dues'],
    control: { kind: 'switch' }, scope: 'branch', screens: ['frontdesk'],
    permission: LAB_SETTINGS, adapter: 'blc', key: 'showPaymentsDueTab',
  },
  {
    id: 'fd.payGate', group: 'frontdesk', label: 'Stop work until bill is paid',
    help: 'Samples can always be collected.',
    synonyms: ['payment', 'gate', 'full payment', 'dispatch', 'block', 'unpaid'],
    control: { kind: 'segmented', options: [
      { value: 'none', label: 'No' },
      { value: 'dispatch', label: 'Before sending' },
      { value: 'report', label: 'Before report' },
    ] },
    scope: 'branch', screens: ['frontdesk'],
    permission: LAB_SETTINGS, adapter: 'blc', key: 'paymentGateStage',
  },
  {
    id: 'fd.counters', group: 'frontdesk', label: 'Billing and collection counters',
    help: 'Set in Workflow.',
    synonyms: ['counter', 'billing mode', 'collection mode', 'separate counter', 'dedicated'],
    control: { kind: 'readonly', link: { label: 'Change in Workflow', href: '/admin/process', permission: ['manage_workflows'] } },
    scope: 'branch', screens: ['frontdesk'],
    permission: LAB_SETTINGS, adapter: 'labModes', key: 'counters',
  },

  // ── Collection ─────────────────────────────────────────────────────────
  {
    id: 'col.scanMode', group: 'collection', label: 'How staff find a sample',
    help: 'Scan the code, or type the number from the tube.',
    synonyms: ['barcode', 'qr', 'scan', 'scanner', 'camera', 'manual', 'type', 'sample number', 'identify', 'sample id'],
    control: { kind: 'segmented', options: [
      { value: 'scan', label: 'Scan code' },
      { value: 'manual', label: 'Type number' },
    ] },
    scope: 'tenant', screens: ['collect', 'receive', 'mywork'],
    permission: LAB_SETTINGS, adapter: 'tenant', key: 'scanMode',
  },
  {
    id: 'col.labelCode', group: 'collection', label: 'Code printed on tube sticker',
    help: 'Every sticker printed in this branch uses it.',
    synonyms: ['barcode', 'qr', 'data matrix', 'datamatrix', 'label', 'sticker', 'print code'],
    control: { kind: 'segmented', options: [
      { value: 'barcode', label: 'Barcode' },
      { value: 'qr', label: 'QR' },
      { value: 'datamatrix', label: 'Small square' },
    ] },
    scope: 'branch', screens: ['collect'],
    permission: LAB_SETTINGS, adapter: 'blc', key: 'labelCodeMode',
  },
  {
    id: 'col.trackStock', group: 'collection', label: 'Track stock (tubes, kits)',
    help: "Stock goes down at collection. Out-of-stock tests can't be ordered.",
    synonyms: ['inventory', 'stock', 'kit', 'consumable', 'reagent'],
    control: { kind: 'switch' }, scope: 'branch', screens: ['collect'], module: 'inventory',
    permission: LAB_SETTINGS, adapter: 'blc', key: 'inventoryEnabled',
  },
  {
    id: 'col.noScan', group: 'collection', label: 'Let a supervisor skip scanning',
    help: 'For torn or smudged stickers. Every skip is recorded.',
    synonyms: ['no-scan', 'no scan', 'override', 'claim', 'damaged label', 'barcode'],
    control: { kind: 'switch' }, scope: 'tenant', screens: ['receive', 'mywork'],
    permission: LAB_SETTINGS, adapter: 'tenant', key: 'allowNoScanClaim',
  },

  // ── Lab work ───────────────────────────────────────────────────────────
  {
    id: 'lab.queueFocus', group: 'lab', label: 'Lab list shows',
    help: 'Auto picks based on your lab setup.',
    synonyms: ['queue focus', 'worklist', 'patient', 'sample', 'tube', 'group'],
    control: { kind: 'segmented', options: [
      { value: 'auto', label: 'Auto' },
      { value: 'patient', label: 'By patient' },
      { value: 'sample', label: 'By tube' },
    ] },
    scope: 'branch', screens: ['receive', 'mywork'],
    permission: LAB_SETTINGS, adapter: 'blc', key: 'queueFocusMode',
  },
  {
    id: 'lab.autoAssign', group: 'lab', label: 'Give new tests to staff automatically',
    help: 'Off: everyone picks from one shared list.',
    synonyms: ['auto-assign', 'auto assign', 'technician', 'assign', 'route', 'queue'],
    control: { kind: 'switch' }, scope: 'branch', screens: ['receive', 'mywork'],
    permission: LAB_SETTINGS, adapter: 'blc', key: 'autoAssignEnabled',
  },
  {
    id: 'lab.techPool', group: 'lab', label: "Who gets each department's tests",
    help: 'Pick people, or a role for any free person.',
    synonyms: ['auto-assign', 'technician', 'department', 'people', 'roles'],
    control: { kind: 'dept-pool', leg: 'tech' }, scope: 'dept', screens: ['receive', 'mywork'],
    permission: LAB_SETTINGS, adapter: 'autoAssign', key: 'tech',
    visibleWhen: (c) => c.value('lab.autoAssign') === true,
  },
  {
    id: 'lab.autoValidate', group: 'lab', label: 'Send results to a doctor automatically',
    help: 'Off: any doctor can pick them.',
    synonyms: ['auto-assign', 'validator', 'pathologist', 'validation', 'route'],
    control: { kind: 'switch' }, scope: 'branch', screens: ['pathologist'],
    permission: LAB_SETTINGS, adapter: 'blc', key: 'autoAssignValidatorsEnabled',
  },
  {
    id: 'lab.validatorPool', group: 'lab', label: "Who checks each department's results",
    help: 'Pick doctors, or a role for any free doctor.',
    synonyms: ['validator', 'pathologist', 'department', 'people', 'roles'],
    control: { kind: 'dept-pool', leg: 'validator' }, scope: 'dept', screens: ['pathologist'],
    permission: LAB_SETTINGS, adapter: 'autoAssign', key: 'validator',
    visibleWhen: (c) => c.value('lab.autoValidate') === true,
  },
  {
    id: 'lab.requireValidation', group: 'lab', label: 'Doctor must check every result',
    help: "Even quick tests wait for a doctor's OK.",
    synonyms: ['validation', 'validate', 'pathologist', 'sign-off', 'approve', 'direct flow'],
    control: { kind: 'switch' }, scope: 'branch', screens: ['result', 'pathologist'],
    permission: LAB_SETTINGS, adapter: 'blc', key: 'requireValidationForAllResults',
  },
  {
    id: 'lab.isi', group: 'lab', label: 'INR: ISI value', advanced: true,
    help: 'From the reagent box insert. Blank = 1.0',
    synonyms: ['inr', 'isi', 'pt', 'calculation', 'constant', 'coagulation'],
    control: { kind: 'number', min: 0, max: 5, step: 0.01, allowEmpty: true, placeholder: '1.0' },
    scope: 'tenant', screens: ['result'],
    permission: LAB_SETTINGS, adapter: 'tenant', key: 'calc.ISI',
  },
  {
    id: 'lab.mnpt', group: 'lab', label: 'INR: normal PT (seconds)', advanced: true,
    help: 'Blank = 12.0',
    synonyms: ['inr', 'mnpt', 'pt', 'prothrombin', 'calculation', 'constant'],
    control: { kind: 'number', min: 0, max: 60, step: 0.1, allowEmpty: true, placeholder: '12.0', unit: 's' },
    scope: 'tenant', screens: ['result'],
    permission: LAB_SETTINGS, adapter: 'tenant', key: 'calc.MNPT',
  },
  {
    id: 'lab.hct', group: 'lab', label: 'Normal HCT % (retic count)', advanced: true,
    help: 'Blank = 45',
    synonyms: ['hct', 'haematocrit', 'hematocrit', 'retic', 'rpi', 'calculation', 'constant'],
    control: { kind: 'number', min: 1, max: 99, step: 1, allowEmpty: true, placeholder: '45', unit: '%' },
    scope: 'tenant', screens: ['result'],
    permission: LAB_SETTINGS, adapter: 'tenant', key: 'calc.NORMAL_HCT',
  },
  {
    id: 'lab.labStructure', group: 'lab', label: 'How tubes are shared', advanced: true,
    help: 'One lab: same colour tests share a tube.',
    synonyms: ['lab structure', 'integrated', 'standalone', 'space', 'vial', 'prefix'],
    control: { kind: 'segmented', options: [
      { value: 'auto', label: 'Auto' },
      { value: 'integrated', label: 'One lab' },
      { value: 'standalone', label: 'Each department' },
    ] },
    scope: 'branch',
    permission: LAB_SETTINGS, adapter: 'blc', key: 'labStructure',
    confirm: { title: 'Change how tubes are shared?', message: 'New orders use this. Old tubes stay as they are.', confirmLabel: 'Change', tone: 'danger' },
  },

  // ── Lab setup ──────────────────────────────────────────────────────────
  {
    id: 'setup.labName', group: 'setup', label: 'Lab name',
    help: "Your lab's full name on screens.",
    synonyms: ['organisation', 'organization', 'name', 'company', 'tenant'],
    control: { kind: 'text', maxLength: 120 }, scope: 'tenant',
    permission: TENANT, adapter: 'tenant', key: 'name',
  },
  {
    id: 'setup.logo', group: 'setup', label: 'Lab logo',
    help: 'Shown in the top bar. Up to 100 KB.',
    synonyms: ['logo', 'branding', 'brand', 'image', 'picture'],
    control: { kind: 'logo' }, scope: 'tenant',
    permission: ADMIN, adapter: 'tenant', key: 'logoUrl',
  },
  {
    id: 'setup.brandingMode', group: 'setup', label: 'Top bar shows',
    synonyms: ['branding', 'logo', 'name', 'header', 'brand'],
    control: { kind: 'segmented', options: [
      { value: 'both', label: 'Logo and name' },
      { value: 'logo', label: 'Logo' },
      { value: 'name', label: 'Name' },
    ] },
    scope: 'tenant',
    permission: ADMIN, adapter: 'tenant', key: 'brandingMode',
  },
  {
    id: 'setup.brandingName', group: 'setup', label: 'Short name for top bar',
    help: 'Up to 30 letters.',
    synonyms: ['branding', 'short name', 'brand', 'header'],
    control: { kind: 'text', maxLength: 30, sanitize: (v) => v.replace(/[^\p{L}\p{N} &._'-]/gu, '').slice(0, 30) },
    scope: 'tenant',
    permission: ADMIN, adapter: 'tenant', key: 'brandingName',
  },
  {
    id: 'setup.slug', group: 'setup', label: 'Staff sign-in name', advanced: true,
    help: "Changing this changes everyone's login.",
    synonyms: ['login', 'handle', 'slug', 'organisation code', 'sign in'],
    control: { kind: 'text', maxLength: 40, sanitize: (v) => v.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40) },
    scope: 'tenant',
    permission: TENANT, adapter: 'tenant', key: 'slug',
    confirm: { title: 'Change the sign-in name?', message: 'Everyone signs in with the new name.', confirmLabel: 'Change', tone: 'danger' },
  },
  {
    id: 'setup.isolation', group: 'setup', label: 'Branches share prices and data', advanced: true,
    help: 'Set by Prefrontal.',
    synonyms: ['isolation', 'branch', 'strict', 'separate', 'shared'],
    control: { kind: 'readonly', preview: (r) => (r('branchIsolationEnabled') === true ? 'No, each branch is separate' : 'Yes, shared') },
    scope: 'none',
    permission: TENANT, adapter: 'tenant', key: 'branchIsolationEnabled',
  },
];

export const SETTINGS_BY_ID: ReadonlyMap<string, SettingDef> = new Map(SETTINGS.map((d) => [d.id, d]));

export const SETTINGS_TOOLS: readonly SettingsTool[] = [
  { id: 'tool.homeAgents', group: 'collection', label: 'Home-collection agents', help: 'Who visits which area.',
    href: '/admin/home-collection', synonyms: ['home visit', 'agent', 'pincode', 'field'],
    permission: ['manage_home_collection'], module: 'homeCollection', screens: ['home-collection'] },
  { id: 'tool.reportDesigner', group: 'reports', label: 'Report designer', help: 'Header, table, footer, watermark.',
    href: '/admin/reports', synonyms: ['report template', 'letterhead', 'header', 'footer', 'pdf', 'layout'],
    permission: ['manage_tenant', 'manage_tests'] },
  { id: 'tool.billDesigner', group: 'reports', label: 'Bill designer', help: 'Letterhead and bill preview.',
    href: '/admin/billing', synonyms: ['invoice', 'letterhead', 'bill template', 'receipt'],
    permission: ['manage_tenant'] },
  { id: 'tool.printer', group: 'reports', label: 'Printer setup', help: 'Pair the sticker printer on this device.',
    href: '/printing', synonyms: ['printer', 'bluetooth', 'usb', 'label printer', 'pair'],
    permission: [] },
  { id: 'tool.prices', group: 'money', label: 'Test prices', help: 'In Test Master.',
    href: '/admin/tests', synonyms: ['price', 'rate', 'mrp', 'cost', 'tariff'], permission: ['manage_tests'] },
  { id: 'tool.wallets', group: 'money', label: 'B2B partner wallets', help: 'Credit and top-ups.',
    href: '/admin/vendors', synonyms: ['vendor', 'credit', 'wallet', 'b2b', 'partner'], permission: ['manage_tenant'] },
  { id: 'tool.referralLabs', group: 'money', label: 'Referral labs', help: 'Labs you send tests to.',
    href: '/admin/referral-labs', synonyms: ['outsource', 'external lab', 'send out'], permission: ['manage_tests'] },
  { id: 'tool.referring', group: 'money', label: 'Referring doctors and hospitals',
    href: '/admin/referring-network', synonyms: ['doctor', 'hospital', 'referral', 'network', 'commission'],
    permission: ['manage_tenant', 'manage_admin'] },
  { id: 'tool.opdDoctors', group: 'money', label: 'OPD doctors and fees',
    href: '/admin/opd/doctors', synonyms: ['consultation', 'fee', 'doctor', 'opd'], permission: ADMIN, module: 'opd' },
  { id: 'tool.users', group: 'people', label: 'Staff and roles', help: 'Invite staff and set what they can do.',
    href: '/admin/users', synonyms: ['user', 'invite', 'permission', 'role', 'password'], permission: ['manage_users'] },
  { id: 'tool.audit', group: 'people', label: 'Who changed what', help: 'Every change, with who and when.',
    href: '/admin/audit', synonyms: ['audit', 'log', 'history', 'trail'], permission: ['view_audit_log'] },
  { id: 'tool.branches', group: 'setup', label: 'Branches, departments and lab rooms',
    href: '/admin/branches', synonyms: ['branch', 'department', 'space', 'lab room', 'sample code', 'tube colour'],
    permission: ['manage_branches'] },
  { id: 'tool.tests', group: 'setup', label: 'Tests, packages and prices',
    href: '/admin/tests', synonyms: ['test master', 'catalogue', 'catalog', 'profile', 'package', 'reference range'],
    permission: ['manage_tests'] },
  { id: 'tool.process', group: 'setup', label: 'Screens and menus', help: 'Workflow: which screen does what.',
    href: '/admin/process', synonyms: ['workflow', 'process builder', 'menu', 'counter'], permission: ['manage_workflows'] },
  { id: 'tool.forms', group: 'setup', label: 'Form fields', help: 'Register, order and booking fields.',
    href: '/admin/workflows', synonyms: ['form flow', 'field', 'registration form'], permission: ['manage_workflows'] },
  { id: 'tool.kpis', group: 'setup', label: 'Dashboard numbers', help: 'Which counts show on each screen.',
    href: '/admin/kpis', synonyms: ['kpi', 'metric', 'card', 'dashboard'], permission: ADMIN },
  { id: 'tool.stock', group: 'setup', label: 'Stock items and kits',
    href: '/admin/inventory', synonyms: ['inventory', 'stock', 'kit', 'consumable'],
    permission: ['manage_inventory'], module: 'inventory' },
];

/** Rows of one group, in registry order (own group first, then `alsoIn`). */
export function rowsOfGroup(group: GroupId, rows: readonly SettingDef[] = SETTINGS): SettingDef[] {
  return rows.filter((d) => d.group === group || d.alsoIn?.includes(group));
}
