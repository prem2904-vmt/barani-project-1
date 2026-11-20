export interface ClinicalComposition {
  id: string;
  title: string;
  subtitle: string;
  category: string;
  description: string;
  componentsUsed: string[];
  principlesDemonstrated: string[];
}

export const CLINICAL_COMPOSITIONS: ClinicalComposition[] = [
  {
    id: 'order-create',
    title: 'Order & Payments (Canonical Pattern)',
    subtitle: 'Frontdesk Diagnostic Booking & Billing',
    category: 'Frontdesk & Billing',
    description: 'The foundational Prefrontal layout: Hero band with search context pill, left main test catalogue card, and right sticky billing summary card with INR calculations.',
    componentsUsed: ['pf-hero-band', 'pf-card', 'pf-segmented', 'pf-chip', 'pf-button', 'inr pipe', 'pf-busy'],
    principlesDemonstrated: [
      'Primary gradient strictly on the single main CTA (Generate Order).',
      'Split layout: Main work card on left, sticky summary card on right.',
      'INR currency formatted with tabular numbers (.pf-num).',
      'Neutral selected states for package tabs.'
    ]
  },
  {
    id: 'phlebotomy-collect',
    title: 'Phlebotomy Sample Collection Kiosk',
    subtitle: 'Touchscreen Specimen Intake & Verification',
    category: 'Laboratory & Phlebotomy',
    description: 'Designed for iPad and touch kiosks: large 44px touch buttons, barcode scanner integration, specimen tube status chips, and clinician PIN verification.',
    componentsUsed: ['pf-touch-btn', 'pf-barcode-display', 'pf-barcode-scanner-modal', 'pf-pin-dots', 'pf-status-chip', 'pf-avatar'],
    principlesDemonstrated: [
      'Min 44px tap targets for gloved phlebotomist operation.',
      'Code128 barcode symbology with tabular accession numbers.',
      'Immediate auto-advance 4-digit PIN verification on 4th digit.',
      'Urgent STAT priority pill with amber/red indicator.'
    ]
  },
  {
    id: 'patient-consent',
    title: 'Outpatient Registration & Sign-Off',
    subtitle: 'ABHA Verification & Consent Drawing',
    category: 'Frontdesk & Records',
    description: 'Patient check-in workflow with appointment time picker, department selection, and legal consent capture exported as transparent PNG.',
    componentsUsed: ['pf-date', 'pf-time', 'pf-datetime', 'pf-select', 'pf-signature-pad', 'pf-input'],
    principlesDemonstrated: [
      'Signature modal opened strictly on demand via secondary CTA.',
      'No native date/time pickers used (custom accessible Prefrontal controls).',
      'Masked numeric and alphanumeric inputs with pfNumeric and pfAlpha.'
    ]
  },
  {
    id: 'lab-workspace',
    title: 'Lab Workspace & Result Entry',
    subtitle: 'Specimen Verification, Sort & Technical Remarks',
    category: 'Laboratory & Phlebotomy',
    description: 'Technologist result entry console: Worklist sort picker, TAT tracking, polymorphic dynamic inputs with delta checks, abnormal flags, and technician note cards.',
    componentsUsed: ['pf-hero-band', 'pf-lab-sort', 'pf-tat-indicator', 'pf-dynamic-input', 'pf-report-notes-card', 'pf-status-chip', 'pf-button'],
    principlesDemonstrated: [
      'Persistent worklist sort order remembered per technologist.',
      'Out-of-range panic values highlighted with urgent red border.',
      'Pre-analytical quality remarks attached via standardized notes card.',
      'Single primary CTA (Authorize Results) on side action panel.'
    ]
  },
  {
    id: 'clinical-sharing',
    title: 'Multi-Channel Report Delivery & Comms',
    subtitle: 'Patient Diagnostic Report Dispatch & WhatsApp Dock',
    category: 'Reports & Dispatch',
    description: 'Integrated patient communication flow: multi-channel share sheet (WhatsApp, Email, SMS, Print), shared record preview card, and desktop WhatsApp Web dock.',
    componentsUsed: ['pf-share-sheet', 'pf-share-card', 'pf-wa-dock', 'pf-status-chip', 'pf-button'],
    principlesDemonstrated: [
      '92dvh mobile bottom sheet respecting bottom navbar clearance.',
      'Rich shared-record preview cards with SVG icon, title, and tone chip.',
      'WhatsApp Terms compliance: zero keystroke automation; drag-and-drop PDF card.',
      'Plain English error communication on email delivery refusal.'
    ]
  }
];

