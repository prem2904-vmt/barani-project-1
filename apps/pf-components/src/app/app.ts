import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  signal,
} from '@angular/core';
import { UpperCasePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  ActionsMenuComponent,
  AmbientBgComponent,
  AvatarComponent,
  BarcodeDisplayComponent,
  BarcodeScannerModalComponent,
  BusyComponent,
  ChipComponent,
  ClockComponent,
  ConfirmDialogComponent,
  DailyNoComponent,
  HeroBandComponent,
  OriginBadgeComponent,
  ScreenHeaderComponent,
  TatIndicatorComponent,
  CurrencyInrPipe,
  ImageEditorComponent,
  LoadingLogoComponent,
  LogoMarkComponent,
  NumberInputComponent,
  NumPadComponent,
  PfButtonComponent,
  PfCardBodyComponent,
  PfCardComponent,
  PfCardFooterComponent,
  PfCardHeaderComponent,
  PfCalendarComponent,
  PfDateComponent,
  PfDateTimeComponent,
  PfInputDirective,
  PinDotsComponent,
  PfSelectOption,
  SegmentedOption,
  PfSegmentedComponent,
  PfStatusChipComponent,
  PfTimeComponent,
  ScanIconComponent,
  SelectComponent,
  SignaturePadComponent,
  SkeletonComponent,
  SkeletonRowsComponent,
  SkeletonTableComponent,
  ToggleComponent,
  TileComponent,
  TouchButtonComponent,
  AlphaDirective,
  BusyDirective,
  NumericDirective,
} from '@prefrontal/shared';
import {
  CATALOG_COMPONENTS,
  CATEGORY_GROUPS,
  ComponentDoc,
  CategoryGroup,
} from './component-catalog.data';
import {
  CLINICAL_COMPOSITIONS,
  CLINICAL_TUBE_CAPS,
  TOKEN_PALETTE,
  ClinicalComposition,
  TubeCapColor,
} from './cookbook-recipes.data';

