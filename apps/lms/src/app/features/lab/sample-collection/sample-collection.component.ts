import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, OnDestroy, OnInit, ViewChild, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { AuthService } from '../../../core/auth/auth.service';
import { DialogService } from '../../../core/services/dialog.service';
import { ToastService } from '../../../core/services/toast.service';
import { Order, OrderSample } from '../../../shared/models/order.model';
import { BarcodeScannerModalComponent } from '../../../shared/components/barcode-scanner/barcode-scanner-modal.component';
import { LoadingLogoComponent } from '../../../shared/components/loading-logo/loading-logo.component';
import { AvatarComponent } from '../../../shared/primitives/avatar.component';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';
import { KpiStripComponent } from '../../../shared/components/kpi-strip/kpi-strip.component';
import { LabelCardComponent } from '../../frontdesk/post-payment/label-card.component';
import { printLabelOnly } from '../../../shared/utils/print-label';

/**
 * What the phlebotomist actually holds. "Kind" drives which illustration we
 * render (blood vacutainer vs. urine cup vs. generic jar); "color" is the
 * cap/container colour so labelling matches what's on the rack; "fill" is the
 * liquid colour used when the sample's drawn.
 */
type ContainerKind = 'vacutainer' | 'urine_cup' | 'jar';
interface Container {
  kind: ContainerKind;
  color: string;   // cap / container accent
  fill: string;    // liquid fill when collected
  label: string;
}

// Tube colour conventions for blood vacutainers, keyed by department code.
const DEPT_VACUTAINER: Record<string, { color: string; label: string }> = {
  HAEM:  { color: '#a78bfa', label: 'EDTA · Lavender' },
  BIO:   { color: '#f59e0b', label: 'SST · Gold' },
  SERO:  { color: '#ef4444', label: 'Plain · Red' },
  MICRO: { color: '#10b981', label: 'Sterile tube' },
  HISTO: { color: '#64748b', label: 'Formalin tube' }
};
const BLOOD_FILL = '#b91c1c';
const URINE_FILL = '#f59e0b';

/**
 * Picks the container for a sample. Priority: explicit sampleType on the
 * first test (authoritative — "Urine", "Blood - EDTA", …), then fall back to
 * the sample's department code for colour.
 */
function containerFor(s: OrderSample): Container {
  const sampleType = (s.tests[0]?.test?.sampleType ?? '').toLowerCase();
  if (sampleType.includes('urine')) {
    return { kind: 'urine_cup', color: '#facc15', fill: URINE_FILL, label: 'Urine cup' };
  }
  if (sampleType.includes('stool') || sampleType.includes('sputum') || sampleType.includes('swab')) {
    return { kind: 'jar', color: '#10b981', fill: '#6b7280', label: 'Sterile container' };
  }
  // Blood: vacutainer. Prefer the tube colour spelt out in the sampleType
  // ("Blood - EDTA"), otherwise use the department's conventional colour.
  if (sampleType.includes('edta')) return { kind: 'vacutainer', color: '#a78bfa', fill: BLOOD_FILL, label: 'EDTA · Lavender' };
  if (sampleType.includes('sst') || sampleType.includes('gold')) return { kind: 'vacutainer', color: '#f59e0b', fill: BLOOD_FILL, label: 'SST · Gold' };
  if (sampleType.includes('fluoride') || sampleType.includes('grey')) return { kind: 'vacutainer', color: '#6b7280', fill: BLOOD_FILL, label: 'Fluoride · Grey' };
  if (sampleType.includes('citrate') || sampleType.includes('blue')) return { kind: 'vacutainer', color: '#3b82f6', fill: BLOOD_FILL, label: 'Citrate · Blue' };
  if (sampleType.includes('heparin') || sampleType.includes('green')) return { kind: 'vacutainer', color: '#10b981', fill: BLOOD_FILL, label: 'Heparin · Green' };
  if (sampleType.includes('plain') || sampleType.includes('red')) return { kind: 'vacutainer', color: '#ef4444', fill: BLOOD_FILL, label: 'Plain · Red' };
  const dept = DEPT_VACUTAINER[s.department?.code ?? ''];
  return {
    kind: 'vacutainer',
    color: dept?.color ?? '#6b7280',
    fill: BLOOD_FILL,
    label: dept?.label ?? 'Tube'
  };
}

interface OrderGroup {
  orderId: string;
  patientName: string;
  patientMeta: string;
  createdAt: string;
  samples: OrderSample[];
  totalVials: number;
  collected: number;
}