export interface TubeCapColor {
  name: string;
  additive: string;
  department: string;
  hex: string;
  borderHex: string;
  specimen: string;
}

export const CLINICAL_TUBE_CAPS: TubeCapColor[] = [
  { name: 'Lavender (EDTA)', additive: 'K2/K3 EDTA', department: 'Hematology (CBC, ESR, HbA1c)', hex: '#9333ea', borderHex: '#c084fc', specimen: 'Whole Blood' },
  { name: 'Gold / SST', additive: 'Clot Activator & Gel', department: 'Biochemistry & Serology (LFT, KFT, Lipid)', hex: '#eab308', borderHex: '#fde047', specimen: 'Serum' },
  { name: 'Red (Plain)', additive: 'No Additive / Clot Act', department: 'Blood Banking, Immunology', hex: '#ef4444', borderHex: '#fca5a5', specimen: 'Serum' },
  { name: 'Grey (Fluoride)', additive: 'Sodium Fluoride / K-Ox', department: 'Glucose (Fasting, PP, GTT)', hex: '#94a3b8', borderHex: '#cbd5e1', specimen: 'Plasma' },
  { name: 'Light Blue (Citrate)', additive: '3.2% Sodium Citrate', department: 'Coagulation (PT-INR, APTT, D-Dimer)', hex: '#0284c7', borderHex: '#38bdf8', specimen: 'Citrated Plasma' },
  { name: 'Green (Heparin)', additive: 'Lithium Heparin', department: 'Critical Care, Arterial Blood Gas', hex: '#16a34a', borderHex: '#4ade80', specimen: 'Heparinized Plasma' },
];

export const TOKEN_PALETTE = {
  primary: [
    { name: 'Violet 600 (Brand)', hex: '#7c3aed', cssVar: '--color-violet-600', use: 'Primary brand foundation, links, focus rings' },
    { name: 'Violet 500', hex: '#8b5cf6', cssVar: '--color-violet-500', use: 'Hover states, subtle badges' },
    { name: 'Fuchsia 500', hex: '#d946ef', cssVar: '--color-fuchsia-500', use: 'Gradient secondary anchor' },
    { name: 'Pink 500', hex: '#ec4899', cssVar: '--color-pink-500', use: 'Main CTA gradient terminus' },
  ],
  neutralsDark: [
    { name: 'Canvas Dark', hex: '#0a0a15', cssVar: '--bg-primary', use: 'App background' },
    { name: 'Card Dark', hex: '#131325', cssVar: '--bg-card-solid', use: 'Main & side card surface' },
    { name: 'Elevated Dark', hex: '#1e1e38', cssVar: '--surface-elevated', use: 'Modals, popovers, dropdowns' },
    { name: 'Line Dark', hex: 'rgba(255,255,255,0.12)', cssVar: '--border-muted', use: 'Subtle 1px card separators' },
  ],
  neutralsLight: [
    { name: 'Canvas Light', hex: '#f8f9fc', cssVar: '--bg-primary', use: 'App background in light mode' },
    { name: 'Card Light', hex: '#ffffff', cssVar: '--bg-card-solid', use: 'Card surface' },
    { name: 'Line Light', hex: '#e2e8f0', cssVar: '--border-muted', use: 'Card borders and dividers' },
    { name: 'Text Light Primary', hex: '#0f172a', cssVar: '--text-primary', use: 'Headings and high-contrast text' },
  ],
  clinicalSemantics: [
    { name: 'Urgent / STAT Red', hex: '#ef4444', cssVar: '--color-urgent', use: 'Panic values, emergency flags, critical ack' },
    { name: 'Required Amber', hex: '#f59e0b', cssVar: '--color-warning', use: 'Required dot indicator, unpriced items' },
    { name: 'Valid / Ready Green', hex: '#10b981', cssVar: '--color-success', use: 'Authorized results, received vials' },
  ]
};
