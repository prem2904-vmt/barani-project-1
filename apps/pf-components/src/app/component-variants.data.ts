export interface ComponentVariantDoc {
  name: string;
  label: string;
  description: string;
  propName?: string;
  snippet: string;
  isDefault?: boolean;
}

export const COMPONENT_VARIANTS: Record<string, ComponentVariantDoc[]> = {
  button: [
    {
      name: 'primary',
      label: 'Primary CTA',
      description: 'Vibrant violet-to-pink brand gradient. Strictly reserved for the single main CTA on the view.',
      snippet: '<pf-button variant="primary">Confirm Order</pf-button>',
    },
    {
      name: 'secondary',
      label: 'Secondary Outline',
      description: 'Standard outline button for secondary actions like Save as Draft, Back, or Cancel.',
      isDefault: true,
      snippet: '<pf-button variant="secondary">Save as Draft</pf-button>',
    },
    {
      name: 'tertiary',
      label: 'Tertiary Action',
      description: 'Bordered subtle action for auxiliary actions without competing with the primary CTA.',
      snippet: '<pf-button variant="tertiary">View Details</pf-button>',
    },
    {
      name: 'danger',
      label: 'Danger / Destructive',
      description: 'Muted red outline for destructive irreversible actions such as Discard Draft or Delete Test.',
      snippet: '<pf-button variant="danger">Discard Draft</pf-button>',
    },
    {
      name: 'quiet',
      label: 'Quiet Frameless',
      description: 'Frameless neutral button with no border or fill until hovered. Ideal for card headers and toolbars.',
      snippet: '<pf-button variant="quiet">Dismiss</pf-button>',
    },
    {
      name: 'icon',
      label: 'Icon Square',
      description: 'Compact 44px square button for barcode scanning and quick icon tools.',
      snippet: '<pf-button variant="icon"><pf-scan-icon [size]="18" /></pf-button>',
    },
  ],

  'touch-button': [
    {
      name: 'primary',
      label: 'Primary Touch',
      description: 'Vibrant gradient touch CTA (min 44px) for phlebotomy desks and touch kiosks.',
      isDefault: true,
      snippet: '<pf-touch-btn variant="primary">Collect Specimen</pf-touch-btn>',
    },
    {
      name: 'secondary',
      label: 'Secondary Touch',
      description: 'Standard tactile button for secondary workflow actions like Print Tube Label.',
      snippet: '<pf-touch-btn variant="secondary">Print Tube Label</pf-touch-btn>',
    },
    {
      name: 'ghost',
      label: 'Ghost Touch',
      description: 'Subtle bordered touch button for optional or alternative workflow branches.',
      snippet: '<pf-touch-btn variant="ghost">Skip Tube</pf-touch-btn>',
    },
    {
      name: 'accent',
      label: 'Accent Touch',
      description: 'Violet accent touch button for positive intermediate actions like Accession Sample.',
      snippet: '<pf-touch-btn variant="accent">Accession Sample</pf-touch-btn>',
    },
    {
      name: 'danger',
      label: 'Danger Touch',
      description: 'Emergency stop or sample rejection tactile button with red outline and haptic feedback.',
      snippet: '<pf-touch-btn variant="danger">Reject Specimen</pf-touch-btn>',
    },
    {
      name: 'success',
      label: 'Success Touch',
      description: 'Green completion button for final clinical verification and signing off reports.',
      snippet: '<pf-touch-btn variant="success">Verify & Sign</pf-touch-btn>',
    },
  ],

  'logo-mark': [
    {
      name: 'badge',
      label: 'Badge Pill',
      description: 'Canonical logo glyph on signature violet-to-pink gradient pill with soft ambient glow.',
      isDefault: true,
      snippet: "<pf-logo-mark variant=\"badge\" [size]=\"'md'\" />",
    },
    {
      name: 'glyph',
      label: 'Bare Glyph',
      description: 'Standalone gradient brain vector glyph without background pill.',
      snippet: "<pf-logo-mark variant=\"glyph\" [size]=\"'md'\" />",
    },
    {
      name: 'mono',
      label: 'Mono Line',
      description: 'Monochromatic stroke mark adapting to parent currentColor for dense toolbars and print exports.',
      snippet: "<pf-logo-mark variant=\"mono\" [size]=\"'md'\" />",
    },
  ],

  'status-chip': [
    {
      name: 'urgent',
      label: 'Urgent (Critical / STAT)',
      propName: 'tone',
      description: 'Red glowing dot indicator for STAT emergency panic values and overdue turnaround times.',
      isDefault: true,
      snippet: '<pf-status-chip tone="urgent">STAT URGENT</pf-status-chip>',
    },
    {
      name: 'violet',
      label: 'Violet (Active / Ready)',
      propName: 'tone',
      description: 'Active violet tone for specimens ready for accession, analyzer runs, or doctor sign-off.',
      snippet: '<pf-status-chip tone="violet">READY FOR ACCESSION</pf-status-chip>',
    },
    {
      name: 'neutral',
      label: 'Neutral (Draft)',
      propName: 'tone',
      description: 'Muted slate tone for draft orders, pending steps, or archived records.',
      snippet: '<pf-status-chip tone="neutral">DRAFT ORDER</pf-status-chip>',
    },
    {
      name: 'required',
      label: 'Required (Mandatory)',
      propName: 'tone',
      description: 'Amber warning tone indicating required collection or missing accession data.',
      snippet: '<pf-status-chip tone="required">SAMPLE REQUIRED</pf-status-chip>',
    },
  ],

  chip: [
    {
      name: 'default',
      label: 'Default Neutral',
      propName: 'tone',
      description: 'Standard neutral filter chip for general clinical filtering.',
      isDefault: true,
      snippet: '<pf-chip tone="default">Routine</pf-chip>',
    },
    {
      name: 'violet',
      label: 'Brand Violet',
      propName: 'tone',
      description: 'Brand violet tone for active selected filters or primary tags.',
      snippet: '<pf-chip tone="violet">Outpatient (OPD)</pf-chip>',
    },
    {
      name: 'emerald',
      label: 'Emerald Normal',
      propName: 'tone',
      description: 'Green tone for normal reference ranges or completed results.',
      snippet: '<pf-chip tone="emerald">Normal Range</pf-chip>',
    },
    {
      name: 'amber',
      label: 'Amber Review',
      propName: 'tone',
      description: 'Amber tone for pending or review-required tags.',
      snippet: '<pf-chip tone="amber">Pending Validation</pf-chip>',
    },
    {
      name: 'rose',
      label: 'Rose Emergency',
      propName: 'tone',
      description: 'Rose tone for emergency or STAT tags.',
      snippet: '<pf-chip tone="rose">Emergency STAT</pf-chip>',
    },
    {
      name: 'sky',
      label: 'Sky Inpatient',
      propName: 'tone',
      description: 'Sky blue tone for inpatient / ward filters.',
      snippet: '<pf-chip tone="sky">ICU Bed 04</pf-chip>',
    },
  ],

  clock: [
    {
      name: 'tile',
      label: 'Tile Glass',
      description: 'Frosted glass container with clock SVG icon and tabular live time.',
      isDefault: true,
      snippet: '<pf-clock variant="tile" size="md" />',
    },
    {
      name: 'bare',
      label: 'Bare Ambient',
      description: 'Minimalist ambient tabular digital clock without background container.',
      snippet: '<pf-clock variant="bare" size="md" />',
    },
  ],

  tile: [
    {
      name: 'default',
      label: 'Default Surface',
      propName: 'tone',
      description: 'Clean baseline metric tile with subtle slate border.',
      isDefault: true,
      snippet: '<pf-tile [clickable]="true"><span>Samples Collected</span><strong>142</strong></pf-tile>',
    },
    {
      name: 'elevated',
      label: 'Elevated Surface',
      propName: 'tone',
      description: 'Elevated card surface with shadow for clickable interactive metric tiles.',
      snippet: '<pf-tile tone="elevated" [clickable]="true"><span>STAT Urgency</span><strong>3</strong></pf-tile>',
    },
    {
      name: 'muted',
      label: 'Muted Subtle',
      propName: 'tone',
      description: 'Subtle muted background tile for secondary stats.',
      snippet: '<pf-tile tone="muted"><span>Archived Runs</span><strong>8</strong></pf-tile>',
    },
  ],

  'barcode-display': [
    {
      name: 'both',
      label: 'Both (1D + QR)',
      propName: 'mode',
      description: 'Combined Code128 barcode and 2D QR matrix for dual clinical scanners.',
      isDefault: true,
      snippet: '<pf-barcode-display code="PF-2026-9901" mode="both" [showValue]="true" />',
    },
    {
      name: 'barcode',
      label: 'Linear 1D Barcode',
      propName: 'mode',
      description: 'Code128 linear barcode only for standard tube label printers.',
      snippet: '<pf-barcode-display code="PF-2026-9901" mode="barcode" [showValue]="true" />',
    },
    {
      name: 'qr',
      label: '2D QR Matrix',
      propName: 'mode',
      description: '2D QR matrix code only for high-density patient wristbands.',
      snippet: '<pf-barcode-display code="PF-2026-9901" mode="qr" [showValue]="true" />',
    },
  ],

  'confirm-dialog': [
    {
      name: 'primary',
      label: 'Primary Confirmation',
      propName: 'tone',
      description: 'Standard action confirmation modal with brand CTA (e.g. Save Order).',
      isDefault: true,
      snippet: '<pf-confirm-dialog [open]="true" tone="primary" title="Confirm" />',
    },
    {
      name: 'danger',
      label: 'Destructive Confirmation',
      propName: 'tone',
      description: 'Destructive confirmation modal with red danger CTA (e.g. Discard Draft).',
      snippet: '<pf-confirm-dialog [open]="true" tone="danger" title="Discard Unsaved Changes?" />',
    },
  ],

  skeleton: [
    {
      name: 'line',
      label: 'Line Shimmer',
      description: 'Text or label single-line placeholder with gentle shimmer.',
      isDefault: true,
      snippet: "<pf-skeleton variant=\"line\" [width]=\"'12rem'\" />",
    },
    {
      name: 'block',
      label: 'Block Area',
      description: 'Card, image, or block rectangular placeholder.',
      snippet: "<pf-skeleton variant=\"block\" [width]=\"'100%'\" [height]=\"'4rem'\" />",
    },
    {
      name: 'circle',
      label: 'Circular Avatar',
      description: 'Avatar or round indicator placeholder.',
      snippet: "<pf-skeleton variant=\"circle\" [width]=\"'40px'\" [height]=\"'40px'\" />",
    },
    {
      name: 'pill',
      label: 'Pill Chip',
      description: 'Status badge or chip pill placeholder.',
      snippet: "<pf-skeleton variant=\"pill\" [width]=\"'6rem'\" [height]=\"'1.75rem'\" />",
    },
  ],

  'price-flag': [
    {
      name: 'not-offered',
      label: 'Not Offered Here',
      propName: 'kind',
      description: 'Quiet neutral tag indicating tests not offered by a specific satellite branch.',
      isDefault: true,
      snippet: '<pf-price-flag kind="not-offered" />',
    },
    {
      name: 'inactive',
      label: 'Inactive in Master',
      propName: 'kind',
      description: 'Quiet neutral tag indicating disabled / discontinued tests.',
      snippet: '<pf-price-flag kind="inactive" />',
    },
  ],

  'origin-badge': [
    {
      name: 'master',
      label: 'Master Catalog',
      propName: 'origin',
      description: 'Core central laboratory test master source pill.',
      isDefault: true,
      snippet: '<pf-origin-badge origin="master" />',
    },
    {
      name: 'clone',
      label: 'Cloned Item',
      propName: 'origin',
      description: 'Cloned master test tariff item.',
      snippet: '<pf-origin-badge origin="clone" />',
    },
    {
      name: 'own',
      label: 'Tenant Own',
      propName: 'origin',
      description: 'Tenant-customized proprietary test definition.',
      snippet: '<pf-origin-badge origin="own" />',
    },
    {
      name: 'branch',
      label: 'Branch Override',
      propName: 'origin',
      description: 'Branch-specific test pricing override.',
      snippet: '<pf-origin-badge origin="branch" />',
    },
  ],
};
