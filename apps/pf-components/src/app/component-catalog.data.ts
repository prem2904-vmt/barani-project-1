export interface PropDoc {
  name: string;
  type: string;
  required: boolean;
  default?: string;
  description: string;
}

export interface EventDoc {
  name: string;
  type: string;
  description: string;
}

export interface ComponentRecipe {
  title: string;
  scenario: string;
  templateSnippet: string;
  tsSnippet?: string;
}

export interface ComponentDoc {
  id: string;
  name: string;
  selector: string;
  category: 'General' | 'Layout' | 'Navigation' | 'Data Entry' | 'Data Display' | 'Feedback' | 'Utilities' | 'Theme & Tokens';
  summary: string;
  clinicalScenario?: string;
  importStatement: string;
  templateSnippet: string;
  inputs: PropDoc[];
  outputs?: EventDoc[];
  guidance?: string[];
  recipes?: ComponentRecipe[];
}

export interface CategoryGroup {
  name: 'General' | 'Layout' | 'Navigation' | 'Data Entry' | 'Data Display' | 'Feedback' | 'Utilities' | 'Theme & Tokens';
  id: string;
  description: string;
  components: ComponentDoc[];
}

export const CATALOG_COMPONENTS: ComponentDoc[] = [
  // ── Layout (Hero Band & Clinical Headers) ───────────────────────────────────
  {
    id: 'hero-band',
    name: 'Hero Band',
    selector: 'pf-hero-band',
    category: 'Layout',
    summary: 'The signature Prefrontal screen header (Figma 446-113). Combines brand gradient, tenant logo, context search pill, and primary actions CTA.',
    importStatement: "import { HeroBandComponent } from '@prefrontal/shared';",
    templateSnippet: `<pf-hero-band [tenantName]="'Micro World'">
  <ng-container band-actions>
    <pf-button variant="primary">+ New Patient</pf-button>
  </ng-container>
  <ng-container band-tools>
    <button type="button" class="pf-hb-tool" title="Scan QR"><pf-scan-icon [size]="18" /></button>
  </ng-container>
</pf-hero-band>`,
    inputs: [
      { name: 'tenantName', type: 'string', required: false, default: "'Micro World'", description: 'Name of the clinic or lab tenant.' },
      { name: 'tenantLogo', type: 'string | null', required: false, default: 'null', description: 'URL of uploaded transparent PNG branding logo.' },
      { name: 'back', type: 'boolean', required: false, default: 'false', description: 'Renders the back chevron affordance on the left.' },
      { name: 'placeholder', type: 'string', required: false, default: "'Search patient · name, phone, MRN...'", description: 'Placeholder for built-in search input.' },
      { name: 'tabsOnly', type: 'boolean', required: false, default: 'false', description: 'Replaces search field with tab switcher across the full pill.' },
      { name: 'contextBar', type: 'boolean', required: false, default: 'false', description: 'Expands pill into multi-chip context bar.' },
    ],
    outputs: [
      { name: 'valueChange', type: 'EventEmitter<string>', description: 'Emitted on search input keystrokes.' },
      { name: 'submitted', type: 'EventEmitter<string>', description: 'Emitted on Enter keypress in search.' },
      { name: 'backAction', type: 'EventEmitter<void>', description: 'Emitted when the back button is clicked.' }
    ],
    clinicalScenario: 'Topmost context header across all main clinical screens: Frontdesk Reception, Sample Collection, Lab Workspace, and Results Validation.',
    guidance: [
      'The hero band is the ONLY place where the primary gradient is used for the single main CTA button.',
      'The search pill overlaps the bottom edge of the band by -33px for depth.',
      'Never hide the bottom navigation bar when using the hero band.'
    ],
    recipes: [
      {
        title: 'Frontdesk Landing with Patient Search & Actions',
        scenario: 'Canonical frontdesk reception screen with tenant branding and scan tool.',
        templateSnippet: `<pf-hero-band [tenantName]="'Micro World'" [placeholder]="'Search patient · name, phone, MRN...'">
  <ng-container band-actions>
    <pf-button variant="primary">+ New Patient</pf-button>
  </ng-container>
  <ng-container band-tools>
    <button type="button" class="pf-hb-tool" title="Scan QR"><pf-scan-icon [size]="18" /></button>
  </ng-container>
</pf-hero-band>`
      }
    ]
  },

  // ── Navigation (Screen Header & Alerts) ────────────────────────────────────
  {
    id: 'screen-header',
    name: 'Screen Header',
    selector: 'pf-screen-header',
    category: 'Navigation',
    summary: 'Standard screen navigation header with back affordance, screen title, subtitle, and action buttons.',
    importStatement: "import { ScreenHeaderComponent } from '@prefrontal/shared';",
    templateSnippet: `<pf-screen-header [title]="'Test Catalog'" [subtitle]="'Manage laboratory test master and pricing'" [showBack]="true">
  <div header-actions>
    <pf-button variant="secondary">Export CSV</pf-button>
    <pf-button variant="primary">Add Test</pf-button>
  </div>
</pf-screen-header>`,
    inputs: [
      { name: 'title', type: 'string', required: true, default: "''", description: 'Main screen title.' },
      { name: 'subtitle', type: 'string', required: false, default: "''", description: 'Subordinate description or breadcrumb.' },
      { name: 'showBack', type: 'boolean', required: false, default: 'false', description: 'Shows leading back button chevron.' },
      { name: 'noBack', type: 'boolean', required: false, default: 'false', description: 'Forces back button to remain hidden.' }
    ],
    outputs: [
      { name: 'back', type: 'EventEmitter<void>', description: 'Emitted when user taps back chevron.' }
    ]
  },
  {
    id: 'notification-bell',
    name: 'Notification Bell',
    selector: 'pf-notification-bell',
    category: 'Navigation',
    summary: 'Top navigation alert bell with live badge counter and dropdown notification inbox drawer.',
    importStatement: "import { NotificationBellComponent } from '@prefrontal/shared';",
    templateSnippet: `<pf-notification-bell [unreadCount]="4" />`,
    inputs: [
      { name: 'unreadCount', type: 'number', required: false, default: '0', description: 'Number of unread notifications.' }
    ]
  },

  // ── Data Entry (Patient Search) ───────────────────────────────────────────
  {
    id: 'patient-search',
    name: 'Patient Search',
    selector: 'pf-patient-search',
    category: 'Data Entry',
    summary: 'Universal patient lookup input with keyboard shortcut (⌘K), suggestions popover, and advanced filter dialog trigger.',
    importStatement: "import { PatientSearchComponent } from '@prefrontal/shared';",
    templateSnippet: `<pf-patient-search placeholder="Search patient · name, phone, MRN, ABHA…" />`,
    inputs: [
      { name: 'placeholder', type: 'string', required: false, default: "'Search patient...'", description: 'Input placeholder.' }
    ]
  },

  // ── Data Display (Clinical Indicators & Chips) ────────────────────────────
  {
    id: 'tat-indicator',
    name: 'TAT Indicator',
    selector: 'pf-tat-indicator',
    category: 'Data Display',
    summary: 'Turn Around Time clock chip. Displays remaining specimen processing time with overdue and urgency warning states.',
    importStatement: "import { TatIndicatorComponent } from '@prefrontal/shared';",
    templateSnippet: `<pf-tat-indicator [remainingMinutes]="15" />
<pf-tat-indicator [remainingMinutes]="-10" />
<pf-tat-indicator [remainingMinutes]="120" />`,
    inputs: [
      { name: 'remainingMinutes', type: 'number | null', required: false, default: 'null', description: 'Minutes remaining until specimen TAT deadline.' },
      { name: 'state', type: "'normal' | 'dueSoon' | 'overdue' | null", required: false, default: 'null', description: 'Visual state override.' },
      { name: 'label', type: 'string | null', required: false, default: 'null', description: 'Text label override.' }
    ],
    clinicalScenario: 'Specimen processing queues in Hematology, Biochemistry, and emergency STAT tracking.',
    guidance: [
      'Green/slate indicates test is on schedule.',
      'Amber dot indicates test is due within 30 minutes.',
      'Rose/red dot indicates test has breached clinical TAT SLA.'
    ]
  },
  {
    id: 'daily-no',
    name: 'Daily Number',
    selector: 'pf-daily-no',
    category: 'Data Display',
    summary: 'Accession daily sequence badge (#12). Prefixes patient names on specimen intake queues and analyzer logs.',
    importStatement: "import { DailyNoComponent } from '@prefrontal/shared';",
    templateSnippet: `<pf-daily-no [no]="12" />`,
    inputs: [
      { name: 'no', type: 'number | string | null', required: true, default: 'null', description: 'Daily accession counter sequence.' }
    ]
  },
  {
    id: 'origin-badge',
    name: 'Origin Badge',
    selector: 'pf-origin-badge',
    category: 'Data Display',
    summary: 'Test master single-source pill: Master, Customised, Branch, or Own test.',
    importStatement: "import { OriginBadgeComponent } from '@prefrontal/shared';",
    templateSnippet: `<pf-origin-badge origin="master" />
<pf-origin-badge origin="clone" />
<pf-origin-badge origin="own" />`,
    inputs: [
      { name: 'origin', type: 'string | null', required: false, default: "'master'", description: 'Test catalog origin: master, clone, own, or branch.' },
      { name: 'catalogMode', type: 'string | null', required: false, default: 'null', description: "Optional override (e.g. 'clone')." }
    ]
  },
  {
    id: 'presence-avatar',
    name: 'Presence Avatar',
    selector: 'pf-presence-avatar',
    category: 'Data Display',
    summary: 'Clinical user avatar with real-time presence dot (online, away, in consultation, offline).',
    importStatement: "import { PresenceAvatarComponent } from '@prefrontal/shared';",
    templateSnippet: `<pf-presence-avatar [name]="'Dr. Ananya Rao'" [status]="'online'" [size]="36" />`,
    inputs: [
      { name: 'name', type: 'string', required: true, default: "''", description: 'Full user or physician display name.' },
      { name: 'status', type: "'online' | 'busy' | 'away' | 'offline'", required: false, default: "'online'", description: 'Current live presence state.' },
      { name: 'size', type: 'number', required: false, default: '32', description: 'Pixel diameter of the circular avatar.' }
    ]
  },
  {
    id: 'kpi-strip',
    name: 'KPI Strip',
    selector: 'pf-kpi-strip',
    category: 'Data Display',
    summary: 'High-density operational metric cards strip for clinical queues (STAT counts, ready for dispatch, pending phlebotomy).',
    importStatement: "import { KpiStripComponent } from '@prefrontal/shared';",
    templateSnippet: `<pf-kpi-strip screen="frontdesk_landing" />`,
    inputs: [
      { name: 'screen', type: 'string', required: true, default: "'frontdesk_landing'", description: 'Context screen identifier determining which KPI metrics display.' }
    ]
  },

  // ── Feedback (Critical Alerts) ────────────────────────────────────────────
  {
    id: 'critical-ack-strip',
    name: 'Critical Panic Ack Strip',
    selector: 'pf-critical-ack-strip',
    category: 'Feedback',
    summary: 'Emergency panic value doctor notification and laboratory acknowledgement banner for life-threatening lab results.',
    importStatement: "import { CriticalAckStripComponent } from '@prefrontal/shared';",
    templateSnippet: `<pf-critical-ack-strip [criticalCount]="2" />`,
    inputs: [
      { name: 'criticalCount', type: 'number', required: false, default: '1', description: 'Number of unacknowledged panic values.' }
    ]
  },

  // ── General ──────────────────────────────────────────────────────────────
  {
    id: 'button',
    name: 'Button',
    selector: 'pf-button',
    category: 'General',
    summary: 'Accessible action button. The primary gradient is strictly reserved for the single main CTA on each view.',
    importStatement: "import { PfButtonComponent } from '@prefrontal/shared';",
    templateSnippet: `<pf-button variant="primary">Confirm Order</pf-button>
<pf-button variant="secondary">Cancel</pf-button>`,
    inputs: [
      { name: 'variant', type: "'primary' | 'secondary' | 'tertiary' | 'danger' | 'quiet'", required: false, default: "'secondary'", description: 'Visual style. Use primary only on the single main CTA.' },
      { name: 'size', type: "'sm' | 'md' | 'lg'", required: false, default: "'md'", description: 'Button dimensions and padding.' },
      { name: 'disabled', type: 'boolean', required: false, default: 'false', description: 'Disables pointer events and lowers opacity.' },
      { name: 'type', type: "'button' | 'submit' | 'reset'", required: false, default: "'button'", description: 'Native button type attribute.' },
    ],
    clinicalScenario: 'Main order confirmation button in Billing, specimen intake action, and dialog primary CTA.',
    guidance: [
      'Primary gradient is ONLY for the single main CTA on the screen.',
      'Secondary outline button is used for standard actions like "Save as draft" or "Back".',
      'Quiet variant has no border or fill until hovered, ideal for toolbar actions.'
    ],
    recipes: [
      {
        title: 'Single Primary CTA with Secondary Cancel',
        scenario: 'Use in a sticky card footer. Only one primary button exists on the screen.',
        templateSnippet: `<div class="flex items-center justify-end gap-3 p-4">
  <pf-button variant="secondary" (click)="onCancel()">Cancel</pf-button>
  <pf-button variant="primary" (click)="onGenerateInvoice()">Generate Invoice (₹ 2,450)</pf-button>
</div>`,
        tsSnippet: `onGenerateInvoice(): void {
  this.billingService.finalizeOrder(this.orderId);
}`
      },
      {
        title: 'Critical Deletion or Discard',
        scenario: 'Use the danger variant for irreversible actions such as discarding an order draft.',
        templateSnippet: `<pf-button variant="danger" (click)="onDiscardOrder()">Discard Draft</pf-button>`
      }
    ]
  },
  {
    id: 'touch-button',
    name: 'Touch Button',
    selector: 'pf-touch-btn',
    category: 'General',
    summary: 'Tactile button tailored for touchscreens (iPad, clinical barcode kiosks) with built-in spring motion feedback.',
    importStatement: "import { TouchButtonComponent } from '@prefrontal/shared';",
    templateSnippet: `<pf-touch-btn size="md" variant="primary" (pressed)="onSave()">
  Save Specimen
</pf-touch-btn>`,
    inputs: [
      { name: 'variant', type: "'primary' | 'secondary' | 'ghost' | 'accent' | 'danger' | 'success'", required: false, default: "'primary'", description: 'Styling variant tailored for touch interfaces.' },
      { name: 'size', type: "'sm' | 'md' | 'lg' | 'xl'", required: false, default: "'md'", description: 'Tap target size (min 44px for clinical compliance).' },
      { name: 'busy', type: 'boolean', required: false, default: 'false', description: 'Renders inline busy dots and prevents double-taps.' },
      { name: 'busyLabel', type: 'string', required: false, default: "'Working.'", description: 'Screen-reader accessible busy announcement.' },
      { name: 'disabled', type: 'boolean', required: false, default: 'false', description: 'Disables tap response.' },
      { name: 'full', type: 'boolean', required: false, default: 'false', description: 'Expands button to fill 100% container width.' },
    ],
    outputs: [
      { name: 'pressed', type: 'EventEmitter<MouseEvent>', description: 'Fires when tap or click is triggered with touch haptic.' },
    ],
    guidance: [
      'Use for phlebotomy desks, collection terminals, and patient check-in kiosks.',
      'Maintains minimum 44px physical tap area to prevent miss-taps in busy clinical environments.'
    ]
  },
  {
    id: 'logo-mark',
    name: 'Logo Mark',
    selector: 'pf-logo-mark',
    category: 'General',
    summary: 'Official Prefrontal vector logo with optional wordmark and pulsed heartbeat ring.',
    importStatement: "import { LogoMarkComponent } from '@prefrontal/shared';",
    templateSnippet: `<pf-logo-mark [size]="'sm'" [withWordmark]="true" />`,
    inputs: [
      { name: 'size', type: "'xs' | 'sm' | 'md' | 'lg' | 'xl'", required: false, default: "'md'", description: 'Geometric dimensions of the logo mark.' },
      { name: 'variant', type: "'badge' | 'glyph' | 'mono'", required: false, default: "'badge'", description: 'Pill badge, brand gradient glyph, or single-color mono.' },
      { name: 'withWordmark', type: 'boolean', required: false, default: 'false', description: 'Includes the "Prefrontal" typographic wordmark.' },
      { name: 'wordmarkColor', type: 'string', required: false, default: "'var(--text-primary)'", description: 'CSS color string for the wordmark text.' },
      { name: 'pulse', type: 'boolean', required: false, default: 'false', description: 'Enables gentle ambient pulse rings on badge variant.' },
    ],
    outputs: [],
  },
  {
    id: 'scan-icon',
    name: 'Scan Icon',
    selector: 'pf-scan-icon',
    category: 'General',
    summary: 'Stroked 24x24 vector icon representing barcode and specimen scanning across reception and lab screens.',
    importStatement: "import { ScanIconComponent } from '@prefrontal/shared';",
    templateSnippet: `<pf-scan-icon [size]="24" />`,
    inputs: [
      { name: 'size', type: 'number', required: false, default: '24', description: 'Width and height in pixels.' },
      { name: 'color', type: 'string', required: false, default: "'currentColor'", description: 'Stroke fill color.' },
    ],
    outputs: [],
  },
  {
    id: 'loading-logo',
    name: 'Loading Logo',
    selector: 'pf-loading-logo',
    category: 'General',
    summary: 'Animated heartbeat and DNA helix logo for branding on sign-in and splash screens.',
    importStatement: "import { LoadingLogoComponent } from '@prefrontal/shared';",
    templateSnippet: `<pf-loading-logo [size]="'md'" color="purple" [showText]="true" />`,
    inputs: [
      { name: 'size', type: "'micro' | 'xs' | 'sm' | 'md' | 'lg' | 'xl'", required: false, default: "'md'", description: 'Scale of the animated logo.' },
      { name: 'color', type: "'purple' | 'emerald' | 'white'", required: false, default: "'purple'", description: 'Color scheme of the glowing gradient.' },
      { name: 'showText', type: 'boolean', required: false, default: 'false', description: 'Shows animated text below the logo.' },
      { name: 'text', type: 'string', required: false, default: "'Loading…'", description: 'Caption text displayed.' },
      { name: 'inline', type: 'boolean', required: false, default: 'false', description: 'Compact layout for buttons or chips.' },
    ],
    outputs: [],
    guidance: [
      'Reserved for sign-in and initial app load. In-app loading regions must use pf-skeleton or pf-busy instead.'
    ]
  },

  // ── Layout ───────────────────────────────────────────────────────────────
  {
    id: 'card',
    name: 'Card Surface',
    selector: 'pf-card',
    category: 'Layout',
    summary: 'Composable new-design card surface. Combined with header, body, and sticky footer.',
    importStatement: "import { PfCardComponent, PfCardHeaderComponent, PfCardBodyComponent, PfCardFooterComponent } from '@prefrontal/shared';",
    templateSnippet: `<pf-card>
  <pf-card-header>
    <span class="pf-card__label">Patient Details</span>
  </pf-card-header>
  <pf-card-body>
    <p>Card content goes here...</p>
  </pf-card-body>
  <pf-card-footer>
    <pf-button variant="primary">Submit</pf-button>
  </pf-card-footer>
</pf-card>`,
    inputs: [],
    outputs: [],
    guidance: [
      'Card header features a 1px bottom border and subtle brand tint.',
      'Card footer is sticky to the bottom of the card and clears the bottom navigation bar.'
    ]
  },
  {
    id: 'ambient-bg',
    name: 'Ambient Background',
    selector: 'pf-ambient-bg',
    category: 'Layout',
    summary: 'Atmospheric backdrop with gradient wash and subtle medical drifting elements at z-index 0.',
    importStatement: "import { AmbientBgComponent } from '@prefrontal/shared';",
    templateSnippet: `<pf-ambient-bg />`,
    inputs: [],
    outputs: [],
    guidance: [
      'Automatically pauses animation when the browser tab is hidden.',
      'Becomes static on touch devices to conserve battery and GPU fill-rate.'
    ]
  },

  // ── Navigation ───────────────────────────────────────────────────────────
  {
    id: 'actions-menu',
    name: 'Actions Menu',
    selector: 'pf-actions-menu',
    category: 'Navigation',
    summary: 'Secondary action popover drawer. Adapts between desktop popover and mobile 92dvh bottom sheet.',
    importStatement: "import { ActionsMenuComponent, PfAction } from '@prefrontal/shared';",
    templateSnippet: `<pf-actions-menu [actions]="menuActions" heading="Specimen Actions" (action)="handleAction($event)" />`,
    inputs: [
      { name: 'actions', type: 'PfAction[]', required: true, description: 'Array of actions with id, label, icon, group, and optional danger flag.' },
      { name: 'heading', type: 'string', required: false, default: "'Actions'", description: 'Sheet heading displayed on mobile view.' },
      { name: 'compact', type: 'boolean', required: false, default: 'false', description: 'Renders smaller 32px trigger button.' },
      { name: 'align', type: "'start' | 'end'", required: false, default: "'end'", description: 'Popover menu alignment relative to trigger.' },
    ],
    outputs: [
      { name: 'action', type: 'output<string>()', description: 'Emits the action id selected by the user.' },
    ],
    guidance: [
      'Always clear of the bottom navbar on phones.',
      'Grouping actions creates visual section dividers in the drawer.'
    ]
  },

  // ── Data Entry ───────────────────────────────────────────────────────────
  {
    id: 'input',
    name: 'Input Directive',
    selector: 'input[pfInput]',
    category: 'Data Entry',
    summary: 'Directive applied to native <input> and <textarea> elements for uniform focus, padding, and text colors.',
    importStatement: "import { PfInputDirective } from '@prefrontal/shared';",
    templateSnippet: `<input pfInput [(ngModel)]="search" placeholder="Search patients by MRN or phone" />`,
    inputs: [],
    outputs: [],
  },
  {
    id: 'select',
    name: 'Select Dropdown',
    selector: 'pf-select',
    category: 'Data Entry',
    summary: 'Accessible custom select dropdown supporting search filter, optgroups, and multi-select.',
    importStatement: "import { SelectComponent, PfSelectOption } from '@prefrontal/shared';",
    templateSnippet: `<pf-select [options]="deptOptions" [(value)]="selectedDept" placeholder="Choose department" />`,
    inputs: [
      { name: 'options', type: 'PfSelectOption<T>[]', required: true, description: 'List of option objects: { value, label, hint?, disabled? }.' },
      { name: 'value', type: 'T', required: false, description: 'Currently selected option value (two-way bindable via [(value)]).' },
      { name: 'placeholder', type: 'string', required: false, default: "'Select.'", description: 'Text shown when no option is chosen.' },
      { name: 'size', type: "'sm' | 'md' | 'lg'", required: false, default: "'md'", description: 'Height and font dimensions.' },
      { name: 'searchable', type: 'boolean', required: false, default: 'false', description: 'Shows search filter field inside dropdown.' },
      { name: 'multiple', type: 'boolean', required: false, default: 'false', description: 'Enables multi-select tag mode.' },
      { name: 'values', type: 'T[]', required: false, description: 'Selected values array when multiple=true.' },
      { name: 'disabled', type: 'boolean', required: false, default: 'false', description: 'Disables select dropdown.' },
    ],
    outputs: [
      { name: 'valueChange', type: 'EventEmitter<T>', description: 'Fires when selected value changes.' },
      { name: 'valuesChange', type: 'EventEmitter<T[]>', description: 'Fires when multiple selection array changes.' },
    ],
  },
  {
    id: 'segmented',
    name: 'Segmented Control',
    selector: 'pf-segmented',
    category: 'Data Entry',
    summary: 'Linear segmented pill switcher with neutral selected state for tabs and filtering.',
    importStatement: "import { PfSegmentedComponent, SegmentedOption } from '@prefrontal/shared';",
    templateSnippet: `<pf-segmented [options]="viewOptions" [(value)]="currentView" ariaLabel="View Mode" />`,
    inputs: [
      { name: 'options', type: 'SegmentedOption<T>[]', required: true, description: 'Options list: { value, label, count?, icon?, disabled? }.' },
      { name: 'value', type: 'T', required: true, description: 'Active selected segment value (two-way bindable).' },
      { name: 'size', type: "'xs' | 'sm' | 'md' | 'lg'", required: false, default: "'sm'", description: 'Pill height and padding.' },
      { name: 'ariaLabel', type: 'string', required: false, description: 'Accessibility label for screen readers.' },
      { name: 'allowDeselect', type: 'boolean', required: false, default: 'false', description: 'Allows clicking active item to deselect.' },
    ],
    outputs: [
      { name: 'valueChange', type: 'EventEmitter<T>', description: 'Fires when segment selection changes.' },
    ],
    guidance: [
      'Active state uses neutral slate background, NEVER primary gradient.'
    ]
  },
  {
    id: 'number-input',
    name: 'Number Input',
    selector: 'pf-number-input',
    category: 'Data Entry',
    summary: 'Bounded numeric input with increment/decrement steppers and optional unit suffix.',
    importStatement: "import { NumberInputComponent } from '@prefrontal/shared';",
    templateSnippet: `<pf-number-input [(value)]="doseQty" [min]="1" [max]="500" suffix="mg" />`,
    inputs: [
      { name: 'value', type: 'number | null', required: false, default: '0', description: 'Numeric value (two-way bindable via [(value)]).' },
      { name: 'min', type: 'number', required: false, description: 'Minimum allowed value.' },
      { name: 'max', type: 'number', required: false, description: 'Maximum allowed value.' },
      { name: 'step', type: 'number', required: false, default: '1', description: 'Step delta on button clicks.' },
      { name: 'suffix', type: 'string', required: false, description: 'Unit label displayed after number (e.g. "units", "ml").' },
      { name: 'size', type: "'sm' | 'md' | 'lg'", required: false, default: "'md'", description: 'Height and typography size.' },
      { name: 'disabled', type: 'boolean', required: false, default: 'false', description: 'Disables input and stepper buttons.' },
    ],
    outputs: [
      { name: 'valueChange', type: 'EventEmitter<number | null>', description: 'Fires when numeric value changes.' },
    ],
  },
  {
    id: 'num-pad',
    name: 'Touch NumPad',
    selector: 'pf-num-pad',
    category: 'Data Entry',
    summary: 'Tactile onscreen numeric keypad designed for clinical tablet data entry without software keyboard popups.',
    importStatement: "import { NumPadComponent } from '@prefrontal/shared';",
    templateSnippet: `<pf-num-pad [(value)]="code" [allowDecimal]="false" [maxLength]="6" />`,
    inputs: [
      { name: 'value', type: 'string', required: false, default: "''", description: 'Entered digits string (two-way bindable).' },
      { name: 'allowDecimal', type: 'boolean', required: false, default: 'true', description: 'Shows "." decimal key.' },
      { name: 'allowNegative', type: 'boolean', required: false, default: 'false', description: 'Shows "+/-" toggle key.' },
      { name: 'compact', type: 'boolean', required: false, default: 'false', description: 'Reduced key gaps and padding.' },
      { name: 'maxLength', type: 'number', required: false, default: '12', description: 'Maximum character limit allowed.' },
      { name: 'showConfirm', type: 'boolean', required: false, default: 'false', description: 'Shows green confirm CTA button.' },
    ],
    outputs: [
      { name: 'valueChange', type: 'EventEmitter<string>', description: 'Fires when digits change.' },
      { name: 'confirmed', type: 'EventEmitter<void>', description: 'Fires when confirm button is tapped.' },
    ],
  },
  {
    id: 'toggle',
    name: 'Toggle Switch',
    selector: 'pf-toggle',
    category: 'Data Entry',
    summary: 'Slate neutral toggle switch with smooth spring knob transition.',
    importStatement: "import { ToggleComponent } from '@prefrontal/shared';",
    templateSnippet: `<pf-toggle [(checked)]="isActive" />`,
    inputs: [
      { name: 'checked', type: 'boolean', required: false, default: 'false', description: 'Current boolean switch state (two-way bindable).' },
      { name: 'size', type: "'sm' | 'md' | 'lg'", required: false, default: "'md'", description: 'Physical track dimensions.' },
      { name: 'disabled', type: 'boolean', required: false, default: 'false', description: 'Disables switch interaction.' },
    ],
    outputs: [
      { name: 'checkedChange', type: 'EventEmitter<boolean>', description: 'Fires on state toggle.' },
    ],
    guidance: [
      'Track follows neutral slate colors when ON, brand violet accent where required by spec.'
    ]
  },
  {
    id: 'date',
    name: 'Date Picker',
    selector: 'pf-date',
    category: 'Data Entry',
    summary: 'Accessible calendar date picker. Value formatted as YYYY-MM-DD.',
    importStatement: "import { PfDateComponent } from '@prefrontal/shared';",
    templateSnippet: `<pf-date label="Collection Date" [value]="dateStr" (valueChange)="dateStr = $event" />`,
    inputs: [
      { name: 'value', type: 'string | null', required: false, description: 'Selected date in YYYY-MM-DD format.' },
      { name: 'label', type: 'string', required: false, default: "'Date'", description: 'Accessible input label.' },
      { name: 'min', type: 'string', required: false, description: 'Minimum selectable date (YYYY-MM-DD).' },
      { name: 'max', type: 'string', required: false, description: 'Maximum selectable date (YYYY-MM-DD).' },
      { name: 'disabled', type: 'boolean', required: false, default: 'false', description: 'Disables date picker.' },
    ],
    outputs: [
      { name: 'valueChange', type: 'output<string | null>()', description: 'Emits updated date string.' },
    ],
  },
  {
    id: 'calendar',
    name: 'Calendar View',
    selector: 'pf-calendar',
    category: 'Data Entry',
    summary: 'Full month calendar view with day grid, month navigation, today indicator, and keyboard roving.',
    importStatement: "import { PfCalendarComponent } from '@prefrontal/shared';",
    templateSnippet: `<pf-calendar [value]="dateStr" (valueChange)="dateStr = $event" />`,
    inputs: [
      { name: 'value', type: 'string | null', required: false, description: 'Selected date in YYYY-MM-DD format.' },
      { name: 'min', type: 'string', required: false, description: 'Minimum selectable date (YYYY-MM-DD).' },
      { name: 'max', type: 'string', required: false, description: 'Maximum selectable date (YYYY-MM-DD).' },
      { name: 'compact', type: 'boolean', required: false, default: 'false', description: 'Enables compact padding mode.' },
    ],
    outputs: [
      { name: 'valueChange', type: 'output<string>()', description: 'Emits selected date in YYYY-MM-DD format.' },
    ],
  },
  {
    id: 'time',
    name: 'Time Picker',
    selector: 'pf-time',
    category: 'Data Entry',
    summary: 'Time picker with 15-minute intervals and manual typing support. Value formatted as HH:mm.',
    importStatement: "import { PfTimeComponent } from '@prefrontal/shared';",
    templateSnippet: `<pf-time label="Collection Time" [value]="timeStr" (valueChange)="timeStr = $event" />`,
    inputs: [
      { name: 'value', type: 'string | null', required: false, description: 'Selected time in HH:mm format (24-hour).' },
      { name: 'label', type: 'string', required: false, default: "'Time'", description: 'Accessible label.' },
      { name: 'step', type: 'number', required: false, default: '15', description: 'Minute step interval.' },
      { name: 'disabled', type: 'boolean', required: false, default: 'false', description: 'Disables time input.' },
    ],
    outputs: [
      { name: 'valueChange', type: 'output<string | null>()', description: 'Emits updated time string.' },
    ],
  },
  {
    id: 'datetime',
    name: 'DateTime Picker',
    selector: 'pf-datetime',
    category: 'Data Entry',
    summary: 'Combined date and time control emitting standard ISO string YYYY-MM-DDTHH:mm.',
    importStatement: "import { PfDateTimeComponent } from '@prefrontal/shared';",
    templateSnippet: `<pf-datetime label="Appointment" [value]="scheduledAt" (valueChange)="scheduledAt = $event" />`,
    inputs: [
      { name: 'value', type: 'string | null', required: false, description: 'DateTime string in YYYY-MM-DDTHH:mm format.' },
      { name: 'label', type: 'string', required: false, default: "'Date & Time'", description: 'Field group label.' },
      { name: 'disabled', type: 'boolean', required: false, default: 'false', description: 'Disables both pickers.' },
    ],
    outputs: [
      { name: 'valueChange', type: 'output<string | null>()', description: 'Emits updated combined datetime string.' },
    ],
  },
  {
    id: 'pin-dots',
    name: 'PIN Dots',
    selector: 'pf-pin-dots',
    category: 'Data Entry',
    summary: 'Tailwind-first 4-digit masked passcode verification with auto-advance and backspace support.',
    importStatement: "import { PinDotsComponent } from '@prefrontal/shared';",
    templateSnippet: `<pf-pin-dots (completed)="onVerifyPin($event)" />`,
    clinicalScenario: 'Nurse or Pathologist rapid PIN verification for lab result authorization or narcotics dispensing.',
    inputs: [
      { name: 'autofocus', type: 'boolean', required: false, default: 'true', description: 'Focuses hidden numeric input on mount.' },
      { name: 'disabled', type: 'boolean', required: false, default: 'false', description: 'Disables PIN entry.' },
    ],
    outputs: [
      { name: 'completed', type: 'output<string>()', description: 'Fires automatically the moment the fourth digit is entered.' },
    ],
    recipes: [
      {
        title: 'Auto-Submit Clinician Authorization',
        scenario: 'Instantly validates PIN when user enters the 4th digit without requiring a button press.',
        templateSnippet: `<div class="p-4 border rounded-xl flex flex-col items-center gap-3">
  <span class="text-sm font-medium">Enter 4-digit Pathologist PIN</span>
  <pf-pin-dots (completed)="onAuthorizeResult($event)" />
</div>`,
        tsSnippet: `onAuthorizeResult(pin: string): void {
  if (this.authService.verifyPin(pin)) {
    this.releaseLabReport();
  }
}`
      }
    ]
  },
  {
    id: 'signature-pad',
    name: 'Signature Pad',
    selector: 'pf-signature-pad',
    category: 'Data Entry',
    summary: 'Full-screen drawing modal for patient consent and sign-offs. Exports transparent trimmed PNG data URL.',
    importStatement: "import { SignaturePadComponent } from '@prefrontal/shared';",
    templateSnippet: `@if (showSignaturePad) {
  <pf-signature-pad
    [initialDataUrl]="existingSig"
    (saved)="onSaved($event)"
    (cancelled)="showSignaturePad = false" />
}`,
    clinicalScenario: 'Patient legal consent capture for invasive procedures, biopsy releases, and insurance acknowledgments.',
    inputs: [
      { name: 'initialDataUrl', type: 'string | null', required: false, default: 'null', description: 'Seed canvas with existing signature to re-edit.' },
    ],
    outputs: [
      { name: 'saved', type: 'EventEmitter<string>', description: 'Emits trimmed transparent PNG data URL (black ink).' },
      { name: 'cancelled', type: 'EventEmitter<void>', description: 'Emits when user clicks Cancel, Close, or clicks outside.' },
    ],
    guidance: [
      'MUST be conditionally mounted via @if (showPad) so it does not trap the screen on initial render.',
      'Always bind both (saved) and (cancelled) handlers.'
    ],
    recipes: [
      {
        title: 'On-Demand Consent Capture with Preview',
        scenario: 'Trigger drawing pad from a secondary button, and preview the transparent trimmed PNG once saved.',
        templateSnippet: `<!-- Trigger Button -->
<pf-button variant="secondary" (click)="showSignPad = true">
  Capture Patient Signature
</pf-button>

<!-- Conditional Modal -->
@if (showSignPad) {
  <pf-signature-pad
    (saved)="onSignatureSaved($event)"
    (cancelled)="showSignPad = false" />
}`,
        tsSnippet: `onSignatureSaved(pngDataUrl: string): void {
  this.signatureUrl = pngDataUrl;
  this.showSignPad = false;
}`
      }
    ]
  },
  {
    id: 'barcode-scanner-modal',
    name: 'Barcode Scanner Modal',
    selector: 'pf-barcode-scanner-modal',
    category: 'Data Entry',
    summary: 'Camera and keyboard barcode scanner modal with manual numpad fallback for clinical scanning.',
    importStatement: "import { BarcodeScannerModalComponent } from '@prefrontal/shared';",
    templateSnippet: `@if (showScanner) {
  <pf-barcode-scanner-modal
    noun="sample tube"
    (matched)="onBarcodeScanned($event)"
    (cancelled)="showScanner = false" />
}`,
    inputs: [
      { name: 'title', type: 'string', required: false, default: "'Scan barcode'", description: 'Modal header title.' },
      { name: 'noun', type: 'string', required: false, default: "'specimen ID'", description: 'Entity noun shown in hints.' },
      { name: 'manualOnly', type: 'boolean', required: false, default: 'false', description: 'Hides camera and shows numpad directly.' },
    ],
    outputs: [
      { name: 'matched', type: 'EventEmitter<string>', description: 'Emits captured barcode string.' },
      { name: 'cancelled', type: 'EventEmitter<void>', description: 'Emits when dismissed.' },
    ],
  },
  {
    id: 'image-editor',
    name: 'Image Editor',
    selector: 'pf-image-editor',
    category: 'Data Entry',
    summary: 'Modal canvas for cropping and resizing patient profile photos or scanned document attachments.',
    importStatement: "import { ImageEditorComponent } from '@prefrontal/shared';",
    templateSnippet: `@if (showEditor && file) {
  <pf-image-editor
    [file]="file"
    (applied)="onCropped($event)"
    (cancelled)="showEditor = false" />
}`,
    inputs: [
      { name: 'file', type: 'File', required: true, description: 'Raster File object picked by user (PNG/JPEG).' },
      { name: 'aspectRatio', type: 'number | null', required: false, default: 'null', description: 'Locked aspect ratio (e.g. 1 for square avatar).' },
      { name: 'maxWidth', type: 'number', required: false, default: '1200', description: 'Maximum output width in pixels.' },
    ],
    outputs: [
      { name: 'applied', type: 'EventEmitter<Blob>', description: 'Emits cropped image Blob ready for upload.' },
      { name: 'cancelled', type: 'EventEmitter<void>', description: 'Emits when user cancels.' },
    ],
  },

  // ── Data Display ─────────────────────────────────────────────────────────
  {
    id: 'avatar',
    name: 'Avatar',
    selector: 'pf-avatar',
    category: 'Data Display',
    summary: 'User and patient circular avatar with initials fallback and presence indicator.',
    importStatement: "import { AvatarComponent } from '@prefrontal/shared';",
    templateSnippet: `<pf-avatar name="Dr. Priya Nair" [size]="40" status="online" />`,
    inputs: [
      { name: 'name', type: 'string', required: false, description: 'Full name for automatic initials fallback.' },
      { name: 'src', type: 'string', required: false, description: 'Image URL for photo avatar.' },
      { name: 'size', type: 'number', required: false, default: '32', description: 'Pixel diameter.' },
      { name: 'status', type: "'online' | 'busy' | 'offline'", required: false, description: 'Presence dot status.' },
    ],
    outputs: [],
  },
  {
    id: 'chip',
    name: 'Chip',
    selector: 'pf-chip',
    category: 'Data Display',
    summary: 'Compact tag with selectable state and optional removal button.',
    importStatement: "import { ChipComponent } from '@prefrontal/shared';",
    templateSnippet: `<pf-chip tone="violet" [selected]="isSelected">Outpatient</pf-chip>`,
    inputs: [
      { name: 'tone', type: "'default' | 'violet' | 'pink' | 'emerald' | 'amber' | 'rose' | 'sky' | 'mint' | 'teal'", required: false, default: "'default'", description: 'Color styling for unselected chip.' },
      { name: 'size', type: "'sm' | 'md'", required: false, default: "'md'", description: 'Chip dimensions (height: 32px sm, 40px md).' },
      { name: 'selected', type: 'boolean', required: false, default: 'false', description: 'Selected active state.' },
      { name: 'disabled', type: 'boolean', required: false, default: 'false', description: 'Disables tap response.' },
    ],
    outputs: [
      { name: 'tapped', type: 'EventEmitter<MouseEvent>', description: 'Fires when chip button is clicked or tapped.' },
    ],
  },
  {
    id: 'status-chip',
    name: 'Status Chip',
    selector: 'pf-status-chip',
    category: 'Data Display',
    summary: 'Standardized Prefrontal status pill with glowing dot indicator.',
    importStatement: "import { PfStatusChipComponent } from '@prefrontal/shared';",
    templateSnippet: `<pf-status-chip tone="urgent">Urgent</pf-status-chip>`,
    inputs: [
      { name: 'tone', type: "'neutral' | 'violet' | 'urgent' | 'required'", required: true, description: 'Semantic status tone: violet (active/ready), neutral (draft), urgent (critical/STAT), required (dot).' },
    ],
    outputs: [],
  },
  {
    id: 'clock',
    name: 'Live Clock',
    selector: 'pf-clock',
    category: 'Data Display',
    summary: 'Real-time digital clock display with tabular numbers for status strips and headers.',
    importStatement: "import { ClockComponent } from '@prefrontal/shared';",
    templateSnippet: `<pf-clock variant="tile" size="md" />`,
    inputs: [
      { name: 'variant', type: "'tile' | 'bare'", required: false, default: "'tile'", description: 'Glass panel tile with icon or ambient bare text.' },
      { name: 'size', type: "'sm' | 'md' | 'lg'", required: false, default: "'md'", description: 'Clock scale size.' },
    ],
    outputs: [],
  },
  {
    id: 'tile',
    name: 'Metric Tile',
    selector: 'pf-tile',
    category: 'Data Display',
    summary: 'Compact card container for key performance metrics, counts, and financial stats.',
    importStatement: "import { TileComponent } from '@prefrontal/shared';",
    templateSnippet: `<pf-tile [clickable]="true" (tapped)="openDetails()">
  <span class="text-xs text-[var(--text-tertiary)]">Samples Collected</span>
  <strong class="text-xl font-bold pf-num">142</strong>
</pf-tile>`,
    inputs: [
      { name: 'tone', type: "'default' | 'elevated' | 'muted'", required: false, default: "'default'", description: 'Surface elevation depth.' },
      { name: 'clickable', type: 'boolean', required: false, default: 'false', description: 'Adds hover elevation and cursor pointer.' },
    ],
    outputs: [
      { name: 'tapped', type: 'EventEmitter<Event>', description: 'Fires when tile is clicked or tapped.' },
    ],
  },
  {
    id: 'barcode-display',
    name: 'Barcode & QR Display',
    selector: 'pf-barcode-display',
    category: 'Data Display',
    summary: 'Renders Code128 barcodes and QR codes from IDs for wristbands and labels.',
    importStatement: "import { BarcodeDisplayComponent } from '@prefrontal/shared';",
    templateSnippet: `<pf-barcode-display code="PF-2026-9901" mode="both" [showValue]="true" />`,
    inputs: [
      { name: 'code', type: 'string', required: true, description: 'Code string to encode (MRN, specimen accession ID).' },
      { name: 'mode', type: "'barcode' | 'qr' | 'both'", required: false, default: "'barcode'", description: 'Symbology mode.' },
      { name: 'showValue', type: 'boolean', required: false, default: 'true', description: 'Shows human-readable code text below.' },
      { name: 'height', type: 'number', required: false, default: '40', description: 'Height of 1D barcode in pixels.' },
    ],
    outputs: [],
  },

  // ── Feedback ─────────────────────────────────────────────────────────────
  {
    id: 'confirm-dialog',
    name: 'Confirm Dialog',
    selector: 'pf-confirm-dialog',
    category: 'Feedback',
    summary: 'Modal dialog for destructive or critical confirmations with keyboard escape and focus trap.',
    importStatement: "import { ConfirmDialogComponent } from '@prefrontal/shared';",
    templateSnippet: `<pf-confirm-dialog
  [open]="isConfirmOpen"
  title="Discard Unsaved Changes?"
  message="All entered sample edits will be permanently lost."
  confirmLabel="Discard"
  tone="danger"
  (confirm)="onDiscard()"
  (cancel)="isConfirmOpen = false" />`,
    inputs: [
      { name: 'open', type: 'boolean', required: true, description: 'Controls visibility of modal.' },
      { name: 'title', type: 'string', required: false, default: "'Confirm'", description: 'Modal header title.' },
      { name: 'message', type: 'string', required: false, description: 'Descriptive warning explanation.' },
      { name: 'confirmLabel', type: 'string', required: false, default: "'Confirm'", description: 'Confirm action button label.' },
      { name: 'cancelLabel', type: 'string', required: false, default: "'Cancel'", description: 'Cancel button label.' },
      { name: 'tone', type: "'primary' | 'danger'", required: false, default: "'primary'", description: 'Color tone of confirmation CTA.' },
    ],
    outputs: [
      { name: 'confirm', type: 'EventEmitter<void>', description: 'Fires when user accepts dialog.' },
      { name: 'cancel', type: 'EventEmitter<void>', description: 'Fires when dismissed or canceled.' },
    ],
  },
  {
    id: 'skeleton',
    name: 'Skeleton Kit',
    selector: 'pf-skeleton',
    category: 'Feedback',
    summary: 'The ONLY loading look across Prefrontal apps. Includes shapes, list rows, and table skeletons.',
    importStatement: "import { SkeletonComponent, SkeletonRowsComponent, SkeletonTableComponent, BusyComponent } from '@prefrontal/shared';",
    templateSnippet: `<pf-skeleton-rows [rows]="4" />
<pf-skeleton-table [rows]="3" [cols]="4" />
<pf-busy label="Saving specimen" />`,
    inputs: [
      { name: 'variant', type: "'line' | 'rect' | 'circle' | 'pill'", required: false, default: "'line'", description: 'Primitive skeleton shape.' },
      { name: 'width', type: 'string', required: false, description: 'CSS width override (e.g. "12rem").' },
      { name: 'height', type: 'string', required: false, description: 'CSS height override.' },
      { name: 'rows', type: 'number', required: false, default: '3', description: 'Number of rows for pf-skeleton-rows / pf-skeleton-table.' },
      { name: 'cols', type: 'number', required: false, default: '3', description: 'Number of columns for pf-skeleton-table.' },
    ],
    outputs: [],
    guidance: [
      'Every skeleton preset mirrors the geometry of the target content to prevent layout shifts.',
      'Accessibility: Includes role="status" and aria-busy="true".'
    ]
  },
  {
    id: 'busy-directive',
    name: 'Busy Directive',
    selector: '[pfBusy]',
    category: 'Feedback',
    summary: 'The ONE busy state for action buttons. Swallows double-clicks and appends animated dots after delay.',
    importStatement: "import { BusyDirective } from '@prefrontal/shared';",
    templateSnippet: `<button class="pf-btn pf-btn--primary" [pfBusy]="saving()" (click)="save()">
  {{ saving() ? 'Saving…' : 'Save Specimen' }}
</button>`,
    inputs: [
      { name: 'pfBusy', type: 'boolean', required: true, description: 'Signals running async request. Swallows repeated clicks.' },
    ],
    outputs: [],
    guidance: [
      'Appends pf-busy dots after 150ms delay to prevent flickering on fast network responses.',
      'Held visible for minimum 400ms once shown.'
    ]
  },

  // ── Utilities ────────────────────────────────────────────────────────────
  {
    id: 'currency-inr',
    name: 'Currency INR Pipe',
    selector: '| inr',
    category: 'Utilities',
    summary: 'Angular pipe formatting numbers into Indian Rupee currency format (₹) with en-IN numbering.',
    importStatement: "import { CurrencyInrPipe } from '@prefrontal/shared';",
    templateSnippet: `<span>{{ 15840.50 | inr }}</span> <!-- Outputs: ₹15,840.50 -->`,
    inputs: [],
    outputs: [],
  },
  {
    id: 'input-directives',
    name: 'Mask Directives',
    selector: '[pfNumeric] / [pfAlpha]',
    category: 'Utilities',
    summary: 'Enforces numeric, uppercase, or alphanumeric restrictions on keyboard and paste events.',
    importStatement: "import { NumericDirective, AlphaDirective } from '@prefrontal/shared';",
    templateSnippet: `<input pfInput pfNumeric [allowDecimal]="false" placeholder="Digits only" />
<input pfInput pfAlpha [uppercase]="true" placeholder="UPPERCASE ALPHANUMERIC" />`,
    inputs: [
      { name: 'allowDecimal', type: 'boolean', required: false, default: 'false', description: 'Allows single "." decimal character in [pfNumeric].' },
      { name: 'maxDigits', type: 'number', required: false, description: 'Limits maximum digit count in [pfNumeric].' },
      { name: 'allowNumbers', type: 'boolean', required: false, default: 'false', description: 'Allows alphanumeric characters in [pfAlpha].' },
    ],
    outputs: [],
  },

  // ── Theme & Tokens ───────────────────────────────────────────────────────
  {
    id: 'theme-tokens',
    name: 'Theme & Tokens',
    selector: 'Design Tokens',
    category: 'Theme & Tokens',
    summary: 'Prefrontal core color palette, semantic variables for light and dark modes, and typography tokens.',
    importStatement: "@import '@prefrontal/shared/styles/pf-theme';",
    templateSnippet: `:root {
  --color-primary: #7c3aed;
  --bg-primary: #0a0a15;
  --bg-card: #131325;
}`,
    inputs: [],
    outputs: [],
    guidance: [
      'Primary palette is Violet (#7c3aed to #c026d3) with neutral slate surfaces.',
      'Single font throughout: Noto Sans with tabular numbers (.pf-num) for codes, dates, and money.'
    ]
  }
];