@Component({
  selector: 'pf-sample-collection',
  standalone: true,
  imports: [FormsModule, DatePipe, AvatarComponent, BarcodeScannerModalComponent, LoadingLogoComponent, ScreenHeaderComponent, TouchButtonComponent, KpiStripComponent, LabelCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="px-4 md:px-8 lg:px-10 pt-6 pb-10">
      <!-- Deep-link mode (?orderId=…): hide the queue + header + scan
           row entirely. The user clicked Collect on a specific order
           — show them THAT order's drawer immediately as if it's a
           dedicated page. The queue UI used to flash for ~500ms while
           the order data loaded and felt like "two pages" before
           the drawer appeared. -->
      @if (!deepLinkMode()) {
      <pf-kpi-strip screen="sample_collection"></pf-kpi-strip>
      <pf-screen-header
        eyebrow="Lab · Collection"
        title="Sample collection"
        subtitle="Scan the barcode from reception, or tap a patient to draw vials.">
        <pf-touch-btn actions size="sm" variant="ghost" (pressed)="refresh()" aria-label="Refresh">
          <span icon-left aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 12a9 9 0 1 1-3-6.7"/>
              <path d="M21 4v6h-6"/>
            </svg>
          </span>
          <span class="pf-refresh-txt">Refresh</span>
        </pf-touch-btn>
      </pf-screen-header>
      }

      @if (!deepLinkMode()) {
      <div class="pf-scan">
        <button type="button" class="pf-scan__icon-btn" (click)="openScanner()"
                title="Scan with camera" aria-label="Open camera scanner">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M3 7V5a2 2 0 0 1 2-2h2M21 7V5a2 2 0 0 0-2-2h-2M3 17v2a2 2 0 0 0 2 2h2M21 17v2a2 2 0 0 1-2 2h-2"/>
            <path d="M6 8v8M9 8v8M12 8v8M15 8v8M18 8v8"/>
          </svg>
        </button>
        <div class="pf-scan__body">
          <label class="pf-scan__label">Find patient or scan</label>
          <input type="text" class="pf-scan__input"
                 placeholder="Name · MRN · phone · order # · barcode"
                 [ngModel]="scanValue()" (ngModelChange)="onSearchInput($event)"
                 (keydown.enter)="runSearch()" autofocus aria-label="Search" />
        </div>
        <button class="pf-scan__cam" (click)="openScanner()" title="Scan QR / barcode" aria-label="Scan QR or barcode">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="5" height="5" rx="1"/>
            <rect x="16" y="3" width="5" height="5" rx="1"/>
            <rect x="3" y="16" width="5" height="5" rx="1"/>
            <path d="M21 16h-3a2 2 0 0 0-2 2v3"/><path d="M21 21v.01"/>
            <path d="M12 7v3a2 2 0 0 1-2 2H7"/><path d="M3 12h.01"/><path d="M12 3h.01"/>
            <path d="M12 16v.01"/><path d="M16 12h1"/><path d="M21 12v.01"/><path d="M12 21v-1"/>
          </svg>
          <span class="pf-scan__cam-txt">Scan</span>
        </button>
        <button class="pf-scan__btn" [disabled]="!scanValue() || searching()" (click)="runSearch()" aria-label="Find">
          <svg class="pf-scan__find-ic" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>
          </svg>
          <span class="pf-scan__btn-txt">{{ searching() ? 'Searching…' : 'Find' }}</span>
        </button>
      </div>

      @if (scannerOpen()) {
        <pf-barcode-scanner-modal
          title="Scan vial barcode"
          (matched)="onScanMatched($event)"
          (cancelled)="scannerOpen.set(false)">
        </pf-barcode-scanner-modal>
      }

      <h3 class="pf-sc__section">
        Pending collection · {{ filteredGroups().length }} patient<span [class.hidden]="filteredGroups().length === 1">s</span>
      </h3>

      @if (filteredGroups().length === 0) {
        <div class="pf-sc__empty">No samples waiting for collection.</div>
      } @else {
        <ul class="pf-sc__list">
          @for (g of filteredGroups(); track g.orderId) {
            <li>
              <button type="button" class="pf-sc__card" (click)="openOrder(g.orderId)">
                <pf-avatar [name]="g.patientName" [size]="44"></pf-avatar>
                <div class="pf-sc__who">
                  <p class="pf-sc__who-name">{{ g.patientName }}</p>
                  <p class="pf-sc__who-meta">{{ g.patientMeta }}</p>
                </div>
                <div class="pf-sc__rack" [attr.aria-label]="g.totalVials + ' vials'">
                  @for (s of g.samples; track s.id) {
                    <span class="pf-sc__chip"
                          [style.background]="tube(s).color"
                          [class.pf-sc__chip--done]="s.status !== 'pending'"
                          [class.pf-sc__chip--out]="!!s.outsourcedVendorId"
                          [title]="s.outsourcedVendorId ? (tube(s).label + ' · Outsourced') : tube(s).label"></span>
                  }
                </div>
                <div class="pf-sc__card-tail">
                  @if (g.collected > 0 && g.collected < g.totalVials) {
                    <span class="pf-sc__count pf-sc__count--progress">{{ g.collected }}/{{ g.totalVials }}</span>
                  } @else {
                    <span class="pf-sc__count">{{ g.totalVials }} vial<span [class.hidden]="g.totalVials === 1">s</span></span>
                  }
                  <svg class="pf-sc__chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="m9 18 6-6-6-6"/>
                  </svg>
                </div>
              </button>
            </li>
          }
        </ul>
      }
      } @else if (!activeGroup()) {
        <!-- Deep-link mode + drawer not yet ready: render the org's
             standard loading logo so the page isn't blank while the
             order fetch resolves. The drawer takes over the moment
             activeGroup returns. -->
        <div class="pf-sc__loading">
          <!-- Full DNA-skeleton + heartbeat-logo variant (showDna). The
               richer animation is what the user calls out as the
               "prepare loading" — used here so collection deep-links
               feel like the same waiting-room treatment as other
               long-running screens. -->
          <pf-loading-logo size="xl" color="purple"
                           [showDna]="true"
                           [showText]="true"
                           text="Opening collection…"></pf-loading-logo>
        </div>
      }
    </section>

    <!-- ─── Collect drawer ────────────────────────────────────────────── -->
    @if (activeGroup(); as g) {
      <div #drawerEl class="pf-drawer" role="dialog" aria-modal="true" (click)="close()">
        <div class="pf-drawer__panel" (click)="$event.stopPropagation()">
          <header class="pf-drawer__head">
            <button type="button" class="pf-drawer__close" (click)="close()" aria-label="Close">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M18 6 6 18M6 6l12 12"/>
              </svg>
            </button>
            <div class="pf-drawer__who">
              <p class="pf-drawer__name">{{ g.patientName }}</p>
              <p class="pf-drawer__meta">{{ g.patientMeta }}</p>
            </div>
            <div class="pf-drawer__progress">
              <span class="pf-drawer__progress-num">{{ g.collected }}/{{ g.totalVials }}</span>
              <span class="pf-drawer__progress-lbl">vials drawn</span>
            </div>
          </header>

          <div class="pf-drawer__progressbar">
            <span [style.width.%]="(g.collected / g.totalVials) * 100"></span>
          </div>

          <p class="pf-drawer__hint">Tap each vial as you draw it. When every vial is drawn, the order is completed automatically.</p>

          <div class="pf-drawer__tubes">
            @for (s of g.samples; track s.id) {
              <button type="button" class="pf-tube"
                      [class.pf-tube--done]="s.status !== 'pending'"
                      (click)="toggleCollected(s)">
                @if (container(s).kind === 'urine_cup') {
                  <!-- Urine specimen cup: shorter cylinder, wide rim, yellow
                       screw-cap lid, amber fill. -->
                  <svg class="pf-vial pf-vial--cup" viewBox="0 0 140 220" aria-hidden="true"
                       [style.--tube-color]="container(s).color">
                    <defs>
                      <linearGradient [attr.id]="'lid-' + s.id" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0"    stop-color="#000" stop-opacity="0.35"/>
                        <stop offset="0.5"  stop-color="#fff" stop-opacity="0.2"/>
                        <stop offset="1"    stop-color="#000" stop-opacity="0.35"/>
                      </linearGradient>
                      <linearGradient [attr.id]="'cup-' + s.id" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0"    stop-color="#fff" stop-opacity="0.08"/>
                        <stop offset="0.2"  stop-color="#fff" stop-opacity="0.3"/>
                        <stop offset="0.5"  stop-color="#fff" stop-opacity="0.02"/>
                        <stop offset="0.85" stop-color="#000" stop-opacity="0.2"/>
                        <stop offset="1"    stop-color="#000" stop-opacity="0.4"/>
                      </linearGradient>
                      <linearGradient [attr.id]="'urine-' + s.id" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0"    stop-color="#fcd34d"/>
                        <stop offset="0.35" stop-color="#f59e0b"/>
                        <stop offset="1"    stop-color="#b45309"/>
                      </linearGradient>
                      <clipPath [attr.id]="'cupclip-' + s.id">
                        <path d="M18 68 L22 200 Q22 208 30 208 L110 208 Q118 208 118 200 L122 68 Z"/>
                      </clipPath>
                    </defs>

                    <!-- Lid: wider than body, with grip ridges -->
                    <rect x="6" y="30" width="128" height="42" rx="7"
                          [attr.fill]="container(s).color"/>
                    <rect x="6" y="30" width="128" height="42" rx="7"
                          [attr.fill]="'url(#lid-' + s.id + ')'"/>
                    <!-- Lid grip texture -->
                    <g stroke="rgba(0,0,0,0.2)" stroke-width="1" stroke-linecap="round">
                      <line x1="18" y1="42" x2="18" y2="60"/>
                      <line x1="30" y1="42" x2="30" y2="60"/>
                      <line x1="42" y1="42" x2="42" y2="60"/>
                      <line x1="54" y1="42" x2="54" y2="60"/>
                      <line x1="66" y1="42" x2="66" y2="60"/>
                      <line x1="78" y1="42" x2="78" y2="60"/>
                      <line x1="90" y1="42" x2="90" y2="60"/>
                      <line x1="102" y1="42" x2="102" y2="60"/>
                      <line x1="114" y1="42" x2="114" y2="60"/>
                      <line x1="122" y1="42" x2="122" y2="60"/>
                    </g>
                    <!-- Rim shadow under lid -->
                    <rect x="14" y="64" width="112" height="6" rx="2" fill="#000" opacity="0.25"/>

                    <!-- Cup outline (tapered slightly from rim to base) -->
                    <path class="pf-vial__outline"
                          d="M18 68 L22 200 Q22 208 30 208 L110 208 Q118 208 118 200 L122 68 Z"/>

                    <!-- Urine fill clipped to cup shape -->
                    <g [attr.clip-path]="'url(#cupclip-' + s.id + ')'">
                      <rect class="pf-vial__blood"
                            x="14"
                            [attr.y]="s.status !== 'pending' ? 110 : 220"
                            width="112"
                            height="120"
                            [attr.fill]="'url(#urine-' + s.id + ')'"/>
                      @if (s.status !== 'pending') {
                        <ellipse cx="70" cy="110" rx="53" ry="4" fill="#fde68a" opacity="0.6"/>
                        <ellipse cx="70" cy="112" rx="50" ry="2" fill="#fef3c7" opacity="0.35"/>
                      }
                    </g>

                    <!-- Cup reflection highlight -->
                    <path d="M18 68 L22 200 Q22 208 30 208 L110 208 Q118 208 118 200 L122 68 Z"
                          [attr.fill]="'url(#cup-' + s.id + ')'"/>

                    <!-- Volume tick marks on the right (50 / 100 mL) -->
                    <g opacity="0.4" stroke="rgba(255,255,255,0.4)" stroke-width="0.8" stroke-linecap="round" font-family="ui-monospace, monospace">
                      <line x1="116" y1="110" x2="122" y2="110"/>
                      <line x1="116" y1="150" x2="122" y2="150"/>
                      <line x1="116" y1="190" x2="122" y2="190"/>
                    </g>

                    <!-- Tick badge when collected -->
                    @if (s.status !== 'pending') {
                      <g class="pf-vial__tick">
                        <circle cx="118" cy="58" r="18" fill="#10b981"/>
                        <circle cx="118" cy="58" r="18" fill="none" stroke="#fff" stroke-opacity="0.25" stroke-width="2"/>
                        <path d="M110 58 l6 6 l12 -12" stroke="#fff" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
                      </g>
                    }
                  </svg>
                } @else {
                <!-- Vacutainer — proportioned ~ 13×75 mm (1:5.8), with
                     colored rubber stopper, glass body, hemispherical base,
                     realistic highlights and a blood fill that rises on tap. -->
                <svg class="pf-vial" viewBox="0 0 80 320" aria-hidden="true"
                     [style.--tube-color]="container(s).color">
                  <defs>
                    <!-- Stopper (cap) shading -->
                    <linearGradient [attr.id]="'cap-' + s.id" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0"    stop-color="#000" stop-opacity="0.35"/>
                      <stop offset="0.35" stop-color="#fff" stop-opacity="0.25"/>
                      <stop offset="0.65" stop-color="#fff" stop-opacity="0"/>
                      <stop offset="1"    stop-color="#000" stop-opacity="0.35"/>
                    </linearGradient>
                    <!-- Glass reflections -->
                    <linearGradient [attr.id]="'glass-' + s.id" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0"    stop-color="#fff" stop-opacity="0.1"/>
                      <stop offset="0.18" stop-color="#fff" stop-opacity="0.28"/>
                      <stop offset="0.32" stop-color="#fff" stop-opacity="0.02"/>
                      <stop offset="0.68" stop-color="#fff" stop-opacity="0.02"/>
                      <stop offset="0.82" stop-color="#000" stop-opacity="0.25"/>
                      <stop offset="1"    stop-color="#000" stop-opacity="0.45"/>
                    </linearGradient>
                    <!-- Blood -->
                    <linearGradient [attr.id]="'blood-' + s.id" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0"    stop-color="#dc2626"/>
                      <stop offset="0.25" stop-color="#b91c1c"/>
                      <stop offset="1"    stop-color="#5b1010"/>
                    </linearGradient>
                    <!-- Clip to the inside of the glass body so blood never
                         bleeds outside the tube outline. Tube top extends
                         to y=50 (under where the cap will sit) so the cap
                         drawn last cleanly overlaps it. -->
                    <clipPath [attr.id]="'clip-' + s.id">
                      <path d="M20 50 L60 50 L60 290 Q60 310 40 310 Q20 310 20 290 Z"/>
                    </clipPath>
                  </defs>

                  <!-- ─── Layer 1: Glass tube (drawn first, behind everything) ───
                       Real vacutainer shape: flat top to meet the cap, then
                       a long cylinder, then a hemispherical bottom where
                       the draw collects. The top extends INTO the cap area
                       (y=50) so the cap drawn later cleanly overlaps and
                       hides the glass top — same way a rubber stopper sits
                       on a real tube. -->
                  <path class="pf-vial__outline"
                        d="M20 50 L60 50 L60 290 Q60 310 40 310 Q20 310 20 290 Z"/>

                  <!-- ─── Layer 2: Blood fill (clipped to tube shape) ─── -->
                  <g [attr.clip-path]="'url(#clip-' + s.id + ')'">
                    <rect class="pf-vial__blood"
                          x="14"
                          [attr.y]="s.status !== 'pending' ? 130 : 320"
                          width="52"
                          height="200"
                          [attr.fill]="'url(#blood-' + s.id + ')'"/>
                    @if (s.status !== 'pending') {
                      <!-- Meniscus curve at liquid surface -->
                      <path d="M20 130 Q40 124 60 130 L60 134 Q40 128 20 134 Z"
                            fill="#ef4444" opacity="0.75"/>
                      <ellipse cx="40" cy="131" rx="18" ry="2.5" fill="#fecaca" opacity="0.35"/>
                    }
                  </g>

                  <!-- ─── Layer 3: Glass highlights / reflections ─── -->
                  <path d="M20 50 L60 50 L60 290 Q60 310 40 310 Q20 310 20 290 Z"
                        [attr.fill]="'url(#glass-' + s.id + ')'"/>

                  <!-- Thin vertical highlight streak -->
                  <rect x="25" y="74" width="4" height="220" rx="2"
                        fill="#fff" opacity="0.18"/>
                  <!-- Subtle right shadow -->
                  <rect x="54" y="74" width="3" height="220" rx="1.5"
                        fill="#000" opacity="0.25"/>

                  <!-- Volume ticks -->
                  <g opacity="0.35" stroke="rgba(255,255,255,0.35)" stroke-width="0.8" stroke-linecap="round">
                    <line x1="60" y1="120" x2="64" y2="120"/>
                    <line x1="60" y1="170" x2="64" y2="170"/>
                    <line x1="60" y1="220" x2="64" y2="220"/>
                    <line x1="60" y1="270" x2="64" y2="270"/>
                  </g>

                  <!-- ─── Layer 4: Stopper (cap) — drawn LAST so it sits ON TOP
                       of the glass, the same way a real rubber stopper
                       wraps over the open end of a vacutainer. The cap is
                       slightly wider than the glass body so it visibly
                       overhangs on each side. -->
                  <g>
                    <!-- Cap body (rounded rectangle a touch wider than the glass tube) -->
                    <rect x="14" y="20" width="52" height="48" rx="8"
                          [attr.fill]="tube(s).color"/>
                    <rect x="14" y="20" width="52" height="48" rx="8"
                          [attr.fill]="'url(#cap-' + s.id + ')'"/>
                    <!-- Top dome highlight — fakes a soft dome on the rubber. -->
                    <ellipse cx="40" cy="26" rx="20" ry="3.5" fill="#fff" opacity="0.22"/>
                    <!-- Rim shadow at the cap's bottom edge sells the
                         "cap-on-top-of-tube" silhouette. -->
                    <rect x="14" y="62" width="52" height="6" rx="2"
                          fill="#000" opacity="0.32"/>
                    <!-- Subtle highlight ring on the rim -->
                    <rect x="14" y="60" width="52" height="2" rx="1"
                          fill="#fff" opacity="0.18"/>
                  </g>

                  <!-- Tick badge when collected — drawn last so it pops
                       above both the cap and the tube body. -->
                  @if (s.status !== 'pending') {
                    <g class="pf-vial__tick">
                      <circle cx="62" cy="46" r="16" fill="#10b981"/>
                      <circle cx="62" cy="46" r="16" fill="none" stroke="#fff" stroke-opacity="0.25" stroke-width="2"/>
                      <path d="M55 46 l5 5 l10 -10" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
                    </g>
                  }
                </svg>
                }

                <div class="pf-tube__body">
                  <p class="pf-tube__label">{{ tube(s).label }}</p>
                  <p class="pf-tube__dept">{{ s.department?.name ?? 'Sample' }}</p>

                  @if (s.tests.length > 0) {
                    <p class="pf-tube__tests" [title]="testList(s)">
                      {{ s.tests[0].test?.name ?? 'Test' }}<!--
                      -->@if (s.tests.length > 1) { <span class="pf-tube__tests-more"> +{{ s.tests.length - 1 }}</span> }
                    </p>
                  }

                  <p class="pf-tube__code">{{ s.barcode ?? '—' }}</p>

                  @if (s.status !== 'pending') {
                    <span class="pf-tube__stamp">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                        <path d="m5 12 4 4L19 6"/>
                      </svg>
                      @if (s.status === 'collected') { {{ s.collectedAt | date:'shortTime' }} }
                      @else { Dispatched }
                    </span>
                  } @else {
                    <span class="pf-tube__stamp pf-tube__stamp--pending">Tap when drawn</span>
                  }
                </div>
              </button>
            }
          </div>

          <footer class="pf-drawer__foot">
            @if (isDispatched(g)) {
              <button type="button" class="pf-btn pf-btn-ghost" (click)="undispatchOrder(g)" [disabled]="dispatching()">
                {{ dispatching() ? 'Undoing…' : 'Undo dispatch' }}
              </button>
            } @else {
              <button type="button" class="pf-btn pf-btn-ghost" (click)="rejectOrder(g)"
                      aria-label="Can't collect" data-label="Can't collect">
                <svg class="pf-btn__icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="9"/><path d="M5.6 5.6 18.4 18.4"/>
                </svg>
                <span class="pf-btn__text">Can't collect</span>
              </button>
            }
            <!-- Print the order's tube labels (barcode + QR) — available any time
                 in the drawer so tubes can be labelled before or after the draw. -->
            <button type="button" class="pf-btn pf-btn-ghost" (click)="printLabels(g)"
                    aria-label="Print labels" data-label="Print labels">
              <svg class="pf-btn__icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M6 9V2h12v7"/><rect x="6" y="13" width="12" height="9"/><path d="M6 18H3a1 1 0 0 1-1-1v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a1 1 0 0 1-1 1h-3"/>
              </svg>
              <span class="pf-btn__text">Print labels</span>
            </button>
            @if (isDispatched(g)) {
              <span class="pf-drawer__done-stamp">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M5 18H3a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h11v12M14 9h4l3 3v5a1 1 0 0 1-1 1h-2"/><circle cx="7.5" cy="18.5" r="1.5"/><circle cx="17.5" cy="18.5" r="1.5"/>
                </svg>
                Dispatched to lab
              </span>
            } @else if (g.collected === g.totalVials) {
              <span class="pf-drawer__done-stamp">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                  <path d="m5 12 4 4L19 6"/>
                </svg>
                All vials collected
              </span>
            } @else {
              <span class="pf-drawer__remaining">{{ g.totalVials - g.collected }} remaining</span>
            }
            <!-- Dispatch right here once everything's drawn (FD/collector handoff
                 to the lab) — only if the user can dispatch and it's not already. -->
            @if (g.collected === g.totalVials && canDispatch() && !isDispatched(g)) {
              <button type="button" class="pf-btn pf-btn-primary" (click)="dispatchOrder(g)" [disabled]="dispatching()"
                      aria-label="Dispatch" data-label="Dispatch">
                <svg class="pf-btn__icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4Z"/>
                </svg>
                <span class="pf-btn__text">{{ dispatching() ? 'Dispatching…' : 'Dispatch' }}</span>
              </button>
            }
            <button type="button" class="pf-btn" [class.pf-btn-primary]="isDispatched(g)" [class.pf-btn-ghost]="!isDispatched(g)"
                    (click)="close()" [disabled]="g.collected < g.totalVials"
                    [attr.aria-label]="g.collected < g.totalVials ? 'Collect all to finish' : 'Done'"
                    [attr.data-label]="g.collected < g.totalVials ? 'Collect all to finish' : 'Done'">
              @if (g.collected < g.totalVials) {
                <svg class="pf-btn__icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M11 12H3"/><path d="M16 6H3"/><path d="M16 18H3"/><path d="m17 13 2 2 4-4"/>
                </svg>
              } @else {
                <svg class="pf-btn__icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="m5 12 4 4L19 6"/>
                </svg>
              }
              <span class="pf-btn__text">{{ g.collected < g.totalVials ? 'Collect all to finish' : 'Done' }}</span>
            </button>
          </footer>

          <!-- Tube labels for printing. Hidden on screen; the global
               pf-print-label rule reveals ONLY this block during
               printLabels(). One barcode+QR label per tube, reusing the
               shared front-desk label card so labels match everywhere. -->
          <div class="pf-sc-labels pf-print-label" aria-hidden="true">
            @for (s of g.samples; track s.id; let i = $index) {
              <pf-label-card [sample]="s" [patient]="s.order?.patient" [index]="i" [printing]="true"></pf-label-card>
            }
          </div>
        </div>
      </div>
    }

    <!-- ─── Reject-with-reason modal ─────────────────────────────────────
         Structured reason picker. Opens when the user taps "Can't collect".
         Reasons: refused, fainted, no_vein, insufficient, wrong_tube, other. -->
    @if (_rejectModal(); as r) {
      <div class="pf-rej" role="dialog" aria-modal="true" (click)="cancelReject()">
        <div class="pf-rej__panel" (click)="$event.stopPropagation()">
          <header class="pf-rej__head">
            <h2 class="pf-rej__title">Can't collect for {{ r.group.patientName }}</h2>
            <p class="pf-rej__sub">Pick a reason — flagged tubes go back into the queue for re-collection.</p>
          </header>
          <div class="pf-rej__chips">
            @for (opt of REJECT_REASONS; track opt.code) {
              <button type="button" class="pf-rej__chip"
                      [class.pf-rej__chip--on]="r.reason === opt.code"
                      (click)="setRejectReason(opt.code)">
                {{ opt.label }}
              </button>
            }
          </div>
          @if (r.reason === 'other') {
            <label class="pf-rej__label">Reason</label>
            <textarea class="pf-input pf-rej__note" rows="2"
                      placeholder="Describe what happened…"
                      [ngModel]="r.note" (ngModelChange)="setRejectNote($event)"></textarea>
          } @else if (r.reason) {
            <label class="pf-rej__label">Notes (optional)</label>
            <textarea class="pf-input pf-rej__note" rows="2"
                      placeholder="Anything the lab should know…"
                      [ngModel]="r.note" (ngModelChange)="setRejectNote($event)"></textarea>
          }
          <footer class="pf-rej__foot">
            <button type="button" class="pf-btn pf-btn-ghost" (click)="cancelReject()">Cancel</button>
            <button type="button" class="pf-btn pf-btn-danger"
                    [disabled]="!canSubmitReject()"
                    (click)="submitReject()">
              Reject {{ pendingCount(r.group) }} tube<span [class.hidden]="pendingCount(r.group) === 1">s</span>
            </button>
          </footer>
        </div>
      </div>
    }
  `,
  styles: [`
    /* ─── WORK-mode non-scroll app layout (intentional, all sizes) ───────
     * The page fills the shell's main area exactly: header / KPI strip /
     * scan strip / section heading are fixed (flex:0 0 auto) and the
     * pending-queue list (or empty / loading stub) is the ONLY thing that
     * scrolls, internally. No outer page scroll, no double scrollbars.
     * The drawer + reject modal are position:fixed siblings of the section
     * and are unaffected by this flex column. */
    :host {
      display: block;
      height: 100%;
      min-height: 0;
    }
    :host > section {
      height: 100%;
      min-height: 0;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    /* Fixed (non-scrolling) chrome at the top of the page. */
    :host > section > pf-kpi-strip,
    :host > section > pf-screen-header,
    :host > section > .pf-scan,
    :host > section > pf-barcode-scanner-modal,
    :host > section > .pf-sc__section {
      flex: 0 0 auto;
    }
    /* The queue list / empty state / loading stub is the single scroll
     * region. min-height:0 lets it shrink inside the flex column so the
     * scrollbar lives here, not on the page. */
    :host > section > .pf-sc__list,
    :host > section > .pf-sc__empty,
    :host > section > .pf-sc__loading {
      flex: 1 1 auto;
      min-height: 0;
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
    }

    /* ─── Scan strip ─────────────────────────────────────────
     * Designed as the primary action: big icon, bold label, wide input.
     * A real vacutainer scanner just types the code into the focused field,
     * so autofocus + (keydown.enter) = Find.  */
    .pf-scan {
      display: flex; align-items: stretch; gap: 14px;
      padding: 14px 16px;
      background: linear-gradient(180deg, rgba(139, 92, 246, 0.08), rgba(168, 85, 247, 0.05));
      border: 1px solid rgba(139, 92, 246, 0.28);
      border-radius: 18px;
      margin: 0 0 24px;
      box-shadow: 0 8px 24px rgba(139, 92, 246, 0.07);
    }
    .pf-scan__icon-btn {
      all: unset;
      cursor: pointer;
      width: 54px; height: 54px; border-radius: 14px;
      display: inline-flex; align-items: center; justify-content: center;
      background: linear-gradient(135deg, rgba(139,92,246,0.22), rgba(124,58,237,0.08));
      color: #a78bfa;
      flex-shrink: 0; align-self: center;
      transition: background 0.15s ease, transform 0.1s ease;
    }
    .pf-scan__icon-btn:hover { background: linear-gradient(135deg, rgba(139,92,246,0.32), rgba(124,58,237,0.16)); }
    .pf-scan__icon-btn:active { transform: scale(0.96); }
    .pf-scan__icon-btn:focus-visible { outline: 2px solid rgba(139, 92, 246, 0.7); outline-offset: 2px; }
    .pf-scan__body { flex: 1 1 auto; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .pf-scan__label {
      font-size: 10.5px; font-weight: 700; letter-spacing: 0.16em;
      text-transform: uppercase; color: var(--text-muted);
    }
    .pf-scan__input {
      width: 100%; min-width: 0;
      height: 32px; padding: 0;
      background: transparent;
      border: 0;
      color: var(--text-primary);
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 16px; font-weight: 600; letter-spacing: 0.02em;
      outline: none;
    }
    .pf-scan__input::placeholder { color: var(--text-muted); font-weight: 400; letter-spacing: 0.06em; }
    .pf-scan__cam {
      align-self: center;
      display: inline-flex; align-items: center; gap: 8px;
      background: rgba(139, 92, 246, 0.1);
      color: #a78bfa;
      font-weight: 600; font-size: 12.5px;
      padding: 0 14px; height: 42px;
      border: 1px solid rgba(139, 92, 246, 0.38);
      border-radius: 12px;
      cursor: pointer;
      transition: background 0.15s ease, transform 0.1s ease;
    }
    .pf-scan__cam:hover { background: rgba(139, 92, 246, 0.18); }
    .pf-scan__cam:active { transform: scale(0.98); }
    .pf-scan__cam:focus-visible { outline: 2px solid rgba(139, 92, 246, 0.7); outline-offset: 2px; }

    .pf-scan__btn {
      align-self: center;
      display: inline-flex; align-items: center; justify-content: center; gap: 7px;
      background: linear-gradient(135deg, #7c3aed, #8b5cf6);
      color: #fff;
      font-weight: 700; font-size: 13.5px;
      padding: 0 22px; height: 42px; min-width: 96px;
      border: 0; border-radius: 12px;
      cursor: pointer;
      box-shadow: 0 6px 18px rgba(124, 58, 237, 0.4);
      transition: transform 0.1s ease, box-shadow 0.2s ease, filter 0.15s ease;
    }
    .pf-scan__btn:hover:not(:disabled) { filter: brightness(1.08); box-shadow: 0 10px 24px rgba(124, 58, 237, 0.5); }
    .pf-scan__find-ic { display: none; }
    .pf-scan__btn:active:not(:disabled) { transform: scale(0.98); }
    .pf-scan__btn:disabled { opacity: 0.45; cursor: not-allowed; box-shadow: none; }

    .pf-sc__section { font-size: 11px; font-family: 'JetBrains Mono', ui-monospace, monospace;
      letter-spacing: 0.16em; text-transform: uppercase; color: var(--text-muted);
      margin: 18px 2px 10px;
    }
    .pf-sc__empty {
      padding: 28px; text-align: center;
      background: var(--glass-bg); border: 1px dashed var(--glass-border);
      border-radius: 16px; color: var(--text-tertiary); font-size: 13px;
    }
    /* Deep-link loading stub — centred loading-logo while the
       drawer's order fetch resolves. */
    .pf-sc__loading {
      display: flex; align-items: center; justify-content: center;
      padding: 64px 24px;
      min-height: 60dvh;
    }

    /* Responsive grid: 1 / 2 / 3 columns depending on width. Matches the
     * auto-flow pattern used by other pages in the app — fills the whole
     * viewport with responsive padding coming from Tailwind. */
    .pf-sc__list {
      list-style: none; padding: 0; margin: 0;
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));
      gap: 12px;
    }
    .pf-sc__list > li { min-width: 0; }
    /* Card row: Avatar · Name/meta · Rack of chips · Count · Chevron.
     * position: relative + overflow: hidden keep inner content (hover
     * translates, long patient names, large racks) from bleeding into the
     * card's neighbour in the grid. */
    .pf-sc__card {
      all: unset;
      cursor: pointer;
      position: relative;
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto auto auto;
      align-items: center;
      column-gap: 12px;
      width: 100%;
      box-sizing: border-box;
      padding: 12px 14px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      border-radius: 16px;
      overflow: hidden;
      transition: border-color 0.15s ease, transform 0.1s ease, box-shadow 0.2s ease, background 0.2s ease;
    }
    .pf-sc__card:hover {
      border-color: rgba(168, 85, 247, 0.45);
      background: rgba(168, 85, 247, 0.04);
      box-shadow: 0 10px 28px rgba(0,0,0,0.22);
    }
    .pf-sc__card:active { transform: scale(0.998); }
    .pf-sc__card:focus-visible { outline: 2px solid rgba(168, 85, 247, 0.7); outline-offset: 2px; }

    .pf-sc__who { min-width: 0; }
    .pf-sc__who-name {
      margin: 0; font-weight: 600; font-size: 14.5px;
      color: var(--text-primary); text-align: left;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .pf-sc__who-meta {
      margin: 2px 0 0; font-size: 11px; color: var(--text-tertiary);
      text-align: left;
      font-family: 'JetBrains Mono', ui-monospace, monospace; letter-spacing: 0.03em;
    }

    /* Tube rack: colored chips shaped like little vials inside a holder.
     * max-width + overflow keep unusually-large orders (>8 vials) from
     * pushing the count/chevron off the card edge. */
    .pf-sc__rack {
      display: inline-flex; align-items: center; gap: 3px;
      padding: 5px 7px;
      border-radius: 10px;
      background: rgba(0,0,0,0.22);
      border: 1px solid var(--glass-border);
      max-width: 120px;
      overflow: hidden;
      flex-shrink: 0;
    }
    .pf-sc__chip {
      display: inline-block;
      width: 5px; height: 18px; border-radius: 2px;
      flex-shrink: 0;
      box-shadow: inset 0 -2px 0 rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.3);
    }
    .pf-sc__chip--done { opacity: 0.3; }
    /* Outsourced vials carry a pink outline so collectors spot the
       send-out tubes at a glance in the rack. */
    .pf-sc__chip--out {
      width: 7px;
      box-shadow: inset 0 -2px 0 rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.3), 0 0 0 1.5px #ec4899;
    }

    .pf-sc__card-tail { display: inline-flex; align-items: center; gap: 8px; }
    .pf-sc__count {
      font-size: 10.5px; font-weight: 700;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      padding: 4px 9px; border-radius: 999px;
      background: rgba(168, 85, 247, 0.14); color: #c4b5fd;
      border: 1px solid rgba(168, 85, 247, 0.28);
      letter-spacing: 0.04em;
      white-space: nowrap;
    }
    .pf-sc__count--progress {
      background: rgba(245, 158, 11, 0.14); color: #fcd34d;
      border-color: rgba(245, 158, 11, 0.35);
    }
    .pf-sc__chev {
      color: var(--text-muted); opacity: 0.55; flex-shrink: 0;
      transition: transform 0.15s ease, color 0.15s ease, opacity 0.15s ease;
    }
    .pf-sc__card:hover .pf-sc__chev { color: var(--text-primary); opacity: 1; }

    /* ─── Full-screen stage ──────────────────────────────────── */
    /* z-index 1000 covers the top nav (top-strip ~50, toasts ~100) so the
     * collection drawer genuinely takes over the viewport; the backdrop is
     * opaque so the pending queue behind never peeks through. */
    .pf-drawer {
      position: fixed;
      top: var(--navbar-height, 4rem);
      right: 0;
      bottom: 0;
      left: 0;
      z-index: 1000;
      background:
        radial-gradient(60% 50% at 15% 5%, rgba(168, 85, 247, 0.22) 0%, transparent 55%),
        radial-gradient(55% 45% at 90% 95%, rgba(45, 212, 191, 0.18) 0%, transparent 55%),
        #04061a;
      display: flex; flex-direction: column;
      animation: pf-drawer-fade 0.22s ease both;
    }
    @keyframes pf-drawer-fade { from { opacity: 0; } to { opacity: 1; } }
    .pf-drawer__panel {
      width: 100%;
      flex: 1 1 auto;
      display: flex; flex-direction: column;
      animation: pf-drawer-zoom 0.28s cubic-bezier(0.2, 0.85, 0.3, 1) both;
      min-height: 0;
    }
    @keyframes pf-drawer-zoom { from { opacity: 0; transform: translateY(12px) scale(0.985); } to { opacity: 1; transform: none; } }

    .pf-drawer__head {
      display: flex; align-items: center; gap: 16px;
      padding: 28px 48px 20px;
      max-width: 1280px;
      width: 100%;
      margin: 0 auto;
    }
    .pf-drawer__close {
      all: unset; cursor: pointer;
      width: 40px; height: 40px; border-radius: 12px;
      display: inline-flex; align-items: center; justify-content: center;
      color: var(--text-secondary);
      background: rgba(255,255,255,0.03);
      border: 1px solid var(--glass-border);
      transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
    }
    .pf-drawer__close:hover { background: rgba(255,255,255,0.08); color: var(--text-primary); border-color: rgba(255,255,255,0.18); }

    .pf-drawer__who { flex: 1; min-width: 0; }
    .pf-drawer__name {
      margin: 0; font-weight: 700; font-size: 28px; letter-spacing: -0.02em;
      color: var(--text-primary);
      background: linear-gradient(180deg, var(--text-primary), rgba(255,255,255,0.6));
      -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;
    }
    .pf-drawer__meta { margin: 4px 0 0; font-size: 13px; color: var(--text-tertiary); font-family: 'JetBrains Mono', ui-monospace, monospace; letter-spacing: 0.02em; }

    .pf-drawer__progress {
      text-align: right;
      padding: 10px 18px;
      border-radius: 14px;
      background: rgba(255,255,255,0.03);
      border: 1px solid var(--glass-border);
      min-width: 120px;
    }
    .pf-drawer__progress-num { display: block; font-size: 30px; font-weight: 800; color: var(--text-primary); letter-spacing: -0.03em; line-height: 1; }
    .pf-drawer__progress-lbl { display: block; margin-top: 4px; font-size: 10px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.18em; font-weight: 600; }

    .pf-drawer__progressbar {
      margin: 0 auto;
      max-width: calc(1280px - 96px);
      width: calc(100% - 96px);
      height: 4px; border-radius: 999px;
      background: rgba(255,255,255,0.06); overflow: hidden;
    }
    .pf-drawer__progressbar > span {
      display: block; height: 100%; border-radius: 999px;
      background: linear-gradient(90deg, #a78bfa, #22d3ee);
      box-shadow: 0 0 14px rgba(45, 212, 191, 0.5);
      transition: width 0.45s cubic-bezier(0.2, 0.85, 0.3, 1);
    }

    .pf-drawer__hint {
      margin: 16px auto 0;
      max-width: calc(1280px - 96px);
      padding: 0 48px;
      font-size: 13px; color: var(--text-muted);
      text-align: center;
    }

    /* Tubes sit in a centred track. For 1-4 vials we use flex so they
     * genuinely centre across the screen instead of hugging the left column
     * of an auto-fill grid. 5+ wraps naturally. */
    .pf-drawer__tubes {
      flex: 1 1 auto; overflow-y: auto;
      padding: 28px 48px 32px;
      max-width: 1280px;
      width: 100%;
      margin: 0 auto;
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      align-content: flex-start;
      gap: 18px;
    }
    .pf-tube { width: min(320px, 100%); }

    .pf-tube {
      all: unset;
      position: relative;
      cursor: pointer;
      display: flex; flex-direction: column; align-items: center; gap: 14px;
      padding: 24px 18px 18px;
      background: linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.015));
      border: 1px solid var(--glass-border);
      border-radius: 24px;
      transition: border-color 0.2s ease, transform 0.15s ease, background 0.25s ease, box-shadow 0.25s ease;
      overflow: hidden;
      user-select: none;
      -webkit-tap-highlight-color: transparent;
    }
    /* Send every click through to the button itself. Without this, a tap on
     * the SVG vial / dept label / "Tap when drawn" pill is absorbed by the
     * child element and the parent button only registers the SECOND tap.
     * Single-tap collection was the whole point of this screen. */
    .pf-tube > * { pointer-events: none; }
    .pf-tube::before {
      content: '';
      position: absolute; inset: 0;
      background: radial-gradient(80% 60% at 50% 0%, var(--tube-color), transparent 70%);
      opacity: 0.08;
      pointer-events: none;
      transition: opacity 0.25s ease;
    }
    .pf-tube:hover:not([disabled]) {
      border-color: rgba(45, 212, 191, 0.55);
      box-shadow: 0 18px 50px rgba(0,0,0,0.4), 0 0 0 1px rgba(45, 212, 191, 0.15);
      transform: translateY(-2px);
    }
    .pf-tube:hover:not([disabled])::before { opacity: 0.14; }
    .pf-tube:active:not([disabled]) { transform: translateY(0) scale(0.99); }
    .pf-tube:focus-visible { outline: 2px solid rgba(45, 212, 191, 0.7); outline-offset: 2px; }
    .pf-tube[disabled] { cursor: wait; opacity: 0.75; }
    .pf-tube--done {
      background: linear-gradient(180deg, rgba(16, 185, 129, 0.1), rgba(16, 185, 129, 0.02));
      border-color: rgba(16, 185, 129, 0.45);
      box-shadow: 0 14px 40px rgba(16, 185, 129, 0.18);
    }
    .pf-tube--done::before {
      background: radial-gradient(80% 60% at 50% 0%, #10b981, transparent 70%);
      opacity: 0.12;
    }

    /* ─── Vial illustration ────────────────────────────────── */
    .pf-vial {
      width: 88px; height: 280px;
      flex-shrink: 0;
      filter: drop-shadow(0 22px 28px rgba(0,0,0,0.55));
    }
    /* Urine cup is short and wide — swap the vial's portrait box for a more
     * squat one so it doesn't get squeezed into a tall-narrow slot. */
    .pf-vial--cup { width: 150px; height: 236px; }
    .pf-vial__outline {
      fill: rgba(255,255,255,0.03);
      stroke: rgba(255,255,255,0.22);
      stroke-width: 1.2;
    }
    .pf-vial__blood { transition: y 0.75s cubic-bezier(0.25, 0.9, 0.25, 1); }
    .pf-vial__tick { animation: pf-tick-pop 0.35s cubic-bezier(0.2, 0.85, 0.3, 1) both; transform-origin: 62px 46px; }
    @keyframes pf-tick-pop {
      0%   { transform: scale(0.2); opacity: 0; }
      60%  { transform: scale(1.1); opacity: 1; }
      100% { transform: scale(1); opacity: 1; }
    }
    .pf-vial__cap { fill: var(--tube-color); }
    .pf-vial__cap-rim { fill: rgba(0,0,0,0.22); }
    .pf-vial__glass {
      fill: rgba(255,255,255,0.05);
      stroke: rgba(255,255,255,0.2);
      stroke-width: 0.8;
    }
    .pf-vial__blood {
      transition: y 0.6s cubic-bezier(0.2, 0.85, 0.3, 1);
    }
    .pf-vial__tick { animation: pf-tick-pop 0.3s cubic-bezier(0.2, 0.85, 0.3, 1) both; transform-origin: 44px 48px; }
    @keyframes pf-tick-pop {
      from { transform: scale(0.3); opacity: 0; }
      to { transform: scale(1); opacity: 1; }
    }

    .pf-tube__body {
      width: 100%;
      display: flex; flex-direction: column; align-items: center;
      gap: 3px;
      min-width: 0;
      position: relative;
    }
    .pf-tube__label {
      margin: 0;
      font-weight: 600; font-size: 15px;
      color: var(--text-primary);
      letter-spacing: -0.01em;
      text-align: center;
    }
    .pf-tube__dept {
      margin: 0;
      font-size: 9.5px;
      color: var(--tube-color, var(--text-tertiary));
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      text-transform: uppercase; letter-spacing: 0.22em; font-weight: 700;
      opacity: 0.85;
    }
    .pf-tube__tests {
      margin: 10px 0 0;
      font-size: 12.5px;
      color: var(--text-secondary);
      text-align: center;
      max-width: 100%;
      overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
    }
    .pf-tube__tests-more {
      display: inline-block;
      margin-left: 4px;
      padding: 1px 7px;
      border-radius: 999px;
      background: rgba(255,255,255,0.06);
      border: 1px solid var(--glass-border);
      color: var(--text-muted);
      font-size: 10.5px;
      font-weight: 600;
    }
    .pf-tube__code {
      margin: 4px 0 0;
      font-size: 10.5px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      color: var(--text-muted);
      letter-spacing: 0.06em;
    }
    .pf-tube__stamp {
      margin-top: 10px;
      display: inline-flex; align-items: center; gap: 6px;
      padding: 5px 11px; border-radius: 999px;
      font-size: 10.5px; font-weight: 600;
      color: #6ee7b7;
      background: rgba(16, 185, 129, 0.12);
      border: 1px solid rgba(16, 185, 129, 0.3);
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      letter-spacing: 0.06em;
    }
    .pf-tube__stamp--pending {
      color: var(--text-muted);
      background: rgba(255,255,255,0.02);
      border-color: var(--glass-border);
    }

    .pf-drawer__foot {
      display: flex; align-items: center; gap: 12px;
      padding: 18px 48px 28px;
      max-width: 1280px;
      width: 100%;
      margin: 0 auto;
      border-top: 1px solid var(--glass-border);
      background: linear-gradient(180deg, transparent, rgba(0,0,0,0.35));
    }
    /* Below the xl breakpoint the floating bottom-nav pill is visible and
       sits over the drawer footer. Push the footer up so the buttons clear
       the pill. At ≥1280px the nav is hidden and no extra room is needed. */
    @media (max-width: 1279px) {
      .pf-drawer__foot {
        padding-bottom: calc(28px + var(--tab-nav-total-height, 0px));
      }
    }
    .pf-drawer__foot .pf-btn-primary { margin-left: auto; min-width: 140px; }
    .pf-drawer__remaining {
      font-size: 12px; color: var(--text-muted);
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      margin-left: auto; margin-right: 8px;
    }
    .pf-drawer__done-stamp {
      display: inline-flex; align-items: center; gap: 8px;
      font-size: 13px; font-weight: 600;
      color: #6ee7b7;
      padding: 8px 14px; border-radius: 999px;
      background: rgba(16, 185, 129, 0.12);
      border: 1px solid rgba(16, 185, 129, 0.4);
      margin-left: auto; margin-right: 8px;
    }

    .hidden { display: none; }

    /* Tube-label print block: never shown on screen (it lives inside the
       drawer purely so barcode/QR render). The global body.pf-printing-label
       rule + this @media print flip reveal it only while printing. */
    .pf-sc-labels { display: none; }
    @media print { .pf-sc-labels { display: block; } }

    /* Footer action buttons: the inline-SVG icon is hidden everywhere by
       default so desktop (>=641px) keeps the existing TEXT buttons exactly as
       before. The phone media query below flips this — text out, icon in. */
    .pf-drawer__foot .pf-btn__icon { display: none; }

    /* ─── Reject-with-reason modal ─────────────────────────── */
    .pf-rej {
      position: fixed; inset: 0; z-index: 1100;
      background: rgba(4, 6, 18, 0.78);
      backdrop-filter: blur(10px);
      display: flex; align-items: center; justify-content: center;
      padding: 20px;
      animation: pf-drawer-fade 0.2s ease both;
    }
    .pf-rej__panel {
      width: min(540px, 100%);
      background: var(--bg-primary, #0a0f1f);
      border: 1px solid var(--glass-border);
      border-radius: 22px;
      padding: 22px 24px 20px;
      box-shadow: 0 30px 80px rgba(0,0,0,0.5);
      animation: pf-drawer-zoom 0.22s cubic-bezier(0.2, 0.85, 0.3, 1) both;
    }
    .pf-rej__title { margin: 0; font-size: 18px; font-weight: 700; color: var(--text-primary); letter-spacing: -0.01em; }
    .pf-rej__sub { margin: 4px 0 14px; font-size: 12.5px; color: var(--text-tertiary); }
    .pf-rej__chips {
      display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px;
    }
    .pf-rej__chip {
      all: unset; cursor: pointer;
      padding: 9px 14px; border-radius: 999px;
      font-size: 12.5px; font-weight: 600;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      color: var(--text-secondary);
      transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
    }
    .pf-rej__chip:hover { border-color: rgba(244, 114, 182, 0.45); }
    .pf-rej__chip--on {
      background: rgba(244, 63, 94, 0.18);
      border-color: rgba(244, 63, 94, 0.55);
      color: #fda4af;
    }
    .pf-rej__label {
      display: block; margin: 8px 0 4px;
      font-size: 10.5px; font-weight: 700; letter-spacing: 0.16em;
      text-transform: uppercase; color: var(--text-muted);
    }
    .pf-rej__note { width: 100%; resize: vertical; min-height: 48px; }
    .pf-rej__foot { display: flex; justify-content: flex-end; gap: 10px; margin-top: 16px; }

    :host-context([data-theme="light"]) .pf-rej {
      background: rgba(15, 23, 42, 0.55);
    }
    :host-context([data-theme="light"]) .pf-rej__panel {
      background: #ffffff;
    }
    :host-context([data-theme="light"]) .pf-rej__chip--on {
      background: rgba(244, 63, 94, 0.1);
      color: #be123c;
    }

    @media (max-width: 640px) {
      .pf-drawer__head { padding: 18px 20px 12px; flex-wrap: wrap; }
      .pf-drawer__progressbar { margin: 0 20px; }
      .pf-drawer__hint { margin: 12px 20px 0; }
      .pf-drawer__foot { padding: 14px 20px calc(20px + var(--tab-nav-total-height, 0px)); flex-wrap: wrap; }
      .pf-drawer__name { font-size: 22px; }

      /* ── Compact mobile tiles ──
       * One tile per row, row-layout inside: a small vial glyph on the
       * left so the cap colour stays recognisable at a glance, label /
       * dept / tests in the middle, and a teal "Tap when drawn" pill on
       * the right that reads as an action target. Each tile is ~96px
       * tall so a typical 2-3 tube order fits on a single iPhone screen
       * with no horizontal swipe. iPad / desktop unchanged. */
      /* A single full-width column. The base layout is flex-wrap +
         justify-content:center, which just centres a content-sized
         tile — leaving the tube narrow and clipping the stamp pill.
         flex-direction:column + the default align-items:stretch makes
         every tube fill the width with no reliance on width:100%. */
      .pf-drawer__tubes {
        padding: 14px 16px 22px;
        flex-direction: column;
        flex-wrap: nowrap;
        align-items: stretch;
        justify-content: flex-start;
        gap: 10px;
      }

      /* Full-width row tile: fixed-size vial illustration on the LEFT, a
         flexible (min-width:0) LEFT-aligned text column on the right. The
         tile fills the drawer width (see the width-enforcing block lower
         down) — never a centred ~60% card. */
      .pf-tube {
        flex-direction: row;
        align-items: center;
        gap: 14px;
        padding: 14px 16px;
        width: 100%;
        text-align: left;
      }
      .pf-vial {
        /* Compact glance icon at a FIXED size on the left — cap colour +
           fill stay readable while the row height stays thumb-friendly. */
        width: 44px; height: 132px;
        flex-shrink: 0;
        align-self: center;
      }
      .pf-vial--cup { width: 74px; height: 108px; }

      .pf-tube__body {
        flex: 1 1 auto;
        min-width: 0;          /* allow the body to shrink below its content */
        align-items: flex-start;
        text-align: left;
        gap: 2px;
      }
      .pf-tube__label  { font-size: 15px; text-align: left; line-height: 1.25; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      /* Dept label ("BIOCHEMISTRY") shown IN FULL — it's short, so let it
         wrap rather than truncate. Trimmed letter-spacing so the common
         names fit on a single line on the full-width tile. */
      .pf-tube__dept   {
        font-size: 9.5px;
        text-align: left;
        max-width: 100%;
        white-space: normal;
        overflow-wrap: anywhere;
        letter-spacing: 0.14em;
        line-height: 1.4;
      }
      /* Test name may ellipsis to a single line if long. */
      .pf-tube__tests  {
        margin: 4px 0 0;
        font-size: 12px;
        text-align: left;
        max-width: 100%;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
      }
      /* Barcode is decorative on the compact card — the cap colour and
         label already disambiguate. Hide it to give the action stamp
         room and keep each tile under ~90px tall. */
      .pf-tube__code { display: none; }

      /* Action stamp: small teal pill on its own line at the end of the
         body. It used to be position:absolute, but .pf-tube__body is
         position:relative — so the stamp anchored INSIDE the body and
         overlapped the label/dept/tests text. Keeping it in normal flow
         (left-aligned, below the tests) is overlap-proof. The whole
         tile is still the click target — the pill just telegraphs it. */
      /* The status pill ("Tap when drawn" / collected time) sits on its OWN
         line beneath the text column, LEFT-aligned and sized to its content
         (not stretched across the tile, not clipped off the right edge). The
         whole tile remains the tap target — the pill just telegraphs it. */
      .pf-tube__stamp {
        position: static;
        align-self: flex-start;
        width: auto;
        max-width: 100%;
        box-sizing: border-box;
        justify-content: flex-start;
        margin-top: 8px;
        min-height: 30px;
        padding: 7px 12px;
        font-size: 10.5px;
        font-weight: 600;
        white-space: nowrap;
        letter-spacing: 0.04em;
      }
      .pf-tube__stamp--pending {
        background: rgba(45, 212, 191, 0.14);
        border-color: rgba(45, 212, 191, 0.45);
        color: #5eead4;
      }
    }
    /* Tablet (iPad Mini / Air landscape, iPad portrait) and any shorter
       viewport — collapse the vial tile + paddings so the whole collect
       drawer fits the viewport in one screen with no internal scroll.
       Desktop monitors above ~1180px keep the spacious original layout.   */
    @media (min-width: 641px) and (max-width: 1180px),
           (min-width: 641px) and (max-height: 820px) {
      .pf-drawer__head { padding: 14px 28px 10px; }
      .pf-drawer__name { font-size: 22px; }
      .pf-drawer__progress { padding: 8px 14px; min-width: 96px; }
      .pf-drawer__progress-num { font-size: 24px; }
      .pf-drawer__progressbar { width: calc(100% - 56px); }
      .pf-drawer__hint { margin: 6px auto 0; padding: 0 28px; font-size: 11.5px; }

      /* Kill the internal scroll. The flex column above already gives this
         row a finite height; we just need the children to compress. */
      .pf-drawer__tubes {
        overflow: hidden;
        padding: 10px 28px 10px;
        gap: 12px;
        align-content: center;
        flex-wrap: nowrap;
      }

      .pf-tube {
        width: min(180px, 100%);
        flex: 1 1 0;
        max-width: 220px;
        padding: 12px 10px 10px;
        gap: 6px;
        border-radius: 16px;
        overflow: visible;          /* let any sub-pixel vial overflow show, no clipping */
      }
      /* Heights derived from viewport height so they always fit. The clamp
         floor stays large enough to read, the ceiling caps growth on tall
         desktops. Cup is shorter natively so its ceiling is lower. */
      .pf-vial      { width: 52px;  height: clamp(120px, 24dvh, 180px); }
      .pf-vial--cup { width: 96px;  height: clamp(110px, 22dvh, 170px); }

      .pf-tube__label { font-size: 12.5px; }
      .pf-tube__dept  { font-size: 8px; letter-spacing: 0.16em; }
      .pf-tube__tests { margin: 3px 0 0; font-size: 11px; }
      .pf-tube__code  { font-size: 9.5px; }
      .pf-tube__stamp { padding: 4px 9px; font-size: 9.5px; }

      .pf-drawer__foot {
        padding: 10px 28px calc(12px + var(--tab-nav-total-height, 0px));
      }
      .pf-drawer__foot .pf-btn-primary { min-width: 120px; }
    }

    /* iPhone SE / iPhone 14 — even tighter padding so the patient name
       and progress chip both fit in the header without wrapping into a
       column. The rack max-width also shrinks so 4+ tube chips don't
       overflow the order card. */
    @media (max-width: 400px) {
      .pf-drawer__head { padding: 14px 12px 10px; gap: 10px; }
      .pf-drawer__progressbar { margin: 0 12px; }
      .pf-drawer__hint { margin: 10px 12px 0; }
      .pf-drawer__tubes { padding: 14px 12px 20px; }
      .pf-drawer__foot { padding: 12px 12px calc(16px + var(--tab-nav-total-height, 0px)); }
      .pf-drawer__name { font-size: 19px; }
      .pf-drawer__progress { padding: 8px 12px; min-width: 0; }
      .pf-drawer__progress-num { font-size: 22px; }
      .pf-sc__rack { max-width: 96px; }
    }

    /* ─── Light mode overrides ──────────────────────────────
     * Dark mode is tuned for deep navy; light mode needs
     * inverted reflections, softer shadows, and a brighter
     * backdrop so the vials don't float on a muddy wash. */
    :host-context([data-theme="light"]) .pf-sc__card {
      background: #ffffff;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.05);
    }
    :host-context([data-theme="light"]) .pf-sc__card:hover {
      background: #fdf5ff;
      box-shadow: 0 12px 28px rgba(99, 102, 241, 0.14);
    }
    :host-context([data-theme="light"]) .pf-sc__rack {
      background: rgba(15, 23, 42, 0.05);
    }
    :host-context([data-theme="light"]) .pf-sc__chip {
      box-shadow: inset 0 -2px 0 rgba(0,0,0,0.12), inset 0 2px 0 rgba(255,255,255,0.5);
    }
    :host-context([data-theme="light"]) .pf-sc__count {
      background: rgba(124, 58, 237, 0.1);
      color: #6d28d9;
      border-color: rgba(124, 58, 237, 0.3);
    }
    :host-context([data-theme="light"]) .pf-sc__count--progress {
      background: rgba(245, 158, 11, 0.14);
      color: #b45309;
      border-color: rgba(245, 158, 11, 0.4);
    }
    :host-context([data-theme="light"]) .pf-scan {
      background: linear-gradient(180deg, rgba(139, 92, 246, 0.1), rgba(168, 85, 247, 0.06));
      border-color: rgba(124, 58, 237, 0.4);
      box-shadow: 0 8px 24px rgba(139, 92, 246, 0.08);
    }
    :host-context([data-theme="light"]) .pf-scan__btn {
      color: #fff;
    }

    :host-context([data-theme="light"]) .pf-drawer {
      background:
        radial-gradient(60% 50% at 15% 5%, rgba(168, 85, 247, 0.12) 0%, transparent 55%),
        radial-gradient(55% 45% at 90% 95%, rgba(45, 212, 191, 0.1) 0%, transparent 55%),
        #f5f7fb;
    }
    :host-context([data-theme="light"]) .pf-drawer__close {
      background: rgba(15, 23, 42, 0.03);
    }
    :host-context([data-theme="light"]) .pf-drawer__close:hover {
      background: rgba(15, 23, 42, 0.07);
    }
    :host-context([data-theme="light"]) .pf-drawer__name {
      background: linear-gradient(180deg, var(--text-primary), rgba(15, 23, 42, 0.55));
      -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;
    }
    :host-context([data-theme="light"]) .pf-drawer__progress {
      background: rgba(15, 23, 42, 0.03);
    }
    :host-context([data-theme="light"]) .pf-drawer__progressbar {
      background: rgba(15, 23, 42, 0.06);
    }
    :host-context([data-theme="light"]) .pf-drawer__progressbar > span {
      box-shadow: 0 0 10px rgba(45, 212, 191, 0.4);
    }
    :host-context([data-theme="light"]) .pf-drawer__foot {
      background: linear-gradient(180deg, transparent, rgba(15, 23, 42, 0.04));
    }

    :host-context([data-theme="light"]) .pf-tube {
      background: linear-gradient(180deg, rgba(255,255,255,0.85), rgba(255,255,255,0.55));
    }
    :host-context([data-theme="light"]) .pf-tube::before { opacity: 0.1; }
    :host-context([data-theme="light"]) .pf-tube:hover:not([disabled]) {
      box-shadow: 0 18px 46px rgba(15, 23, 42, 0.12), 0 0 0 1px rgba(45, 212, 191, 0.2);
    }
    :host-context([data-theme="light"]) .pf-tube:hover:not([disabled])::before { opacity: 0.16; }
    :host-context([data-theme="light"]) .pf-tube--done {
      background: linear-gradient(180deg, rgba(16, 185, 129, 0.12), rgba(255,255,255,0.7));
      border-color: rgba(16, 185, 129, 0.45);
      box-shadow: 0 14px 40px rgba(16, 185, 129, 0.14);
    }

    /* Vial glass + streak for light mode. Real vacutainers on a white
     * counter read as darker outlines with lighter internal reflections,
     * not white ghosts. */
    :host-context([data-theme="light"]) .pf-vial {
      filter: drop-shadow(0 14px 22px rgba(15, 23, 42, 0.22));
    }
    :host-context([data-theme="light"]) .pf-vial__outline {
      fill: rgba(255, 255, 255, 0.7);
      stroke: rgba(15, 23, 42, 0.22);
    }
    :host-context([data-theme="light"]) .pf-vial rect[fill*="glass-"],
    :host-context([data-theme="light"]) .pf-vial path[fill*="glass-"] {
      opacity: 0.7;
    }

    :host-context([data-theme="light"]) .pf-tube__stamp--pending {
      color: #64748b;
      background: rgba(15, 23, 42, 0.03);
      border-color: rgba(15, 23, 42, 0.1);
    }
    :host-context([data-theme="light"]) .pf-tube__stamp {
      color: #047857;
      background: rgba(16, 185, 129, 0.1);
      border-color: rgba(16, 185, 129, 0.3);
    }
    :host-context([data-theme="light"]) .pf-tube__code {
      color: #64748b;
    }
    :host-context([data-theme="light"]) .pf-tube__tests-more {
      background: rgba(15, 23, 42, 0.05);
      border-color: rgba(15, 23, 42, 0.1);
    }

    :host-context([data-theme="light"]) .pf-drawer__done-stamp {
      background: rgba(16, 185, 129, 0.12);
      color: #047857;
      border-color: rgba(16, 185, 129, 0.4);
    }

    :host-context([data-theme="light"]) .pf-sc__vial {
      box-shadow: inset 0 -2px 0 rgba(0,0,0,0.12);
    }

    :host-context([data-theme="light"]) .pf-sc__scan {
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06);
    }
    :host-context([data-theme="light"]) .pf-sc__scan-input {
      background: #fff;
      box-shadow: inset 0 1px 2px rgba(15, 23, 42, 0.04);
    }
    :host-context([data-theme="light"]) .pf-sc__scan-input:focus {
      box-shadow: 0 0 0 3px rgba(45, 212, 191, 0.2), inset 0 1px 2px rgba(15, 23, 42, 0.04);
    }

    :host-context([data-theme="light"]) .pf-sc__match {
      background: rgba(45, 212, 191, 0.1);
      border-color: rgba(20, 184, 166, 0.5);
    }
    :host-context([data-theme="light"]) .pf-sc__vials {
      background: rgba(15, 23, 42, 0.04);
    }

    /* ── Mobile vial-tile width — appended last so no earlier rule or
       cascade quirk can suppress it. Each tile MUST span the full drawer
       width (like the queue list cards), never a centred ~60% card —
       otherwise the body squeezes and the stamp pill clips. */
    @media (max-width: 640px) {
      .pf-drawer__tubes {
        flex-direction: column !important;
        flex-wrap: nowrap !important;
        align-items: stretch !important;
        justify-content: flex-start !important;
      }
      .pf-drawer__tubes .pf-tube {
        width: 100% !important;       /* beats base width:min(320px,100%) */
        max-width: 100% !important;   /* no narrow cap */
        align-self: stretch !important;
        margin-left: 0 !important;    /* no auto-centring */
        margin-right: 0 !important;
        box-sizing: border-box !important;
      }
    }

    /* ─── Cross-platform additive overrides (ADD ONLY — desktop ≥1280px
       and the existing rules above are untouched) ───────────────────── */

    /* Phone: the scan strip packs an icon button, the input body, a "Scan"
       button and a "Find" button into one non-wrapping flex row. Below
       ~440px those four children fight for room and the input collapses or
       the action buttons overflow the card edge. Re-flow into two rows:
       icon + input on top, the two actions stretched underneath as full
       44px+ tap targets. Desktop/iPad row layout is unaffected. */
    @media (max-width: 640px) {
      .pf-scan {
        flex-wrap: wrap;
        gap: 12px;
        padding: 14px;
      }
      .pf-scan__icon-btn { align-self: center; }
      .pf-scan__body { flex: 1 1 140px; }
      /* Phone: collapse Scan + Find to icon-only squares (>=44px tap target). */
      .pf-scan__cam,
      .pf-scan__btn {
        flex: 0 0 auto;
        align-self: center;
        width: 46px; min-width: 46px; height: 46px; padding: 0;
        justify-content: center;
      }
      .pf-scan__cam-txt, .pf-scan__btn-txt { display: none; }
      .pf-scan__find-ic { display: inline-flex; }
      /* Header Refresh → icon-only on phones. */
      .pf-refresh-txt { display: none; }
      /* Push the two actions onto their own row below the input. */
      .pf-scan__cam { order: 2; }
      .pf-scan__btn { order: 3; }
      .pf-scan__icon-btn { order: 0; }
      .pf-scan__body { order: 1; }

      /* Loading stub: use dynamic viewport height so it doesn't jump when
         mobile browser chrome shows/hides. */
      .pf-sc__loading { min-height: 60dvh; }

      /* The queue grid's minimum track is 400px (auto-fill minmax(400px,1fr)),
         which is wider than most phones (iPhone SE 375px, iPhone 14 390px) and
         forces horizontal page overflow. Collapse to a single shrinkable
         column on phones so the cards fit with no sideways scroll. Tablet /
         desktop (>=641px) keep the original multi-column auto-fill layout. */
      .pf-sc__list { grid-template-columns: minmax(0, 1fr); }
    }

    /* Touch (coarse pointer): make the order-card tap target comfortable and
       keep the reject chips at a 44px touch height. Pointer-fine desktop is
       unaffected. */
    @media (pointer: coarse) {
      .pf-sc__card { padding-top: 14px; padding-bottom: 14px; }
      .pf-rej__chip { padding-top: 12px; padding-bottom: 12px; }
      /* Keep textarea at 16px so iOS Safari doesn't zoom the viewport on
         focus (the shared .pf-input may set a smaller size). */
      .pf-rej__note { font-size: 16px; }
      /* Drawer close button: 40px is below the 44px touch minimum. */
      .pf-drawer__close { width: 44px; height: 44px; }
    }

    /* Touch devices with no real hover: neutralise the lift/translate hover
       states so they don't "stick" after a tap (the card/tube keep their
       :active + :focus-visible feedback, which is what matters on touch).
       Desktop with a real pointer keeps the full hover treatment. */
    @media (hover: none) {
      .pf-sc__card:hover {
        border-color: var(--glass-border);
        background: var(--glass-bg);
        box-shadow: none;
      }
      .pf-tube:hover:not([disabled]) {
        transform: none;
        border-color: var(--glass-border);
        box-shadow: none;
      }
      .pf-tube:hover:not([disabled])::before { opacity: 0.08; }
    }

    /* Capacitor native: the collect drawer is teleported to <body> and is
       position:fixed with its own top offset (var(--navbar-height)). The
       global top safe-area is absorbed on body, but this page's own fixed
       chrome still needs the notch inset so the close button / patient name
       don't sit under the status bar. Add it only on native. */
    :host-context(html.cap-native) .pf-drawer {
      top: calc(var(--navbar-height, 4rem) + env(safe-area-inset-top));
    }
    :host-context(html.cap-native) .pf-drawer__head {
      padding-left: calc(48px + env(safe-area-inset-left));
      padding-right: calc(48px + env(safe-area-inset-right));
    }
    @media (max-width: 640px) {
      :host-context(html.cap-native) .pf-drawer__head {
        padding-left: calc(20px + env(safe-area-inset-left));
        padding-right: calc(20px + env(safe-area-inset-right));
      }
    }

    /* Phone (<=640px): collapse the footer action buttons to ICON-ONLY squares
       to save space. Each keeps its full text in aria-label (a11y) and shows a
       press-and-hold tooltip via data-label + :active::after — no JS/state.
       The "Undo dispatch" button + status stamps are intentionally left as-is.
       Desktop (>=641px) is untouched: text buttons, icons display:none. */
    @media (max-width: 640px) {
      .pf-drawer__foot .pf-btn {
        position: relative;          /* anchor for the press tooltip */
        width: 46px;                 /* >=44px tap target */
        min-width: 46px;             /* beats .pf-btn-primary's min-width:140px */
        height: 46px;
        padding: 0;
        flex: 0 0 auto;
        gap: 0;
      }
      .pf-drawer__foot .pf-btn__text { display: none; }
      .pf-drawer__foot .pf-btn__icon { display: inline-flex; }

      /* Press-and-hold tooltip: a small dark pill above the held button. */
      .pf-drawer__foot .pf-btn[data-label]:active::after {
        content: attr(data-label);
        position: absolute;
        bottom: calc(100% + 8px);
        left: 50%;
        transform: translateX(-50%);
        white-space: nowrap;
        padding: 5px 9px;
        border-radius: 8px;
        background: rgba(4, 6, 18, 0.95);
        border: 1px solid var(--glass-border);
        color: var(--text-primary);
        font-size: 11px; font-weight: 600; letter-spacing: 0.02em;
        box-shadow: 0 6px 18px rgba(0,0,0,0.4);
        pointer-events: none;
        z-index: 10;
      }

      :host-context([data-theme="light"]) .pf-drawer__foot .pf-btn[data-label]:active::after {
        background: rgba(255, 255, 255, 0.98);
        color: #0f172a;
        box-shadow: 0 6px 18px rgba(15, 23, 42, 0.2);
      }
    }

    /* ─────────────────────────────────────────────────────────────────
       AUTHORITATIVE phone vial-card layout (LAST = wins). Successive passes
       layered several @media(max-width:640px) blocks; this single block,
       placed last and scoped under .pf-drawer__tubes (so it out-specifies the
       base .pf-tube/.pf-vial rules), is the source of truth for the phone tile:
       a FULL-WIDTH row — fixed vial on the left, left-aligned text column,
       dept shown in full, status pill on its own line, nothing clipped.
       >=641px is untouched (gated to <=640). ───────────────────────────── */
    @media (max-width: 640px) {
      .pf-drawer__tubes {
        flex-direction: column !important;
        flex-wrap: nowrap !important;
        align-items: stretch !important;
        justify-content: flex-start !important;
        max-width: 100% !important;
        gap: 10px !important;
      }
      .pf-drawer__tubes .pf-tube {
        width: 100% !important;
        max-width: 100% !important;
        margin: 0 !important;
        flex-direction: row !important;
        align-items: center !important;
        gap: 14px !important;
        padding: 14px 16px !important;
        text-align: left !important;
      }
      .pf-drawer__tubes .pf-vial {
        width: 40px !important;
        height: 120px !important;
        flex: 0 0 auto !important;
      }
      .pf-drawer__tubes .pf-vial--cup {
        width: 64px !important;
        height: 100px !important;
      }
      .pf-drawer__tubes .pf-tube__body {
        flex: 1 1 auto !important;
        min-width: 0 !important;
        align-items: flex-start !important;
        text-align: left !important;
        gap: 2px !important;
      }
      .pf-drawer__tubes .pf-tube__dept {
        white-space: normal !important;
        overflow: visible !important;
        text-overflow: clip !important;
        max-width: 100% !important;
        letter-spacing: 0.12em !important;
      }
      .pf-drawer__tubes .pf-tube__stamp {
        position: static !important;
        align-self: flex-start !important;
        width: auto !important;
        max-width: 100% !important;
        justify-content: flex-start !important;
        margin-top: 8px !important;
      }
    }

  `]
})
export class SampleCollectionComponent implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly toasts = inject(ToastService);
  private readonly dialog = inject(DialogService);

  /** Whether this user can dispatch (hand collected tubes to the lab). */
  readonly canDispatch = computed(() => this.auth.hasPermission('dispatch_sample'));
  private readonly _dispatching = signal(false);
  readonly dispatching = this._dispatching.asReadonly();

  /** True once every tube on the order has moved past 'collected' (dispatched
   *  or further) — used to flip the UI from "collected" to "dispatched". */
  isDispatched(g: OrderGroup): boolean {
    const done = ['dispatched', 'picked_up', 'received', 'completed'];
    return g.samples.length > 0 && g.samples.every(s => done.includes(s.status));
  }

  /** Mark every collected tube on this order as dispatched to the lab. */
  async dispatchOrder(g: OrderGroup) {
    if (this._dispatching()) return;
    this._dispatching.set(true);
    try {
      await firstValueFrom(this.api.patch(`/api/orders/${g.orderId}/dispatch`, {}));
      // Reflect dispatched status locally so the drawer shows "Dispatched"
      // without a round-trip (pending-collection wouldn't return these anymore).
      this._pending.update(list => list.map(s =>
        s.orderId === g.orderId && s.status === 'collected' ? { ...s, status: 'dispatched' } : s));
      this.toasts.success('Dispatched to lab');
    } catch {
      this.toasts.error('Could not dispatch — try again');
    } finally {
      this._dispatching.set(false);
    }
  }

  /** Undo dispatch — revert dispatched tubes back to collected (only while the
   *  lab hasn't received them). */
  async undispatchOrder(g: OrderGroup) {
    if (this._dispatching()) return;
    this._dispatching.set(true);
    try {
      await firstValueFrom(this.api.patch(`/api/orders/${g.orderId}/undispatch`, {}));
      this._pending.update(list => list.map(s =>
        s.orderId === g.orderId && s.status === 'dispatched' ? { ...s, status: 'collected' } : s));
      this.toasts.success('Dispatch undone');
    } catch {
      this.toasts.error('Could not undo — the lab may have received it');
    } finally {
      this._dispatching.set(false);
    }
  }
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  // Set when the user lands here from another screen via ?orderId=… (e.g. FD's
  // "Collect Sample" button). On close, we send them back to that origin
  // instead of leaving them stranded on the queue.
  private _returnTo: string | null = null;

  @ViewChild('drawerEl') private drawerRef?: ElementRef<HTMLElement>;
  private teleportedEl: HTMLElement | null = null;

  constructor() {
    // The shell component forms a stacking context (z-index: 1) and the
    // top-strip inside it sits at z-index: 40 — as a sibling of the router
    // outlet, that top-strip paints above anything nested inside the outlet,
    // regardless of its own z-index. So we move the drawer element to
    // <body> whenever it opens; that escapes the stacking context and lets
    // the full-screen overlay actually cover the nav.
    effect(() => {
      const hasDrawer = !!this.activeGroup();
      if (!hasDrawer) {
        this.detachTeleport();
        return;
      }
      // Wait a frame for @if to render the element before reparenting.
      queueMicrotask(() => {
        const el = this.drawerRef?.nativeElement;
        if (el && el.parentNode !== document.body) {
          document.body.appendChild(el);
          this.teleportedEl = el;
        }
      });
    });
  }

  ngOnDestroy() { this.detachTeleport(); }

  private detachTeleport() {
    if (this.teleportedEl && this.teleportedEl.parentNode === document.body) {
      document.body.removeChild(this.teleportedEl);
    }
    this.teleportedEl = null;
  }

  protected readonly scanValue = signal('');
  protected readonly searching = signal(false);
  protected readonly scannerOpen = signal(false);
  private readonly _pending = signal<OrderSample[]>([]);
  private readonly _openOrderId = signal<string | null>(null);
  /** True when the user landed here via ?orderId=… (e.g. FD's "Collect"
   *  button on an order row). Suppresses the queue list + scan row so
   *  the page reads as a direct order-collection view, not a queue +
   *  popup. Set once in ngOnInit and not cleared until navigation. */
  private readonly _deepLinkMode = signal<boolean>(false);
  readonly deepLinkMode = this._deepLinkMode.asReadonly();
  protected readonly REJECT_REASONS: ReadonlyArray<{ code: string; label: string }> = [
    { code: 'refused',      label: 'Patient refused' },
    { code: 'fainted',      label: 'Patient fainted' },
    { code: 'no_vein',      label: 'Vein not found' },
    { code: 'insufficient', label: 'Insufficient sample' },
    { code: 'wrong_tube',   label: 'Wrong tube' },
    { code: 'other',        label: 'Other' }
  ];
  protected readonly _rejectModal = signal<{ group: OrderGroup; reason: string; note: string } | null>(null);

  readonly pending = this._pending.asReadonly();
  readonly openOrderId = this._openOrderId.asReadonly();

  readonly groups = computed<OrderGroup[]>(() => {
    const byOrder = new Map<string, OrderGroup>();
    for (const s of this._pending()) {
      let g = byOrder.get(s.orderId);
      if (!g) {
        const p = s.order?.patient;
        const meta = [
          p?.sex,
          p?.age != null ? `${p.age}y` : null,
          `#${s.orderId.slice(0, 8)}`
        ].filter(Boolean).join(' · ');
        g = {
          orderId: s.orderId,
          patientName: p?.displayName ?? 'Patient',
          patientMeta: meta,
          createdAt: s.createdAt,
          samples: [],
          totalVials: 0,
          collected: 0
        };
        byOrder.set(s.orderId, g);
      }
      g.samples.push(s);
      g.totalVials++;
      if (s.status !== 'pending') g.collected++;
    }
    return Array.from(byOrder.values())
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  });

  /** Same as groups() but filtered by the live search box. Empty input shows all. */
  readonly filteredGroups = computed<OrderGroup[]>(() => {
    const q = this.scanValue().trim().toLowerCase();
    if (!q) return this.groups();
    return this.groups().filter(g => {
      if (g.patientName.toLowerCase().includes(q)) return true;
      if (g.orderId.toLowerCase().startsWith(q.replace(/^#/, ''))) return true;
      return g.samples.some(s =>
        (s.barcode ?? '').toLowerCase().includes(q) ||
        (s.order?.patient?.phone ?? '').includes(this.scanValue().trim()) ||
        (s.order?.patient?.mrn ?? '').toLowerCase().includes(q)
      );
    });
  });

  // The group currently shown in the drawer, kept in sync with live refreshes.
  readonly activeGroup = computed<OrderGroup | null>(() => {
    const id = this._openOrderId();
    if (!id) return null;
    return this.groups().find(g => g.orderId === id) ?? null;
  });

  async ngOnInit() {
    const oid = this.route.snapshot.queryParamMap.get('orderId');
    if (oid) {
      this._openOrderId.set(oid);
      this._deepLinkMode.set(true);
      // Honour an explicit ?from=… if the caller passes one (e.g. lab dispatch
      // counter), otherwise default deep-links back to /frontdesk since that's
      // the only screen that links here today.
      const from = this.route.snapshot.queryParamMap.get('from');
      this._returnTo = from && from.startsWith('/') ? from : '/frontdesk';
    }

    // /pending-collection only returns samples currently in pending status.
    // When deep-linked from FD's "Collect Sample" button (?orderId=…), fetch
    // the order directly and merge any missing samples in so the drawer can
    // render its tubes regardless of where the order is in the lifecycle.
    try {
      const list = await firstValueFrom(this.api.get<OrderSample[]>('/api/samples/pending-collection'));
      let merged: OrderSample[] = list ?? [];
      if (oid) {
        try {
          const order = await firstValueFrom(this.api.get<Order>(`/api/orders/${oid}`));
          if (order?.samples?.length) {
            const have = new Set(merged.map(s => s.id));
            const extras = order.samples
              .filter(s => !have.has(s.id))
              .map(s => ({ ...s, order } as OrderSample));
            if (extras.length) merged = [...merged, ...extras];
          }
        } catch { /* leave list as-is, drawer will be empty */ }
      }
      this._pending.set(merged);
    } catch {
      this._pending.set([]);
    }
  }

  tube(s: OrderSample) { return containerFor(s); }
  container(s: OrderSample) { return containerFor(s); }
  testList(s: OrderSample): string {
    return s.tests.map(t => t.test?.name ?? 'Test').join(', ');
  }

  openOrder(id: string) { this._openOrderId.set(id); }

  /** Open a specific order's collection drawer (e.g. from a scanned order QR).
   *  Best-effort merges the order's samples in case they aren't in the pending
   *  list (already collected / different lifecycle). */
  async openOrderById(id: string) {
    this._openOrderId.set(id);
    this.scanValue.set('');
    try {
      const order = await firstValueFrom(this.api.get<Order>(`/api/orders/${id}`));
      if (order?.samples?.length) {
        const have = new Set(this._pending().map(s => s.id));
        const extras = order.samples.filter(s => !have.has(s.id)).map(s => ({ ...s, order } as OrderSample));
        if (extras.length) this._pending.update(cur => [...cur, ...extras]);
      }
    } catch { /* drawer still shows any pending samples for this order */ }
  }

  /** Resolve a scanned order QR / URL / GUID / invoice number to an order and
   *  open it. Uses the collector-accessible resolve endpoint. */
  private resolveOrderCode(code: string) {
    this.api.get<{ orderId: string }>(`/api/orders/resolve?code=${encodeURIComponent(code)}`).subscribe({
      next: r => { if (r?.orderId) this.openOrderById(r.orderId); else this.toasts.warning('No matching order for that scan.'); },
      error: () => this.toasts.warning('No matching order for that scan.')
    });
  }
  close() {
    this._openOrderId.set(null);
    // Deep-linked from another screen (FD "Collect Sample") — return there
    // rather than leaving the user on an unrelated queue.
    if (this._returnTo) {
      const target = this._returnTo;
      this._returnTo = null;
      this.router.navigateByUrl(target);
      return;
    }
    // Refresh once the drawer is gone so the pending queue outside drops any
    // orders that are now fully collected. While the drawer is open we never
    // re-fetch from the server — pending-collection omits drawn samples, and
    // reading that list would make just-tapped vials vanish mid-flow.
    this.refresh();
  }

  refresh() {
    this.api.get<OrderSample[]>('/api/samples/pending-collection').subscribe({
      next: l => this._pending.set(l ?? [])
    });
  }

  /** Print every tube label for this order (barcode + QR). The hidden
   *  `.pf-print-label` block in the drawer already holds the rendered labels;
   *  `printLabelOnly()` toggles the global label-print stylesheet so ONLY those
   *  labels reach paper — nothing else on the screen prints. */
  printLabels(g: OrderGroup) {
    if (!g.samples.length) { this.toasts.warning('No tubes to label'); return; }
    printLabelOnly();
  }

  openScanner() { this.scannerOpen.set(true); }
  onScanMatched(code: string) {
    this.scannerOpen.set(false);
    this.scanValue.set(code);
    this.runSearch();
  }

  /**
   * Free-text search: live-filters the local pending list while typing,
   * then on Enter (or Find click) does an exact-barcode lookup if the input
   * looks like a code (e.g. starts with "PF-"). Patient name / phone / order
   * id matches are handled in-memory against `groups()` since the backend
   * already streams every pending order to this screen.
   */
  onSearchInput(v: string) { this.scanValue.set(v); }

  runSearch() {
    const raw = this.scanValue().trim();
    if (!raw) return;

    // Filter the visible queue — works for name, phone, order-id prefix.
    const matches = this.matchGroups(raw);
    if (matches.length === 1) {
      // Single hit → open it.
      this._openOrderId.set(matches[0].orderId);
      this.scanValue.set('');
      return;
    }

    if (matches.length === 0) {
      // Sample vial barcode (PF-… / long digits) → exact barcode lookup.
      if (this.looksLikeBarcode(raw)) { this.findByBarcode(); return; }
      // Otherwise treat it as an order QR / URL / GUID / invoice number.
      this.resolveOrderCode(raw);
      return;
    }
    // Multiple in-list matches → user keeps typing; the live filter is
    // surfaced via filteredGroups() in the template.
  }

  private looksLikeBarcode(s: string): boolean {
    return /^PF-/i.test(s) || /^[0-9]{6,}$/.test(s);
  }

  private matchGroups(query: string): OrderGroup[] {
    const q = query.toLowerCase();
    return this.groups().filter(g => {
      if (g.patientName.toLowerCase().includes(q)) return true;
      if (g.orderId.toLowerCase().startsWith(q.replace(/^#/, ''))) return true;
      return g.samples.some(s =>
        (s.barcode ?? '').toLowerCase().includes(q) ||
        (s.order?.patient?.phone ?? '').includes(query) ||
        (s.order?.patient?.mrn ?? '').toLowerCase().includes(q)
      );
    });
  }

  findByBarcode() {
    const code = this.scanValue().trim();
    if (!code) return;
    this.searching.set(true);
    this.api.get<OrderSample>(`/api/samples/by-barcode/${encodeURIComponent(code)}`).subscribe({
      next: s => {
        this.searching.set(false);
        if (s) {
          this._openOrderId.set(s.orderId);
          this.scanValue.set('');
        }
      },
      error: () => {
        this.searching.set(false);
        this.toasts.error('No sample with that barcode');
      }
    });
  }

  /**
   * Tap toggles the vial: pending → collected, or collected → pending when
   * the tube hasn't moved past the counter yet. Refusals (rejected/in_transit
   * /received) are no-ops. While the drawer is open we never re-fetch from
   * /api/samples/pending-collection, since that endpoint strips drawn vials
   * and would make the one just tapped vanish mid-animation.
   */
  toggleCollected(s: OrderSample) {
    if (s.status === 'pending') this.markCollected(s);
    else if (s.status === 'collected') this.markPending(s);
    // any other downstream status is locked — user can't undo from here.
  }

  private markCollected(s: OrderSample) {
    const now = new Date().toISOString();
    this._pending.update(list => list.map(x => x.id === s.id
      ? { ...x, status: 'collected', collectedAt: now }
      : x));

    this.api.patch<OrderSample>(`/api/samples/${s.id}/collect`).subscribe({
      error: () => {
        // Only roll back if the local state still says 'collected'. If the
        // user has already toggled away (rapid tap-back), respect their newer
        // intent — its own PATCH will reconcile against the server.
        const current = this._pending().find(x => x.id === s.id);
        if (current?.status !== 'collected') return;
        this._pending.update(list => list.map(x => x.id === s.id
          ? { ...x, status: 'pending', collectedAt: undefined }
          : x));
        this.toasts.error('Could not mark collected — try again');
      }
    });
  }

  private markPending(s: OrderSample) {
    const prev = { status: s.status, collectedAt: s.collectedAt };
    this._pending.update(list => list.map(x => x.id === s.id
      ? { ...x, status: 'pending', collectedAt: undefined }
      : x));

    this.api.patch<OrderSample>(`/api/samples/${s.id}/uncollect`).subscribe({
      error: e => {
        // Same guard as markCollected: only roll back if local state still
        // matches what we attempted, so a fast re-tap isn't fought by the
        // first request's late failure.
        const current = this._pending().find(x => x.id === s.id);
        if (current?.status !== 'pending') return;
        this._pending.update(list => list.map(x => x.id === s.id ? { ...x, ...prev } : x));
        this.toasts.error(e?.message ?? 'Could not undo — tube may have moved to the lab');
      }
    });
  }

  /** Open the structured rejection picker for the active order. */
  rejectOrder(g: OrderGroup) {
    const pending = g.samples.filter(s => s.status === 'pending');
    if (pending.length === 0) return;
    this._rejectModal.set({ group: g, reason: '', note: '' });
  }

  setRejectReason(code: string) {
    this._rejectModal.update(m => m ? { ...m, reason: code } : m);
  }
  setRejectNote(v: string) {
    this._rejectModal.update(m => m ? { ...m, note: v } : m);
  }
  cancelReject() { this._rejectModal.set(null); }
  pendingCount(g: OrderGroup): number {
    return g.samples.filter(s => s.status === 'pending').length;
  }
  canSubmitReject(): boolean {
    const m = this._rejectModal();
    if (!m || !m.reason) return false;
    if (m.reason === 'other' && m.note.trim().length === 0) return false;
    return true;
  }

  async submitReject() {
    const m = this._rejectModal();
    if (!m || !this.canSubmitReject()) return;
    const label = this.REJECT_REASONS.find(r => r.code === m.reason)?.label ?? m.reason;
    const reason = m.note.trim().length > 0 ? `${label} — ${m.note.trim()}` : label;
    const pending = m.group.samples.filter(s => s.status === 'pending');
    await Promise.all(pending.map(s =>
      firstValueFrom(this.api.patch(`/api/samples/${s.id}/reject`, { reason })).catch(() => null)
    ));
    this.toasts.success(`${pending.length} tube${pending.length === 1 ? '' : 's'} flagged for re-collection`);
    this._rejectModal.set(null);
    this._openOrderId.set(null);
    this.refresh();
  }

  // Original free-text dialog kept as fallback for any other call sites.
  async legacyRejectOrder(g: OrderGroup) {
    const pending = g.samples.filter(s => s.status === 'pending');
    if (pending.length === 0) return;
    const reason = await this.dialog.prompt({
      title: `Can't collect for ${g.patientName}?`,
      message: `Flags ${pending.length} pending vial${pending.length === 1 ? '' : 's'} for re-collection.`,
      placeholder: 'Patient refused, vein not found, wrong tube, …',
      multiline: true,
      required: true,
      tone: 'danger',
      confirmLabel: 'Reject vials'
    });
    if (!reason) return;
    await Promise.all(pending.map(s =>
      firstValueFrom(this.api.patch(`/api/samples/${s.id}/reject`, { reason })).catch(() => null)
    ));
    this.toasts.success('Marked for re-collection');
    this._openOrderId.set(null);
    this.refresh();
  }
}
