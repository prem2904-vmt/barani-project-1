import { QUEUE_DEFAULTS } from './adapters/appointments.adapter';
import { DATE_OPTIONS } from './id-format';
import { ADMIN_PERMS } from './settings-access';
import { ControlDef, FieldDef, GroupId, KeyReader, SettingDef, SettingsGroup, SettingsTool } from './settings.model';

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
const ME: readonly string[] = [];

const SEPARATORS = [{ value: '-', label: '-' }, { value: '/', label: '/' }, { value: '', label: 'None' }];

/** Fields of an ID-number editor ("Change" under "… looks like"). */
function idFields(scope: 'patient' | 'sample' | 'order'): FieldDef[] {
  const own = (r: KeyReader) => scope !== 'patient' || r('patient.enabled') === true;
  return [
    ...(scope === 'patient' ? [
      { key: 'patient.enabled', label: 'Use my own format', control: { kind: 'switch' } as ControlDef },
      { key: 'patient.prefix', label: 'Starts with', visibleWhen: own,
        control: { kind: 'text', maxLength: 6, placeholder: 'e.g. DEL', sanitize: (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) } as ControlDef },
    ] : []),
    { key: `${scope}.datePrefix`, label: 'Date part', visibleWhen: own, control: { kind: 'select', options: DATE_OPTIONS } },
    { key: `${scope}.separator`, label: 'Between parts', visibleWhen: own, control: { kind: 'segmented', options: SEPARATORS } },
    { key: `${scope}.padding`, label: 'Digits', visibleWhen: own, control: { kind: 'number', min: 1, max: 10 } },
    { key: `${scope}.letters`, label: 'Add letters (AA001)', visibleWhen: own, control: { kind: 'switch' } },
    { key: `${scope}.letterCount`, label: 'How many letters', visibleWhen: (r) => own(r) && r(`${scope}.letters`) === true,
      control: { kind: 'segmented', options: [1, 2, 3, 4].map((n) => ({ value: n, label: 'A'.repeat(n) })) } },
  ];
}

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
  {
    id: 'fd.queueMode', group: 'frontdesk', label: 'How patients wait',
    synonyms: ['queue', 'token', 'walk-in', 'walk in', 'home visit', 'appointment'],
    control: { kind: 'segmented', options: [
      { value: 'token_queue', label: 'Token number' },
      { value: 'walk_up', label: 'Walk-in' },
      { value: 'home_collection', label: 'Home visits' },
    ] },
    scope: 'branch', screens: ['appointments'],
    permission: TENANT, adapter: 'appointments', key: 'queueMode',
  },
  {
    id: 'fd.openHours', group: 'frontdesk', label: 'Open hours',
    synonyms: ['timing', 'hours', 'opening', 'closing', '24x7', 'booking', 'appointment', 'slot'],
    control: {
      kind: 'composite',
      preview: (r) => (r('open24h') === true ? 'Open all day and night' : `Open ${r('hours.from')} to ${r('hours.to')}`),
      fields: [
        { key: 'open24h', label: 'Open all day and night', control: { kind: 'switch' } },
        { key: 'hours.from', label: 'Opens at', control: { kind: 'time' }, visibleWhen: (r) => r('open24h') !== true },
        { key: 'hours.to', label: 'Closes at', control: { kind: 'time' }, visibleWhen: (r) => r('open24h') !== true },
      ],
    },
    scope: 'branch', screens: ['frontdesk', 'appointments'],
    permission: TENANT, adapter: 'appointments', key: 'open24h',
  },
  {
    id: 'fd.slot', group: 'frontdesk', label: 'Time per appointment',
    synonyms: ['slot', 'duration', 'appointment', 'booking', 'minutes'],
    control: { kind: 'number', min: 5, max: 240, step: 5, unit: 'min' },
    scope: 'branch', screens: ['appointments'],
    permission: TENANT, adapter: 'appointments', key: 'slotMinutes',
  },
  {
    id: 'fd.perSlot', group: 'frontdesk', label: 'Patients per time slot',
    synonyms: ['concurrent', 'slot', 'capacity', 'appointment', 'booking'],
    control: { kind: 'number', min: 1, max: 50, step: 1 },
    scope: 'branch', screens: ['appointments'],
    permission: TENANT, adapter: 'appointments', key: 'maxConcurrentSlots',
  },
  {
    id: 'fd.opdMode', group: 'frontdesk', label: 'Repeat-visit discount (OPD)',
    synonyms: ['follow-up', 'follow up', 'opd', 'consultation', 'discount', 'repeat'],
    control: { kind: 'segmented', options: [
      { value: 'off', label: 'Off' },
      { value: 'auto', label: 'Automatic' },
      { value: 'assisted', label: 'Front desk decides' },
    ] },
    scope: 'tenant', module: 'opd',
    permission: ADMIN, adapter: 'opd', key: 'followUpMode',
  },
  {
    id: 'fd.opdTiers', group: 'frontdesk', label: 'Repeat-visit discount rules (OPD)',
    help: 'e.g. within 7 days, 100% off.',
    synonyms: ['follow-up', 'tier', 'opd', 'discount', 'repeat'],
    control: { kind: 'tiers' }, scope: 'tenant', module: 'opd',
    permission: ADMIN, adapter: 'opd', key: 'tiers',
    visibleWhen: (c) => c.value('fd.opdMode') !== 'off',
  },
  {
    id: 'fd.priority', group: 'frontdesk', label: 'Who gets called first', advanced: true,
    help: 'Expert scoring. Leave as is unless told.',
    synonyms: ['priority', 'score', 'queue', 'no-show', 'late', 'grace', 'urgent'],
    control: {
      kind: 'composite',
      preview: (r) => `Booked ${r('opt.baseAppointment')} · Walk-in ${r('opt.baseWalkin')} · Urgent ${r('opt.urgentOverrideScore')}`,
      fields: [
        { key: 'opt.baseAppointment', label: 'Points for booked patient', control: { kind: 'number', min: 0, max: 99999, step: 50 } },
        { key: 'opt.baseWalkin', label: 'Points for walk-in', control: { kind: 'number', min: 0, max: 99999, step: 50 } },
        { key: 'opt.baseFollowup', label: 'Points for follow-up', control: { kind: 'number', min: 0, max: 99999, step: 50 } },
        { key: 'opt.waitWeight', label: 'Extra points per minute waiting', control: { kind: 'number', min: 0, max: 1000, step: 1 } },
        { key: 'opt.appointmentGraceMinutes', label: 'Late allowance', control: { kind: 'number', min: 0, max: 240, step: 5, unit: 'min' } },
        { key: 'opt.latePenalty', label: 'Points lost if late', control: { kind: 'number', min: 0, max: 99999, step: 50 } },
        { key: 'opt.noShowThresholdMinutes', label: 'Mark no-show after', control: { kind: 'number', min: 1, max: 1440, step: 5, unit: 'min' } },
        { key: 'opt.avgCollectionMinutes', label: 'Minutes per collection', control: { kind: 'number', min: 1, max: 120, step: 1, unit: 'min' } },
        { key: 'opt.urgentOverrideScore', label: 'Points for urgent', control: { kind: 'number', min: 0, max: 99999, step: 100 } },
      ],
      reset: Object.fromEntries(Object.entries(QUEUE_DEFAULTS).map(([k, v]) => ['opt.' + k, v])),
    },
    scope: 'branch', screens: ['appointments'],
    permission: TENANT, adapter: 'appointments', key: 'opt.baseAppointment',
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
    id: 'col.sampleId', group: 'collection', label: 'Tube number looks like',
    help: 'The number on each tube. Restarts each month.',
    synonyms: ['sample id', 'sample number', 'tube id', 'barcode', 'format', 'prefix', 'numbering'],
    control: { kind: 'composite', preview: (r) => String(r('sample.preview')), fields: idFields('sample') },
    scope: 'tenant', screens: ['collect'],
    permission: TENANT, adapter: 'idFormat', key: 'sample.datePrefix',
    confirm: { title: 'Change how tube numbers look?', message: 'Only new tubes change. Old numbers stay.', confirmLabel: 'Change', tone: 'primary' },
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
  {
    id: 'col.printer', group: 'collection', label: 'Sticker printer',
    synonyms: ['printer', 'label printer', 'bluetooth', 'usb', 'pair', 'connect'],
    control: { kind: 'link', preview: (r) => String(r('printer')), link: { label: 'Connect', href: '/printing' } },
    scope: 'device', screens: ['collect'],
    permission: ME, adapter: 'print', key: 'printer',
  },
  {
    id: 'col.stickerSize', group: 'collection', label: 'Sticker size',
    synonyms: ['label size', 'width', 'height', 'mm', 'sticker', 'label'],
    control: {
      kind: 'composite', preview: (r) => `${r('labelWidthMm')} × ${r('labelHeightMm')} mm`,
      fields: [
        { key: 'labelWidthMm', label: 'Width', control: { kind: 'number', min: 10, max: 120, unit: 'mm' } },
        { key: 'labelHeightMm', label: 'Height', control: { kind: 'number', min: 10, max: 120, unit: 'mm' } },
      ],
    },
    scope: 'device', screens: ['collect'],
    permission: ME, adapter: 'print', key: 'labelWidthMm',
  },
  {
    id: 'col.darkness', group: 'collection', label: 'Print darkness',
    help: '1 is light, 15 is dark.',
    synonyms: ['density', 'dark', 'light', 'faint', 'print quality', 'sticker'],
    control: { kind: 'number', min: 1, max: 15, step: 1 },
    scope: 'device', screens: ['collect'],
    permission: ME, adapter: 'print', key: 'density',
  },
  {
    id: 'col.nudge', group: 'collection', label: 'Move print on sticker', advanced: true,
    help: 'Use the arrows in Printer setup.',
    synonyms: ['align', 'alignment', 'offset', 'nudge', 'shift', 'rotate'],
    control: { kind: 'link', link: { label: 'Adjust', href: '/printing' } },
    scope: 'device', screens: ['collect'],
    permission: ME, adapter: 'print', key: 'offsetXmm',
  },
  {
    id: 'col.speed', group: 'collection', label: 'Print speed', advanced: true,
    help: 'Slower prints sharper.',
    synonyms: ['speed', 'slow', 'fast', 'sticker', 'print quality'],
    control: { kind: 'number', min: 1, max: 5, step: 1 },
    scope: 'device', screens: ['collect'],
    permission: ME, adapter: 'print', key: 'speed',
  },
  {
    id: 'col.codeSize', group: 'collection', label: 'Code size on sticker', advanced: true,
    help: 'Too small and scanners miss it.',
    synonyms: ['barcode size', 'qr size', 'scale', 'sticker'],
    control: { kind: 'number', min: 50, max: 130, step: 5, unit: '%' },
    scope: 'device', screens: ['collect'],
    permission: ME, adapter: 'print', key: 'codeScalePct',
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
    id: 'lab.cultureRelease', group: 'lab', label: 'Culture: free a step after',
    help: 'If nobody works on it. 0 = never.',
    synonyms: ['culture', 'microbiology', 'lock', 'timeout', 'release', 'idle'],
    control: { kind: 'number', min: 0, max: 1440, step: 5, unit: 'min' },
    scope: 'tenant', screens: ['culture'],
    permission: LAB_SETTINGS, adapter: 'micro', key: 'lockTimeoutMinutes',
  },
  {
    id: 'lab.cultureTakeover', group: 'lab', label: 'Culture: supervisor can take over',
    synonyms: ['culture', 'microbiology', 'takeover', 'force release', 'supervisor'],
    control: { kind: 'switch' }, scope: 'tenant', screens: ['culture'],
    permission: LAB_SETTINGS, adapter: 'micro', key: 'allowSupervisorTakeover',
  },
  {
    id: 'lab.cultureTat', group: 'lab', label: 'Culture: time allowed per step',
    help: 'Alert when a step runs late.',
    synonyms: ['culture', 'microbiology', 'tat', 'turnaround', 'overdue', 'gram', 'growth', 'ast', 'sensitivity'],
    control: {
      kind: 'composite',
      preview: (r) => ['tat.gram', 'tat.growth', 'tat.identification', 'tat.ast']
        .map((k) => (r(k) == null ? '–' : `${r(k)} h`)).join(' · '),
      fields: [
        { key: 'tat.gram', label: 'Smear', control: { kind: 'number', min: 1, max: 720, unit: 'h' } },
        { key: 'tat.growth', label: 'Growth check', control: { kind: 'number', min: 1, max: 720, unit: 'h' } },
        { key: 'tat.identification', label: 'Identify organism', control: { kind: 'number', min: 1, max: 720, unit: 'h' } },
        { key: 'tat.ast', label: 'Antibiotic test', control: { kind: 'number', min: 1, max: 720, unit: 'h' } },
      ],
    },
    scope: 'tenant', screens: ['culture'],
    permission: LAB_SETTINGS, adapter: 'micro', key: 'tat.gram',
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

  // ── Reports & printing ─────────────────────────────────────────────────
  {
    id: 'rep.billDesign', group: 'reports', label: 'Bill design',
    synonyms: ['invoice template', 'bill template', 'letterhead', 'cash bill', 'receipt', 'style'],
    control: { kind: 'select', options: [
      { value: 'classic', label: 'Classic' },
      { value: 'modern', label: 'Modern' },
      { value: 'letterhead', label: 'Letterhead' },
      { value: 'cashbill', label: 'Cash bill' },
    ], link: { label: 'Preview and edit', href: '/admin/billing', permission: ['manage_tenant'] } },
    scope: 'tenant',
    permission: TENANT, adapter: 'invoice', key: 'template',
  },
  {
    id: 'rep.billPaper', group: 'reports', label: 'Bill paper size',
    help: 'Only for Cash bill.',
    synonyms: ['paper', 'thermal', 'receipt', 'roll', 'a4', 'size'],
    control: { kind: 'segmented', options: [
      { value: 'a4', label: 'A4' },
      { value: 'thermal', label: '4 inch' },
      { value: 'thermal_3in', label: '3 inch' },
      { value: 'thermal_25in', label: '2.5 inch' },
    ] },
    scope: 'tenant',
    permission: TENANT, adapter: 'invoice', key: 'paperSize',
    visibleWhen: (c) => c.value('rep.billDesign') === 'cashbill',
  },
  {
    id: 'rep.docPrinter', group: 'reports', label: 'Bill and report printer',
    help: 'Desktop app only.',
    synonyms: ['printer', 'a4 printer', 'invoice printer', 'document printer'],
    control: { kind: 'select', optionsKey: 'documentPrinters' },
    scope: 'device',
    permission: ME, adapter: 'print', key: 'documentPrinter',
    visibleWhen: (c) => c.isElectron,
  },
  {
    id: 'rep.signature', group: 'reports', alsoIn: ['people'], label: 'My signature',
    help: 'Printed on reports you approve.',
    synonyms: ['signature', 'sign', 'e-sign', 'pathologist'],
    control: { kind: 'link', preview: (r) => String(r('signature')), link: { label: 'Draw', href: '/signature' } },
    scope: 'user', screens: ['pathologist'],
    permission: ME, adapter: 'me', key: 'signature',
  },
  {
    id: 'rep.regNo', group: 'reports', alsoIn: ['people'], label: 'My registration number',
    help: 'Printed under your signature.',
    synonyms: ['registration', 'council', 'reg no', 'mci', 'license', 'signature'],
    control: { kind: 'text', maxLength: 40, placeholder: 'e.g. TNMC 12345' },
    scope: 'user', screens: ['pathologist'],
    permission: ME, adapter: 'me', key: 'registrationId',
  },
  {
    id: 'rep.printLogo', group: 'reports', label: 'Print logo on bill', advanced: true,
    synonyms: ['logo', 'bill', 'invoice', 'letterhead'],
    control: { kind: 'switch' }, scope: 'tenant',
    permission: TENANT, adapter: 'invoice', key: 'showLogo',
  },
  {
    id: 'rep.printGstin', group: 'reports', label: 'Print GST number on bill', advanced: true,
    synonyms: ['gstin', 'gst', 'bill', 'invoice'],
    control: { kind: 'switch' }, scope: 'tenant',
    permission: TENANT, adapter: 'invoice', key: 'showGstin',
  },
  {
    id: 'rep.printQr', group: 'reports', label: 'Print tracking QR on bill', advanced: true,
    synonyms: ['qr', 'tracking', 'status', 'bill', 'invoice'],
    control: { kind: 'switch' }, scope: 'tenant',
    permission: TENANT, adapter: 'invoice', key: 'showTrackingQr',
  },
  {
    id: 'rep.billTitle', group: 'reports', label: 'Bill title', advanced: true,
    synonyms: ['tax invoice', 'bill of supply', 'document type', 'invoice'],
    control: { kind: 'segmented', options: [
      { value: 'auto', label: 'Auto' },
      { value: 'tax_invoice', label: 'Tax invoice' },
      { value: 'bill_of_supply', label: 'Bill of supply' },
    ] },
    scope: 'tenant',
    permission: TENANT, adapter: 'invoice', key: 'documentMode',
  },

  // ── Billing & money ────────────────────────────────────────────────────
  {
    id: 'bil.gst', group: 'money', label: 'Charge GST',
    help: 'Off: bills say "Bill of Supply".',
    synonyms: ['gst', 'tax', 'bill of supply', 'tax invoice'],
    control: { kind: 'switch' }, scope: 'tenant', screens: ['billing'],
    permission: TENANT, adapter: 'billing', key: 'gstEnabled',
  },
  {
    id: 'bil.gstin', group: 'money', label: 'GST number',
    help: "Saved numbers aren't shown here. Type to replace.",
    synonyms: ['gstin', 'gst', 'tax number', 'state code'],
    control: { kind: 'text', maxLength: 15, placeholder: '15 letters and digits',
      sanitize: (v) => v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 15) },
    scope: 'branch',
    permission: TENANT, adapter: 'gst', key: 'gstin',
  },
  {
    id: 'bil.discounts', group: 'money', label: 'Allow discounts',
    synonyms: ['discount', 'concession', 'offer'],
    control: { kind: 'switch' }, scope: 'tenant', screens: ['billing'],
    permission: TENANT, adapter: 'billing', key: 'allowDiscounts',
  },
  {
    id: 'bil.maxDisc', group: 'money', label: 'Front desk can give up to',
    synonyms: ['discount', 'limit', 'cap', 'percent', 'give_discount'],
    control: { kind: 'number', min: 0, max: 100, step: 1, unit: '%' },
    scope: 'tenant', screens: ['billing'],
    permission: TENANT, adapter: 'billing', key: 'maxDiscountPct',
    visibleWhen: (c) => c.value('bil.discounts') !== false,
  },
  {
    id: 'bil.overDisc', group: 'money', label: 'Senior staff can give up to',
    synonyms: ['discount', 'override', 'limit', 'cap', 'percent'],
    control: { kind: 'number', min: 0, max: 100, step: 1, unit: '%' },
    scope: 'tenant', screens: ['billing'],
    permission: TENANT, adapter: 'billing', key: 'overrideDiscountPct',
    visibleWhen: (c) => c.value('bil.discounts') !== false,
  },
  {
    id: 'bil.approval', group: 'money', label: 'Second person must approve above',
    synonyms: ['discount', 'approval', 'threshold', 'approve', 'percent'],
    control: { kind: 'number', min: 0, max: 100, step: 1, unit: '%' },
    scope: 'tenant', screens: ['billing'],
    permission: TENANT, adapter: 'billing', key: 'approvalThresholdPct',
    visibleWhen: (c) => c.value('bil.discounts') !== false,
  },
  {
    id: 'bil.invoiceNo', group: 'money', label: 'Bill number looks like',
    synonyms: ['invoice number', 'invoice prefix', 'bill number', 'numbering', 'series', 'start'],
    control: {
      kind: 'composite', preview: (r) => `${r('invoicePrefix')}/${new Date().getFullYear()}/${r('invoiceStartNumber')}`,
      fields: [
        { key: 'invoicePrefix', label: 'Starts with', control: { kind: 'text', maxLength: 12, sanitize: (v) => v.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 12) } },
        { key: 'invoiceStartNumber', label: 'First number', control: { kind: 'number', min: 1, max: 99999999, step: 1 } },
      ],
    },
    scope: 'tenant',
    permission: TENANT, adapter: 'billing', key: 'invoicePrefix',
    confirm: { title: 'Change how bill numbers look?', message: 'Only new bills change. Old numbers stay.', confirmLabel: 'Change', tone: 'primary' },
  },
  {
    id: 'bil.fullPay', group: 'money', label: 'Bill number only after full payment',
    help: "Until then it's an estimate.",
    synonyms: ['proforma', 'estimate', 'invoice', 'full payment', 'unpaid'],
    control: { kind: 'switch' }, scope: 'tenant', screens: ['billing'],
    permission: TENANT, adapter: 'billing', key: 'invoiceOnFullPaymentOnly',
  },
  {
    id: 'bil.upi', group: 'money', label: 'UPI ID for online payment',
    help: 'e.g. clinic@axis. Patients pay from their phone.',
    synonyms: ['upi', 'vpa', 'gpay', 'phonepe', 'paytm', 'online payment'],
    control: { kind: 'text', maxLength: 60, placeholder: 'name@bank', sanitize: (v) => v.replace(/\s/g, '') },
    scope: 'tenant', screens: ['billing'],
    permission: TENANT, adapter: 'billing', key: 'upiVpa',
  },
  {
    id: 'bil.bank', group: 'money', label: 'Bank account',
    synonyms: ['bank', 'account', 'ifsc', 'settlement', 'neft'],
    control: {
      kind: 'composite',
      preview: (r) => {
        const no = String(r('bankAccountNumber') ?? '');
        const bank = String(r('bankName') ?? '');
        return no ? `${bank ? bank + ' ' : ''}••••${no.slice(-4)}` : 'Not set';
      },
      fields: [
        { key: 'bankAccountName', label: 'Account holder', control: { kind: 'text', maxLength: 80 } },
        { key: 'bankAccountNumber', label: 'Account number', control: { kind: 'text', maxLength: 20, sanitize: (v) => v.replace(/[^0-9]/g, '') } },
        { key: 'bankIfsc', label: 'IFSC', control: { kind: 'text', maxLength: 11, sanitize: (v) => v.toUpperCase().replace(/[^A-Z0-9]/g, '') } },
        { key: 'bankName', label: 'Bank name', control: { kind: 'text', maxLength: 60 } },
      ],
    },
    scope: 'tenant',
    permission: TENANT, adapter: 'billing', key: 'bankAccountNumber',
  },
  {
    id: 'bil.upiName', group: 'money', label: 'UPI name shown to patient', advanced: true,
    synonyms: ['upi', 'payee', 'name'],
    control: { kind: 'text', maxLength: 60 }, scope: 'tenant',
    permission: TENANT, adapter: 'billing', key: 'upiPayeeName',
  },
  {
    id: 'bil.gstScope', group: 'money', label: 'GST filed', advanced: true,
    synonyms: ['gst', 'scope', 'region', 'filing'],
    control: { kind: 'segmented', options: [
      { value: 'branch', label: 'Each branch' },
      { value: 'region', label: 'By region' },
      { value: 'tenant', label: 'Whole lab' },
    ] },
    scope: 'tenant',
    permission: TENANT, adapter: 'billing', key: 'gstScope',
  },
  {
    id: 'bil.filing', group: 'money', label: 'GST return every', advanced: true,
    synonyms: ['gst', 'filing', 'monthly', 'quarterly', 'return'],
    control: { kind: 'segmented', options: [
      { value: 'monthly', label: 'Month' },
      { value: 'quarterly', label: '3 months' },
    ] },
    scope: 'tenant',
    permission: TENANT, adapter: 'billing', key: 'filingFrequency',
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
    id: 'setup.patientId', group: 'setup', label: 'Patient number looks like',
    help: 'Old numbers never change.',
    synonyms: ['patient id', 'mrn', 'uhid', 'registration number', 'format', 'prefix'],
    control: {
      kind: 'composite',
      preview: (r) => (r('patient.enabled') === true ? String(r('patient.preview')) : 'Built-in numbering'),
      fields: idFields('patient'),
    },
    scope: 'tenant',
    permission: TENANT, adapter: 'idFormat', key: 'patient.enabled',
    confirm: { title: 'Change how patient numbers look?', message: 'Only new patients change. Old numbers stay.', confirmLabel: 'Change', tone: 'primary' },
  },
  {
    id: 'setup.orderId', group: 'setup', label: 'Order number looks like',
    synonyms: ['order id', 'order number', 'format', 'prefix', 'numbering'],
    control: { kind: 'composite', preview: (r) => String(r('order.preview')), fields: idFields('order') },
    scope: 'tenant',
    permission: TENANT, adapter: 'idFormat', key: 'order.datePrefix',
    confirm: { title: 'Change how order numbers look?', message: 'Only new orders change. Old numbers stay.', confirmLabel: 'Change', tone: 'primary' },
  },
  {
    id: 'setup.addons', group: 'setup', label: 'Lab add-ons',
    help: 'Turn Lab features on or off.',
    synonyms: ['module', 'modules', 'feature', 'extension', 'home collection', 'microbiology', 'messages', 'inventory', 'add-on'],
    control: {
      kind: 'composite', inline: true,
      preview: (r) => `Coming soon: ${r('comingSoon')}`,
      fields: [
        { key: 'lab.homeCollection', label: 'Home collection', control: { kind: 'switch' } },
        { key: 'lab.microbiology', label: 'Microbiology (culture)', control: { kind: 'switch' } },
        { key: 'lab.reports', label: 'Reports', control: { kind: 'switch' } },
        { key: 'lab.messages', label: 'Messages', control: { kind: 'switch' } },
        { key: 'inventory', label: 'Stock (inventory)', control: { kind: 'switch' } },
      ],
    },
    scope: 'tenant',
    permission: ADMIN, adapter: 'modules', key: 'lab.reports',
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