export const CATEGORY_GROUPS: CategoryGroup[] = [
  {
    name: 'General',
    id: 'general',
    description: 'Essential buttons, touch targets, branding, and status icons.',
    components: CATALOG_COMPONENTS.filter((c) => c.category === 'General'),
  },
  {
    name: 'Layout',
    id: 'layout',
    description: 'Surfaces, card hierarchy, and ambient background lighting.',
    components: CATALOG_COMPONENTS.filter((c) => c.category === 'Layout'),
  },
  {
    name: 'Navigation',
    id: 'navigation',
    description: 'Contextual actions, popovers, and mobile bottom drawers.',
    components: CATALOG_COMPONENTS.filter((c) => c.category === 'Navigation'),
  },
  {
    name: 'Data Entry',
    id: 'data-entry',
    description: 'Form controls, pickers, touch keypads, and capture modals.',
    components: CATALOG_COMPONENTS.filter((c) => c.category === 'Data Entry'),
  },
  {
    name: 'Data Display',
    id: 'data-display',
    description: 'Avatars, chips, metrics, live clocks, and barcodes.',
    components: CATALOG_COMPONENTS.filter((c) => c.category === 'Data Display'),
  },
  {
    name: 'Feedback',
    id: 'feedback',
    description: 'Confirmation dialogs, skeleton loaders, and busy states.',
    components: CATALOG_COMPONENTS.filter((c) => c.category === 'Feedback'),
  },
  {
    name: 'Utilities',
    id: 'utilities',
    description: 'Input masks, currency pipes, and async helpers.',
    components: CATALOG_COMPONENTS.filter((c) => c.category === 'Utilities'),
  },
  {
    name: 'Theme & Tokens',
    id: 'theme',
    description: 'Palette tokens, semantic variables, and typography rules.',
    components: CATALOG_COMPONENTS.filter((c) => c.category === 'Theme & Tokens'),
  },
];