@Component({
  selector: 'pf-root',
  standalone: true,
  imports: [
    ActionsMenuComponent,
    AmbientBgComponent,
    AvatarComponent,
    BarcodeDisplayComponent,
    BarcodeScannerModalComponent,
    BusyComponent,
    ChipComponent,
    ClockComponent,
    ConfirmDialogComponent,
    DailyNoComponent,
    HeroBandComponent,
    OriginBadgeComponent,
    ScreenHeaderComponent,
    TatIndicatorComponent,
    CurrencyInrPipe,
    ImageEditorComponent,
    LoadingLogoComponent,
    LogoMarkComponent,
    NumberInputComponent,
    NumPadComponent,
    PfButtonComponent,
    PfCardBodyComponent,
    PfCardComponent,
    PfCardFooterComponent,
    PfCardHeaderComponent,
    PfCalendarComponent,
    PfDateComponent,
    PfDateTimeComponent,
    PfInputDirective,
    PinDotsComponent,
    PfSegmentedComponent,
    PfStatusChipComponent,
    PfTimeComponent,
    ScanIconComponent,
    SelectComponent,
    SignaturePadComponent,
    TileComponent,
    SkeletonComponent,
    SkeletonRowsComponent,
    SkeletonTableComponent,
    ToggleComponent,
    TouchButtonComponent,
    AlphaDirective,
    BusyDirective,
    NumericDirective,
    FormsModule,
    UpperCasePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App implements OnInit {
  // ── Global Section & View State ───────────────────────────────────────────
  protected readonly activeSection = signal<'cookbook' | 'compositions' | 'tokens' | 'principles'>('cookbook');
  protected readonly selectedComponentId = signal<string>('overview');
  protected readonly searchQuery = signal('');
  protected readonly isDarkMode = signal(true);
  protected readonly copiedSnippet = signal<string | null>(null);
  protected statusMessage = 'Prefrontal UI Cookbook ready.';

  // ── Datasets ─────────────────────────────────────────────────────────────
  protected readonly allComponents = CATALOG_COMPONENTS;
  protected readonly categoryGroups = CATEGORY_GROUPS;
  protected readonly clinicalCompositions: ClinicalComposition[] = CLINICAL_COMPOSITIONS;
  protected readonly clinicalTubeCaps: TubeCapColor[] = CLINICAL_TUBE_CAPS;
  protected readonly tokenPalette = TOKEN_PALETTE;

  // Selected Clinical Composition
  protected readonly activeCompositionId = signal<string>('order-create');
  protected readonly currentComposition = computed(() => {
    return this.clinicalCompositions.find((c) => c.id === this.activeCompositionId()) || this.clinicalCompositions[0];
  });

  // Active Component Computed
  protected readonly currentComponent = computed<ComponentDoc | null>(() => {
    const id = this.selectedComponentId();
    if (id === 'overview') return null;
    return this.allComponents.find((c) => c.id === id) || null;
  });

  // Filtered Categories
  protected readonly filteredCategories = computed<CategoryGroup[]>(() => {
    const q = this.searchQuery().toLowerCase().trim();
    if (!q) return this.categoryGroups;

    return this.categoryGroups
      .map((cat) => ({
        ...cat,
        components: cat.components.filter(
          (c) =>
            c.name.toLowerCase().includes(q) ||
            c.selector.toLowerCase().includes(q) ||
            c.category.toLowerCase().includes(q) ||
            c.summary.toLowerCase().includes(q)
        ),
      }))
      .filter((cat) => cat.components.length > 0);
  });

  // ── Interactive Playground Controls State ────────────────────────────────
  protected readonly btnVariant = signal<'primary' | 'secondary' | 'danger' | 'quiet'>('primary');
  protected readonly btnFullWidth = signal(false);
  protected readonly btnDisabled = signal(false);

  protected readonly touchVariant = signal<'primary' | 'secondary' | 'accent' | 'danger'>('primary');
  protected readonly touchBusy = signal(false);
  protected readonly touchDisabled = signal(false);

  protected readonly chipTone = signal<'default' | 'violet' | 'pink' | 'emerald' | 'amber' | 'rose'>('violet');
  protected readonly chipSelected = signal(true);

  protected readonly clockVariant = signal<'tile' | 'bare'>('tile');
  protected readonly clockSize = signal<'sm' | 'md' | 'lg'>('md');

  protected readonly barcodeMode = signal<'barcode' | 'qr' | 'both'>('both');
  protected readonly barcodeCode = signal('PF-2026-9901');


  // ── New Clinical Components State ───────────────────────────────────────
  protected readonly heroTenantName = signal('Micro World');
  protected readonly heroSearchVal = signal('');
  protected readonly tatMinutes = signal(15);
  protected readonly dailyNoVal = signal(12);
  protected readonly originKind = signal<string>('master');
  protected readonly statusChipTone = signal<'neutral' | 'violet' | 'urgent' | 'required'>('urgent');

  // Input states
  protected dateValue: string | null = '2026-10-10';
  protected timeValue: string | null = '09:30';
  protected dateTimeValue: string | null = '2026-10-10T09:30';
  protected selectValue = 'opd';
  protected segmentValue = 'overview';
  protected numberValue: number | null = 1250;
  protected numPadValue = '12';
  protected toggleValue = true;
  protected lastPinEntered = signal<string | null>(null);

  // Modals state (All strictly false initially)
  protected showConfirm = false;
  protected showScanner = false;
  protected showImageEditor = false;
  protected showSignaturePad = false;
  protected signatureDataUrl: string | null = null;
  protected scannedBarcode: string | null = null;
  protected imageFile: File | null = null;
  protected lastConfirmResult: string | null = null;

  // Event activity log
  protected readonly eventLogs = signal<string[]>([
    'Cookbook playground initialized. Click controls to inspect reactions.',
  ]);

  // Static options
  protected readonly options: PfSelectOption[] = [
    { value: 'opd', label: 'Outpatient (OPD)' },
    { value: 'ipd', label: 'Inpatient (IPD)' },
    { value: 'pharmacy', label: 'Pharmacy Dispensing', hint: 'Prescription & medicines' },
  ];

  protected readonly segments: SegmentedOption[] = [
    { value: 'overview', label: 'Overview' },
    { value: 'activity', label: 'Activity', count: 4 },
    { value: 'disabled', label: 'Disabled', disabled: true },
  ];

  protected readonly menuActions = [
    { id: 'open', label: 'Open patient file', icon: 'view' as const, group: 'Record' },
    { id: 'share', label: 'Copy medical link', icon: 'link' as const, group: 'Share', hint: 'Secure share link' },
  ];

  ngOnInit(): void {
    if (typeof document !== 'undefined') {
      document.documentElement.classList.add('dark');
      document.documentElement.setAttribute('data-theme', 'dark');
    }
  }

  // ── Actions & Methods ────────────────────────────────────────────────────
  protected logEvent(message: string): void {
    this.statusMessage = message;
    this.eventLogs.update((prev: string[]) => [
      `[${new Date().toLocaleTimeString()}] ${message}`,
      ...prev.slice(0, 4),
    ]);
  }

  protected switchSection(section: 'cookbook' | 'compositions' | 'tokens' | 'principles'): void {
    this.activeSection.set(section);
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  protected selectComponent(id: string): void {
    this.selectedComponentId.set(id);
    this.activeSection.set('cookbook');
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  protected selectOverview(): void {
    this.selectedComponentId.set('overview');
    this.activeSection.set('cookbook');
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  protected toggleTheme(): void {
    const next = !this.isDarkMode();
    this.isDarkMode.set(next);
    if (typeof document !== 'undefined') {
      if (next) {
        document.documentElement.classList.add('dark');
        document.documentElement.classList.remove('light');
        document.documentElement.setAttribute('data-theme', 'dark');
      } else {
        document.documentElement.classList.remove('dark');
        document.documentElement.classList.add('light');
        document.documentElement.setAttribute('data-theme', 'light');
      }
    }
    this.logEvent(`Switched theme to ${next ? 'Dark' : 'Light'}`);
  }

  protected copySnippet(text: string): void {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => {
        this.copiedSnippet.set(text);
        this.logEvent('Code snippet copied to clipboard');
        setTimeout(() => this.copiedSnippet.set(null), 2500);
      });
    } else {
      this.logEvent('Clipboard unavailable');
    }
  }

  protected onPin(pin: string): void {
    this.lastPinEntered.set(pin);
    this.logEvent(`(completed) fired with PIN: ${pin}`);
  }

  protected onScan(value: string): void {
    this.scannedBarcode = value;
    this.showScanner = false;
    this.logEvent(`(matched) barcode received: ${value}`);
  }

  protected confirmAction(): void {
    this.showConfirm = false;
    this.lastConfirmResult = 'Confirmed';
    this.logEvent(`(confirm) action confirmed by clinician`);
  }

  protected onSignatureSaved(url: string): void {
    this.signatureDataUrl = url;
    this.showSignaturePad = false;
    this.logEvent(`(saved) transparent signature captured (${url.length} chars)`);
  }

  protected onSignatureCleared(): void {
    this.signatureDataUrl = null;
    this.logEvent('Stored signature cleared');
  }

  protected handleAction(id: string): void {
    this.logEvent(`ActionsMenu action triggered: ${id}`);
  }

  protected triggerSampleImageEdit(): void {
    const canvas = document.createElement('canvas');
    canvas.width = 300;
    canvas.height = 200;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#7c3aed';
      ctx.fillRect(0, 0, 300, 200);
      ctx.fillStyle = '#ffffff';
      ctx.font = '20px sans-serif';
      ctx.fillText('Prefrontal Specimen', 45, 105);
    }
    canvas.toBlob((blob) => {
      if (blob) {
        this.imageFile = new File([blob], 'specimen.png', { type: 'image/png' });
        this.showImageEditor = true;
        this.logEvent('Opened specimen crop modal');
      }
    });
  }

  protected onImageApplied(blob: Blob): void {
    this.showImageEditor = false;
    this.logEvent(`(applied) image cropped successfully (${blob.size} bytes)`);
  }
}
