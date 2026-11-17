import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FilesLogoComponent } from '../../shared/components/files-logo/files-logo.component';
import { FILES_APPS, FilesAppId, filesApp } from './files-registry';

export type FilesLoadingMode = 'file' | 'start';

const LETTERS = Array.from({ length: 30 }, (_, i) => (i < 26 ? String.fromCharCode(65 + i) : 'A' + String.fromCharCode(65 + i - 26)));
const ROWS = Array.from({ length: 60 }, (_, i) => i + 1);
/** Faint "content" bars in the first sheet rows: [row, column, width as a share of the cell]. */
const SHEET_BARS: readonly (readonly [number, number, number])[] = [
  [1, 0, .8], [1, 1, .7], [1, 2, .55], [1, 3, .75],
  [2, 0, .6], [2, 1, .45], [2, 2, .3], [2, 3, .5],
  [3, 0, .7], [3, 1, .5], [3, 2, .35], [3, 3, .4],
  [4, 0, .5], [4, 1, .55], [4, 2, .3], [4, 3, .6],
  [5, 0, .65], [5, 1, .4], [5, 2, .35], [5, 3, .45],
];
/** The ribbon's groups: big buttons, then columns of small ones. */
const RIBBON: Record<'neuron' | 'synapse' | 'axon', readonly { big: number; cols: number }[]> = {
  neuron: [{ big: 1, cols: 1 }, { big: 0, cols: 3 }, { big: 0, cols: 2 }, { big: 0, cols: 2 }, { big: 3, cols: 0 }, { big: 0, cols: 2 }, { big: 2, cols: 0 }],
  synapse: [{ big: 1, cols: 1 }, { big: 0, cols: 3 }, { big: 0, cols: 3 }, { big: 3, cols: 0 }, { big: 1, cols: 1 }, { big: 2, cols: 0 }],
  axon: [{ big: 1, cols: 1 }, { big: 1, cols: 1 }, { big: 0, cols: 3 }, { big: 0, cols: 3 }, { big: 3, cols: 0 }, { big: 0, cols: 1 }, { big: 0, cols: 1 }],
};
const TABS: Record<'neuron' | 'synapse' | 'axon', readonly string[]> = {
  neuron: ['File', 'Home', 'Insert', 'Draw', 'Page Layout', 'Formulas', 'Data', 'Review', 'View', 'Automate'],
  synapse: ['File', 'Home', 'Insert', 'Draw', 'Design', 'Layout', 'References', 'Review', 'View'],
  axon: ['File', 'Home', 'Insert', 'Draw', 'Design', 'Transitions', 'Animations', 'Slide Show', 'Review', 'View'],
};
const MENU = ['File', 'Edit', 'Image', 'Layer', 'Type', 'Select', 'Filter', 'View', 'Window', 'Help'];
const PDF_MENU = ['File', 'Edit', 'View', 'Sign', 'Window', 'Help'];
const PDF_TABS = ['All tools', 'Edit', 'Convert', 'E-Sign'];
/** Start-screen side navigation, as each app draws it. */
const START_NAV: Record<'neuron' | 'synapse' | 'axon', readonly string[]> = {
  neuron: ['Back', 'Home', 'New', 'Open'],
  synapse: ['Home', 'New', 'Open', 'Info', 'Recover', 'Save', 'Save As', 'Print', 'Export', 'Close', 'Options'],
  axon: ['Home', 'New', 'Open'],
};
const C9 = 'M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0';
const FILE = 'M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7Z';
/** Stroked 24px icons as path data only (no markup strings): the start screens' nav, Open and Recent rows. */
const ICONS: Record<string, readonly string[]> = {
  Back: [C9, 'M12 8l-4 4 4 4M16 12H8'],
  Home: ['M3 10.5 12 3l9 7.5', 'M5 9.5V20h14V9.5', 'M10 20v-6h4v6'],
  New: [FILE, 'M14 3v4h4M12 11v6M9 14h6'],
  Open: ['M3 7a1 1 0 0 1 1-1h5l2 2h8a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z'],
  Info: [C9, 'M12 11v5M12 8h.01'],
  Recover: [FILE, 'M14 3v4h4M12 12v3l2 1'],
  Save: ['M6 3h10l3 3v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z', 'M8 3v5h7V3M8 21v-7h8v7'],
  'Save As': ['M6 3h10l3 3v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z', 'M8 3v5h7V3M9 17h6'],
  Print: ['M7 9V3h10v6', 'M4 9h16a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1Z', 'M7 14h10v7H7Z'],
  Export: [FILE, 'M14 3v4h4M9 14h7M13 11l3 3-3 3'],
  Close: ['M6 6l12 12M18 6 6 18'],
  Options: ['M9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0', 'M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1'],
  Device: ['M4.5 4h15A1.5 1.5 0 0 1 21 5.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 14.5v-9A1.5 1.5 0 0 1 4.5 4Z', 'M8 20h8M12 16v4'],
  neuron: ['M6 4h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z', 'M4 10h16M10 4v16'],
  synapse: [FILE, 'M14 3v4h4M9 12h6M9 15h6M9 18h4'],
  axon: ['M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z', 'M7 9h6M7 12h4M12 17v3M9 20h6'],
  myelin: [FILE, 'M14 3v4h4M9 13h6M9 16h6'],
  retina: ['M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z', 'M7.5 9.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0', 'm21 15-5-5-11 10'],
};
/** Start-screen tile counts (blank + the built-in templates). */
const START_TILES: Record<FilesAppId, number> = { neuron: 4, synapse: 3, axon: 3, myelin: 0, retina: 0 };

/**
 * What a Files app looks like while its engine boots: the app's OWN first screen drawn in CSS (a sheet grid with A1 selected for Neuron,
 * a page for Synapse and Myelin, a slide with its thumbnail rail for Axon, a checkerboard canvas for Retina; the app's start screen for
 * `/files/<kind>/start`), so the real app seems to fade in over its own outline. Pure CSS/SVG, no images. The surfaces use the engines'
 * own neutrals (they paint the same greys once ready, so the hand-off has no flash); the accent is the Prefrontal violet.
 *
 * One quiet pill names what is opening; the "first time can take a moment" hint shows only after 3 s (CSS delay, no timer).
 * Reduced motion: no shimmer, no fades. The host is the polite live region; every shape is aria-hidden.
 */
@Component({
  selector: 'pf-files-loading',
  standalone: true,
  imports: [FilesLogoComponent, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'status', 'aria-live': 'polite', '[attr.data-app]': 'appId()', '[attr.data-mode]': 'mode()', '[attr.aria-label]': 'label()' },
  template: `
    <ng-template #pill>
      <div class="fl-note">
        <div class="fl-pill" data-testid="files-loading-pill">
          <pf-files-logo [app]="appId()" [size]="18" />
          <span>{{ label() }}</span>
        </div>
        <p class="fl-hint" data-testid="files-loading-hint">The first time can take a moment while it downloads. After that it opens fast.</p>
      </div>
    </ng-template>

    <div class="fl" aria-hidden="true" [attr.data-app]="appId()" [attr.data-mode]="mode()" [attr.data-testid]="'files-loader-' + appId() + '-' + mode()">
      @if (mode() === 'start') {
        @switch (appId()) {
          @case ('myelin') {
            <div class="fl-pdfbar"><div class="fl-menu">@for (m of pdfMenu; track m) { <span>{{ m }}</span> }</div><span class="fl-sep"></span>
              <div class="fl-menu fl-menu--strong">@for (m of pdfTabs; track m) { <span>{{ m }}</span> }</div><i class="fl-search"></i></div>
            <div class="fl-home fl-home--pad">
              <div class="fl-home__body fl-rel">
                <i class="fl-b fl-b--h1" style="width: 260px"></i>
                <i class="fl-b" style="width: 360px; max-width: 80%"></i>
                <span class="fl-h2">Open</span>
                <div class="fl-cards"><div class="fl-card"><svg class="fl-svg fl-svg--card" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">@for (d of icon('Open'); track $index) { <path [attr.d]="d" /> }</svg><i class="fl-b" style="width: 70px"></i><i class="fl-b fl-b--s" style="width: 56px"></i></div>
                  <div class="fl-card"><svg class="fl-svg fl-svg--card" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">@for (d of icon('Device'); track $index) { <path [attr.d]="d" /> }</svg><i class="fl-b" style="width: 70px"></i><i class="fl-b fl-b--s" style="width: 120px"></i></div></div>
                <span class="fl-h2">Recent</span>
                <ng-container *ngTemplateOutlet="recent; context: { n: 2 }" />
                <ng-container *ngTemplateOutlet="pill" />
              </div>
            </div>
          }
          @case ('retina') {
            <div class="fl-menubar">@for (m of menu; track m) { <span>{{ m }}</span> }</div>
            <div class="fl-home fl-home--center">
              <div class="fl-home__body fl-home__body--narrow fl-rel">
                <span class="fl-h2">Open</span><hr class="fl-rule" />
                <div class="fl-orow"><span class="fl-ico fl-ico--tint"><svg class="fl-svg " viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">@for (d of icon('Open'); track $index) { <path [attr.d]="d" /> }</svg></span><span class="fl-orow__t"><i class="fl-b" style="width: 150px"></i><i class="fl-b fl-b--s" style="width: 200px"></i></span></div>
                <div class="fl-orow"><span class="fl-ico fl-ico--tint"><svg class="fl-svg " viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">@for (d of icon('Device'); track $index) { <path [attr.d]="d" /> }</svg></span><span class="fl-orow__t"><i class="fl-b" style="width: 90px"></i><i class="fl-b fl-b--s" style="width: 190px"></i></span></div>
                <span class="fl-h2">Recent</span><hr class="fl-rule" />
                <ng-container *ngTemplateOutlet="recent; context: { n: 1 }" />
                <ng-container *ngTemplateOutlet="pill" />
              </div>
            </div>
          }
          @default {
            <div class="fl-home">
              <nav class="fl-nav" [class.fl-nav--solid]="appId() !== 'axon'">
                @if (appId() === 'synapse') { <span class="fl-nav__back"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg></span> }
                @for (n of startNav(); track n) {
                  <span class="fl-nav__i" [class.on]="n === 'Home'" [class.dim]="$index > 2 && appId() === 'synapse' && n !== 'Options'"><svg class="fl-svg fl-nav__ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">@for (d of icon(n); track $index) { <path [attr.d]="d" /> }</svg>{{ n }}</span>
                }
              </nav>
              <div class="fl-home__body fl-rel">
                @if (appId() === 'axon') { <div class="fl-title"><pf-files-logo [app]="'axon'" [size]="36" /><span>Axon</span></div> }
                @else if (appId() === 'neuron') { <span class="fl-h1">Home</span> }
                @else { <i class="fl-b fl-b--h1" style="width: 220px"></i> }
                @if (appId() !== 'synapse') { <span class="fl-h2">New</span> }
                <div class="fl-tiles">
                  @for (t of tiles(); track $index) {
                    <div class="fl-tile">
                      <div class="fl-thumb" [attr.data-kind]="appId()">
                        @switch (appId()) {
                          @case ('neuron') { <div class="fl-thumb__grid" [class.fl-thumb__grid--hd]="$index > 0">@if ($index > 0) { @for (r of [1,2,3,4,5,6]; track r) { <i [style.width.%]="30 + ((r * 7 + $index * 11) % 30)"></i> } }</div> }
                          @case ('synapse') { <svg class="fl-thumb__plus" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7Z"/><path d="M14 3v4h4"/><path d="M12 11v6M9 14h6"/></svg> }
                          @default { @if ($index > 0) { <div class="fl-thumb__slide"><i class="t"></i><i class="a"></i><i class="l"></i><i class="l l2"></i><i class="img"></i></div> } }
                        }
                      </div>
                      <i class="fl-b fl-b--s" [style.width.px]="$index === 0 ? 80 : 96"></i>
                    </div>
                  }
                </div>
                @if (appId() !== 'neuron') {
                  <span class="fl-h2">Open</span>
                  <div class="fl-orow fl-orow--plain"><svg class="fl-svg fl-svg--row fl-svg--accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">@for (d of icon('Open'); track $index) { <path [attr.d]="d" /> }</svg><i class="fl-b" style="width: 140px"></i></div>
                  <div class="fl-orow fl-orow--plain"><svg class="fl-svg fl-svg--row" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">@for (d of icon('Device'); track $index) { <path [attr.d]="d" /> }</svg><i class="fl-b" style="width: 80px"></i></div>
                }
                <span class="fl-h2">Recent</span>
                <ng-container *ngTemplateOutlet="recent; context: { n: 2 }" />
                <ng-container *ngTemplateOutlet="pill" />
              </div>
            </div>
          }
        }
      } @else {
        @switch (appId()) {
          @case ('neuron') {
            <ng-container *ngTemplateOutlet="ribbon; context: { id: 'neuron' }" />
            <div class="fl-fx"><span class="fl-fx__box">A1</span><span class="fl-fx__i">fx</span><span class="fl-fx__in"></span></div>
            <div class="fl-sheet fl-rel">
              <div class="fl-sheet__cols"><span class="fl-corner"></span>@for (c of letters; track c) { <span [class.on]="$first">{{ c }}</span> }</div>
              <div class="fl-sheet__body">
                <div class="fl-sheet__rows">@for (r of rows; track r) { <span [class.on]="$first">{{ r }}</span> }</div>
                <div class="fl-sheet__cells">
                  @for (b of sheetBars; track $index) { <i class="fl-b fl-cellbar" [style.top.px]="b[0] * 16 + 5" [style.left.px]="b[1] * 51 + 5" [style.width.px]="b[2] * 41"></i> }
                  <span class="fl-a1"><i></i></span>
                </div>
              </div>
              <ng-container *ngTemplateOutlet="pill" />
            </div>
            <div class="fl-sheettabs"><span class="fl-chev"></span><span class="fl-chev"></span><span class="fl-sheettab">Sheet1</span><span class="fl-scroll"></span></div>
            <div class="fl-status"><span>Ready</span><i class="fl-b fl-b--s" style="width: 120px; margin-left: auto"></i></div>
          }
          @case ('synapse') {
            <ng-container *ngTemplateOutlet="ribbon; context: { id: 'synapse' }" />
            <div class="fl-ruler"><span></span></div>
            <div class="fl-canvas fl-canvas--doc fl-rel">
              <div class="fl-page fl-page--doc">
                <i class="fl-b fl-b--h1" style="width: 62%"></i>
                <i class="fl-b" style="width: 78%"></i>
                <i class="fl-b fl-b--h2" style="width: 30%"></i>
                @for (w of docLines; track $index) { <i class="fl-b fl-b--line" [style.width.%]="w"></i> }
              </div>
              <ng-container *ngTemplateOutlet="pill" />
            </div>
            <div class="fl-status"><span>Page 1 of 1</span><i class="fl-b fl-b--s" style="width: 120px; margin-left: auto"></i></div>
          }
          @case ('axon') {
            <ng-container *ngTemplateOutlet="ribbon; context: { id: 'axon' }" />
            <div class="fl-deck">
              <div class="fl-rail">
                @for (n of [1, 2, 3]; track n) { <div class="fl-rail__i"><span>{{ n }}</span><div class="fl-rail__t" [class.on]="n === 1">@if (n > 1) { <i class="t"></i><i class="l"></i><i class="l l2"></i> }</div></div> }
              </div>
              <div class="fl-deck__main">
                <div class="fl-canvas fl-canvas--slide fl-rel">
                  <div class="fl-slide"><div class="fl-ph fl-ph--title"><i class="fl-b"></i></div><div class="fl-ph fl-ph--sub"><i class="fl-b"></i></div></div>
                  <ng-container *ngTemplateOutlet="pill" />
                </div>
                <div class="fl-notes"><i class="fl-b fl-b--s" style="width: 108px"></i></div>
              </div>
            </div>
            <div class="fl-status"><span>Slide 1 of 1</span><i class="fl-b fl-b--s" style="width: 140px; margin-left: auto"></i></div>
          }
          @case ('myelin') {
            <div class="fl-pdfbar"><div class="fl-menu">@for (m of pdfMenu; track m) { <span>{{ m }}</span> }</div><span class="fl-sep"></span>
              <div class="fl-menu fl-menu--strong">@for (m of pdfTabs; track m) { <span>{{ m }}</span> }</div><i class="fl-search"></i></div>
            <div class="fl-pdf">
              <div class="fl-tools"><span class="fl-h3">All tools</span>@for (w of pdfTools; track $index) { <span class="fl-tools__i"><i class="fl-ico fl-ico--s"></i><i class="fl-b" [style.width.px]="w"></i></span> }</div>
              <div class="fl-canvas fl-canvas--pdf fl-rel">
                <div class="fl-palette">@for (i of [1,2,3,4,5,6,7]; track i) { <i [class.on]="i === 1"></i> }</div>
                <div class="fl-page fl-page--pdf">
                  <i class="fl-b fl-b--h1" style="width: 45%"></i>
                  <i class="fl-b" style="width: 38%"></i>
                  <i class="fl-gap"></i>
                  @for (w of [34, 58, 50]; track $index) { <i class="fl-b fl-b--line" [style.width.%]="w"></i> }
                  <i class="fl-hr"></i>
                  @for (r of [1,2,3,4,5,6,7]; track r) { <div class="fl-trow"><i class="fl-b" [style.width.%]="22 + (r * 5) % 14"></i><i class="fl-b" style="width: 8%"></i><i class="fl-b" style="width: 9%"></i><i class="fl-b" style="width: 13%"></i></div> }
                </div>
                <ng-container *ngTemplateOutlet="pill" />
              </div>
              <div class="fl-pdfrail">@for (i of [1,2,3,4,5,6,7,8]; track i) { <i></i> }<span class="fl-pagechip">1</span><span class="fl-pagenum">/ 1</span></div>
            </div>
          }
          @default {
            <div class="fl-menubar">@for (m of menu; track m) { <span>{{ m }}</span> }</div>
            <div class="fl-optbar"><i class="fl-ico fl-ico--s"></i><span class="fl-sep"></span>@for (w of [86, 54, 140, 120]; track $index) { <i class="fl-b" [style.width.px]="w"></i> }</div>
            <div class="fl-studio">
              <div class="fl-toolrail">@for (i of retinaTools; track i) { <i [class.on]="i === 1"></i> }<span class="fl-swatch"></span></div>
              <div class="fl-studio__main">
                <div class="fl-doctab"><i class="fl-b fl-b--s" style="width: 150px"></i></div>
                <div class="fl-canvas fl-canvas--img fl-rel">
                  <div class="fl-checker">
                    <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="m21 16-5-5-9 9"/></svg>
                  </div>
                  <ng-container *ngTemplateOutlet="pill" />
                </div>
              </div>
              <div class="fl-panels">
                <div class="fl-panel"><span class="fl-h3">Color</span><div class="fl-grad"></div></div>
                <div class="fl-panel"><span class="fl-h3">Properties</span>@for (w of [60, 90, 70]; track $index) { <i class="fl-b" [style.width.%]="w"></i> }</div>
                <div class="fl-panel fl-panel--grow"><span class="fl-h3">Layers</span><div class="fl-layer"><i class="fl-layer__t"></i><i class="fl-b" style="width: 60px"></i></div></div>
              </div>
            </div>
            <div class="fl-status"><span>100 %</span><i class="fl-b fl-b--s" style="width: 120px"></i></div>
          }
        }
      }
    </div>

    <ng-template #ribbon let-id="id">
      <div class="fl-tabs">@for (t of tabsFor(id); track t) { <span [class.on]="t === 'Home'">{{ t }}</span> }</div>
      <div class="fl-ribbon">
        @for (g of ribbonFor(id); track $index) {
          <div class="fl-grp">
            @for (b of range(g.big); track b) { <span class="fl-big"><i class="fl-ico"></i><i class="fl-b fl-b--s"></i></span> }
            @for (c of range(g.cols); track c) {
              <span class="fl-col">@for (r of [0, 1, 2]; track r) { <span class="fl-mini"><i class="fl-ico fl-ico--xs"></i><i class="fl-b fl-b--s" [style.width.px]="r === 1 ? 26 : 38 - c * 6"></i></span> }</span>
            }
          </div>
        }
      </div>
    </ng-template>

    <ng-template #recent let-n="n">
      @for (r of range(n); track r) {
        <div class="fl-recent"><svg class="fl-svg fl-svg--row fl-svg--accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">@for (d of icon(appId()); track $index) { <path [attr.d]="d" /> }</svg><span class="fl-orow__t"><i class="fl-b" [style.width.px]="r === 0 ? 190 : 150"></i><i class="fl-b fl-b--s" [style.width.px]="r === 0 ? 110 : 96"></i></span><i class="fl-b fl-b--s fl-recent__when"></i></div>
      }
    </ng-template>
  `,
  styles: [`
    :host {
      /* Engine neutrals, dark (the default theme): the engines paint these exact greys once they are ready. */
      --fl-chrome: #292929; --fl-panel: #1f1f1f; --fl-head: #303030; --fl-head-on: #454545; --fl-line: #3a3a3a; --fl-canvas: #1e1e1e;
      --fl-ink: #dcdcdc; --fl-ink-2: #9a9a9a; --fl-ink-3: #6e6e6e; --fl-paper: #ffffff; --fl-paper-bar: rgba(15, 23, 42, .08);
      --fl-bar: rgba(255, 255, 255, .08); --fl-shine: rgba(255, 255, 255, .14);
      --fl-accent: var(--color-violet-400, #a78bfa); --fl-nav: color-mix(in srgb, var(--color-primary, #7c3aed) 32%, #1c1c1c); --fl-nav-ink: #ffffff;
      --fl-light-nav: #262626; --fl-pill-bg: color-mix(in srgb, #262626 88%, transparent); --fl-shadow: 0 6px 24px rgba(0, 0, 0, .35);
      position: absolute; inset: 0; display: block; overflow: hidden; z-index: 2; background: var(--fl-chrome); color: var(--fl-ink);
      font: 13px/1.3 var(--font-sans, 'Noto Sans', system-ui, sans-serif); pointer-events: none; container-type: inline-size;
      transition: opacity 200ms ease;
    }
    :host-context(.light) {
      --fl-chrome: #f3f3f3; --fl-panel: #ffffff; --fl-head: #f8f8f8; --fl-head-on: #e1e1e1; --fl-line: #e3e3e3; --fl-canvas: #ffffff;
      --fl-ink: #3b3b45; --fl-ink-2: #6d6b84; --fl-ink-3: #a3a1b5;
      --fl-bar: rgba(15, 23, 42, .07); --fl-shine: rgba(255, 255, 255, .75);
      --fl-accent: var(--color-primary, #7c3aed); --fl-nav: var(--color-primary, #7c3aed);
      --fl-light-nav: #f5f5f5; --fl-pill-bg: color-mix(in srgb, #ffffff 92%, transparent); --fl-shadow: 0 6px 24px rgba(38, 37, 54, .12);
    }
    /* Retina and Myelin draw on their own surfaces (lavender-grey studio; the PDF viewer's light grey). */
    .fl[data-app='retina'] { --fl-chrome: #262935; --fl-panel: #20222c; --fl-canvas: #1a1c24; --fl-line: #33364a; --fl-head: #2c2f3d; }
    :host-context(.light) .fl[data-app='retina'] { --fl-chrome: #f4f2fb; --fl-panel: #f4f2fb; --fl-canvas: #e2dfee; --fl-line: #d8d4e6; --fl-head: #ebe8f5; }
    .fl[data-app='myelin'] { --fl-chrome: #1e1e22; --fl-panel: #1e1e22; --fl-canvas: #121214; --fl-line: #34343a; }
    :host-context(.light) .fl[data-app='myelin'] { --fl-chrome: #ffffff; --fl-panel: #ffffff; --fl-canvas: #f1f1f3; --fl-line: #e4e4e8; }
    :host(.pf-fl-leave) { opacity: 0; }

    .fl { position: absolute; inset: 0; display: flex; flex-direction: column; background: var(--fl-chrome); }
    .fl-svg { flex: none; width: 18px; height: 18px; display: block; }
    .fl-svg--row { width: 22px; height: 22px; color: var(--fl-ink-2); }
    .fl-svg--accent { color: color-mix(in srgb, var(--fl-accent) 80%, var(--fl-ink)); }
    .fl-svg--card { width: 24px; height: 24px; color: var(--fl-ink-2); }
    .fl-rel { position: relative; }
    .fl i { display: block; flex: none; }
    /* Placeholder bars: ONE viewport-anchored sweep shared by every bar (the skeleton kit's shimmer). */
    .fl-b {
      height: 8px; border-radius: 4px; max-width: 100%;
      background-color: var(--fl-bar);
      background-image: linear-gradient(90deg, transparent 0%, transparent 38%, var(--fl-shine) 50%, transparent 62%, transparent 100%);
      background-size: 200vw 100%; background-repeat: no-repeat; background-attachment: fixed;
      animation: fl-sweep 1.8s cubic-bezier(.4, 0, .2, 1) infinite;
    }
    .fl-b--s { height: 6px; border-radius: 3px; }
    .fl-b--h1 { height: 18px; border-radius: 6px; }
    .fl-b--h2 { height: 12px; border-radius: 5px; margin-top: 10px; }
    .fl-ico { width: 26px; height: 26px; border-radius: 6px; background: var(--fl-bar); }
    .fl-ico--s { width: 18px; height: 18px; border-radius: 5px; }
    .fl-ico--xs { width: 14px; height: 14px; border-radius: 4px; }
    .fl-ico--line { width: 20px; height: 22px; border-radius: 4px; background: none; border: 1.5px solid var(--fl-ink-3); }
    .fl-ico--tint { flex: none; width: 32px; height: 32px; border-radius: 7px; display: flex; align-items: center; justify-content: center; color: var(--fl-ink); background: color-mix(in srgb, var(--fl-accent) 26%, transparent); }
    @keyframes fl-sweep { from { background-position: -100vw 0; } to { background-position: 100vw 0; } }

    /* ── the pill ── */
    .fl-note { position: absolute; left: 50%; top: 28px; bottom: auto; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; gap: 8px; z-index: 3; width: max-content; max-width: calc(100% - 32px); }
    .fl-pill { display: inline-flex; align-items: center; gap: 8px; height: 32px; padding: 0 14px 0 8px; border-radius: 999px; background: var(--fl-pill-bg);
      border: 1px solid var(--fl-line); box-shadow: var(--fl-shadow); color: var(--fl-ink); font-size: 13px; font-weight: 600; white-space: nowrap;
      backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); animation: fl-in 260ms cubic-bezier(.32, .72, 0, 1) both; }
    .fl-hint { margin: 0; max-width: 520px; text-wrap: balance; padding: 6px 12px; border-radius: 10px; background: var(--fl-pill-bg); font-size: 12px; line-height: 1.45; text-align: center;
      color: var(--fl-ink-2); opacity: 0; animation: fl-hint 260ms ease 3s both; }
    /* Start screens (and phones) keep the top for the app's own heading and tiles: the note sits low, over empty space. */
    .fl[data-mode='start'] .fl-note { top: auto; bottom: 36px; }
    @keyframes fl-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
    @keyframes fl-hint { from { opacity: 0; } to { opacity: 1; } }

    /* ── ribbon apps (Neuron, Synapse, Axon) ── */
    .fl-tabs { flex: none; display: flex; align-items: center; gap: 22px; height: 34px; padding: 0 20px; overflow: hidden; white-space: nowrap; color: var(--fl-ink-2); font-size: 14px; }
    .fl-tabs span { position: relative; }
    .fl-tabs .on { color: var(--fl-ink); font-weight: 600; }
    .fl-tabs .on::after { content: ''; position: absolute; left: 0; right: 0; bottom: -7px; height: 2px; border-radius: 2px; background: var(--fl-accent); }
    .fl-ribbon { flex: none; display: flex; align-items: stretch; height: 80px; margin: 2px 8px 6px; padding: 8px 6px; border-radius: 8px; background: var(--fl-panel); overflow: hidden; }
    .fl-grp { flex: none; display: flex; align-items: center; gap: 12px; padding: 0 14px; border-right: 1px solid var(--fl-line); }
    .fl-grp:last-child { border-right: 0; }
    .fl-big { display: flex; flex-direction: column; align-items: center; gap: 8px; width: 46px; }
    .fl-big .fl-ico { width: 28px; height: 28px; }
    .fl-big .fl-b { width: 38px; }
    .fl-col { display: flex; flex-direction: column; gap: 9px; }
    .fl-mini { display: flex; align-items: center; gap: 6px; }

    /* Neuron */
    .fl-fx { flex: none; display: flex; align-items: center; gap: 10px; height: 34px; padding: 0 8px; }
    .fl-fx__box { width: 118px; height: 24px; padding: 0 8px; display: flex; align-items: center; border-radius: 4px; background: var(--fl-panel); border: 1px solid var(--fl-line); font-size: 12px; color: var(--fl-ink); }
    .fl-fx__i { font-style: italic; font-weight: 600; color: var(--fl-ink-3); padding: 0 8px; }
    .fl-fx__in { flex: 1; height: 24px; border-radius: 4px; background: var(--fl-panel); border: 1px solid var(--fl-line); }
    .fl-sheet { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; background: var(--fl-canvas); border-top: 1px solid var(--fl-line); overflow: hidden; }
    .fl-sheet__cols { flex: none; display: flex; height: 20px; background: var(--fl-head); border-bottom: 1px solid var(--fl-line); }
    .fl-sheet__cols span { flex: none; width: 51px; display: flex; align-items: center; justify-content: center; border-right: 1px solid var(--fl-line); font-size: 11px; color: var(--fl-ink-2); }
    .fl-sheet__cols .fl-corner { width: 28px; }
    .fl-sheet__cols .on, .fl-sheet__rows .on { background: var(--fl-head-on); color: var(--fl-ink); box-shadow: inset 0 -2px 0 var(--fl-accent); }
    .fl-sheet__rows .on { box-shadow: inset -2px 0 0 var(--fl-accent); }
    .fl-sheet__body { flex: 1; display: flex; min-height: 0; }
    .fl-sheet__rows { flex: none; width: 28px; background: var(--fl-head); border-right: 1px solid var(--fl-line); }
    .fl-sheet__rows span { display: flex; align-items: center; justify-content: center; height: 16px; border-bottom: 1px solid var(--fl-line); box-sizing: border-box; font-size: 10px; color: var(--fl-ink-2); }
    .fl-sheet__cells { position: relative; flex: 1; background-image: linear-gradient(to right, var(--fl-line) 1px, transparent 1px), linear-gradient(to bottom, var(--fl-line) 1px, transparent 1px);
      background-size: 51px 16px; background-position: -1px -1px; }
    .fl-cellbar { position: absolute; height: 6px; border-radius: 3px; }
    .fl-a1 { position: absolute; left: -1px; top: -1px; width: 52px; height: 17px; border: 2px solid var(--fl-accent); box-sizing: border-box; border-radius: 1px; }
    .fl-a1 i { position: absolute; right: -4px; bottom: -4px; width: 6px; height: 6px; background: var(--fl-accent); border: 1px solid var(--fl-canvas); }
    .fl-sheettabs { flex: none; display: flex; align-items: center; gap: 14px; height: 32px; padding: 0 14px; background: var(--fl-chrome); border-top: 1px solid var(--fl-line); }
    .fl-chev { width: 7px; height: 7px; border-left: 1.5px solid var(--fl-ink-3); border-bottom: 1.5px solid var(--fl-ink-3); transform: rotate(45deg); }
    .fl-chev + .fl-chev { transform: rotate(-135deg); }
    .fl-sheettab { padding: 6px 14px; margin-left: 14px; border-radius: 4px 4px 0 0; background: var(--fl-panel); color: var(--fl-accent); font-weight: 600; font-size: 13px; box-shadow: inset 0 -2px 0 var(--fl-accent); }
    .fl-scroll { flex: 1; height: 6px; margin-left: 14px; border-radius: 3px; background: var(--fl-bar); }
    .fl-status { flex: none; display: flex; align-items: center; gap: 18px; height: 28px; padding: 0 12px; background: var(--fl-chrome); border-top: 1px solid var(--fl-line); font-size: 12px; color: var(--fl-ink-2); }

    /* Synapse */
    .fl-ruler { flex: none; height: 18px; background: var(--fl-chrome); display: flex; justify-content: center; }
    .fl-ruler span { width: min(816px, calc(100% - 64px)); height: 14px; margin-top: 2px; border-radius: 2px; background-color: var(--fl-panel);
      background-image: repeating-linear-gradient(to right, var(--fl-ink-3) 0 1px, transparent 1px 12px); background-size: 100% 4px; background-repeat: repeat-x; background-position: 0 8px; opacity: .9; }
    .fl-canvas { flex: 1 1 auto; min-height: 0; overflow: hidden; background: var(--fl-canvas); }
    .fl-canvas--doc { display: flex; justify-content: center; padding-top: 18px; background: var(--fl-chrome); }
    .fl-page { flex: none; background: var(--fl-paper); box-shadow: 0 1px 3px rgba(0, 0, 0, .12), 0 0 0 1px rgba(0, 0, 0, .04); display: flex; flex-direction: column; }
    .fl-page .fl-b { background-color: var(--fl-paper-bar); background-image: linear-gradient(90deg, transparent 0%, transparent 38%, rgba(255, 255, 255, .8) 50%, transparent 62%, transparent 100%); }
    .fl-page--doc { width: min(816px, calc(100% - 64px)); min-height: 1056px; padding: 96px 12% 0; gap: 12px; }
    .fl-page--doc .fl-b--h1 { height: 22px; margin-bottom: 6px; }
    .fl-b--line { height: 7px; }

    /* Axon */
    .fl-deck { flex: 1 1 auto; min-height: 0; display: flex; border-top: 1px solid var(--fl-line); }
    .fl-rail { flex: none; width: 234px; padding: 10px 8px 0 8px; display: flex; flex-direction: column; gap: 12px; background: var(--fl-chrome); border-right: 1px solid var(--fl-line); }
    .fl-rail__i { display: flex; gap: 8px; font-size: 12px; color: var(--fl-ink-2); }
    .fl-rail__t { position: relative; width: 200px; aspect-ratio: 16 / 9; border-radius: 4px; background: var(--fl-paper); border: 1px solid var(--fl-line); padding: 14px 18px; display: flex; flex-direction: column; gap: 6px; }
    .fl-rail__t.on { border: 3px solid var(--fl-accent); padding: 12px 16px; }
    .fl-rail__t .t, .fl-thumb__slide .t { width: 55%; height: 7px; border-radius: 2px; background: rgba(15, 23, 42, .5); }
    .fl-rail__t .l, .fl-thumb__slide .l { width: 45%; height: 3px; border-radius: 2px; background: rgba(15, 23, 42, .15); }
    .fl-rail__t .l2, .fl-thumb__slide .l2 { width: 35%; }
    .fl-deck__main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .fl-canvas--slide { display: flex; align-items: center; justify-content: center; padding: 24px 40px; background: var(--fl-chrome); }
    .fl-slide { position: relative; width: min(100%, calc((100cqh) * 1.5)); max-width: 908px; aspect-ratio: 16 / 9; background: var(--fl-paper); box-shadow: 0 1px 3px rgba(0, 0, 0, .14); }
    .fl-ph { position: absolute; left: 12.5%; right: 12.5%; border: 1px dashed rgba(15, 23, 42, .28); display: flex; align-items: flex-end; justify-content: center; padding-bottom: 3.5%; }
    .fl-ph--title { top: 16%; height: 35%; }
    .fl-ph--title .fl-b { width: 58%; height: 26%; max-height: 34px; border-radius: 6px; }
    .fl-ph--sub { top: 52.5%; height: 24%; align-items: flex-start; padding: 2.5% 0 0; }
    .fl-ph--sub .fl-b { width: 30%; height: 14px; }
    .fl-ph .fl-b { background-color: rgba(15, 23, 42, .1); background-image: linear-gradient(90deg, transparent 0%, transparent 38%, rgba(255, 255, 255, .8) 50%, transparent 62%, transparent 100%); }
    .fl-notes { flex: none; height: 76px; padding: 14px 8px; background: var(--fl-chrome); border-top: 1px solid var(--fl-line); }

    /* Myelin */
    .fl-pdfbar { flex: none; display: flex; align-items: center; gap: 16px; height: 46px; padding: 0 20px; background: var(--fl-chrome); border-bottom: 1px solid var(--fl-line); overflow: hidden; white-space: nowrap; }
    .fl-menu { display: flex; gap: 20px; color: var(--fl-ink-2); font-size: 13px; }
    .fl-menu--strong span:first-child { color: var(--fl-ink); font-weight: 600; }
    .fl-sep { flex: none; width: 1px; height: 22px; background: var(--fl-line); }
    .fl-search { margin-left: auto; width: 260px; height: 30px; border-radius: 999px; border: 1px solid var(--fl-line); }
    .fl-pdf { flex: 1 1 auto; min-height: 0; display: flex; }
    .fl-tools { flex: none; width: 270px; padding: 14px 18px; display: flex; flex-direction: column; gap: 18px; background: var(--fl-panel); border-right: 1px solid var(--fl-line); }
    .fl-h3 { font-size: 14px; font-weight: 700; color: var(--fl-ink); }
    .fl-tools .fl-h3 { align-self: center; margin-bottom: 4px; }
    .fl-tools__i { display: flex; align-items: center; gap: 12px; }
    .fl-tools__i .fl-ico { background: none; border: 1.5px solid color-mix(in srgb, var(--fl-accent) 60%, transparent); }
    .fl-canvas--pdf { display: flex; justify-content: center; padding: 14px 24px 0 64px; }
    .fl-palette { position: absolute; left: 12px; top: 14px; width: 40px; padding: 8px 0; border-radius: 8px; background: var(--fl-panel); border: 1px solid var(--fl-line); display: flex; flex-direction: column; align-items: center; gap: 12px; }
    .fl-palette i { width: 18px; height: 18px; border-radius: 4px; background: var(--fl-bar); }
    .fl-palette i.on { width: 28px; height: 28px; margin: -5px 0; background: color-mix(in srgb, var(--fl-accent) 30%, transparent); }
    .fl-page--pdf { width: min(904px, 100%); min-height: 1170px; padding: 72px 8% 0; gap: 12px; }
    .fl-gap { height: 18px; }
    .fl-hr { height: 2px; background: rgba(15, 23, 42, .5); margin: 6px 0 8px; }
    .fl-trow { display: flex; gap: 0; align-items: center; height: 18px; }
    .fl-trow .fl-b:nth-child(1) { margin-right: auto; }
    .fl-trow .fl-b + .fl-b { margin-left: 6%; }
    .fl-pdfrail { flex: none; width: 48px; padding: 14px 0; display: flex; flex-direction: column; align-items: center; gap: 20px; background: var(--fl-panel); border-left: 1px solid var(--fl-line); }
    .fl-pdfrail i { width: 18px; height: 18px; border-radius: 4px; border: 1.5px solid var(--fl-ink-3); }
    .fl-pagechip { margin-top: auto; min-width: 38px; height: 24px; display: flex; align-items: center; justify-content: center; border-radius: 4px; border: 1px solid var(--fl-line); font-size: 12px; font-weight: 700; color: var(--fl-ink); }
    .fl-pagenum { margin-top: -14px; font-size: 12px; color: var(--fl-ink-2); }

    /* Retina */
    .fl-menubar { flex: none; display: flex; align-items: center; gap: 13px; height: 32px; padding: 0 16px; background: var(--fl-chrome); border-bottom: 1px solid var(--fl-line); overflow: hidden; white-space: nowrap; font-size: 12px; color: var(--fl-ink); }
    .fl-optbar { flex: none; display: flex; align-items: center; gap: 18px; height: 36px; padding: 0 14px; background: var(--fl-chrome); border-bottom: 1px solid var(--fl-line); overflow: hidden; }
    .fl-studio { flex: 1 1 auto; min-height: 0; display: flex; }
    .fl-toolrail { flex: none; width: 40px; padding: 10px 0; display: flex; flex-direction: column; align-items: center; gap: 15px; background: var(--fl-chrome); border-right: 1px solid var(--fl-line); }
    .fl-toolrail i { width: 18px; height: 18px; border-radius: 4px; border: 1.5px solid var(--fl-ink-3); }
    .fl-toolrail i.on { width: 26px; height: 26px; margin: -4px 0; border: 0; background: color-mix(in srgb, var(--fl-accent) 30%, transparent); }
    .fl-swatch { margin-top: auto; width: 20px; height: 20px; border-radius: 3px; background: var(--fl-ink); box-shadow: 6px 6px 0 -1px var(--fl-panel), 6px 6px 0 0 var(--fl-ink-3); }
    .fl-studio__main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .fl-doctab { flex: none; height: 28px; padding: 0 16px; display: flex; align-items: center; background: var(--fl-chrome); border-bottom: 1px solid var(--fl-line); }
    .fl-canvas--img { display: flex; align-items: center; justify-content: center; }
    .fl-checker { width: min(46%, 520px); aspect-ratio: 4 / 3; display: flex; align-items: center; justify-content: center; color: var(--fl-ink-3);
      background-color: var(--fl-panel); background-image: conic-gradient(var(--fl-line) 25%, transparent 0 50%, var(--fl-line) 0 75%, transparent 0); background-size: 20px 20px;
      box-shadow: 0 2px 10px rgba(0, 0, 0, .18); }
    .fl-checker svg { padding: 12px; border-radius: 12px; background: var(--fl-panel); box-sizing: content-box; }
    .fl-panels { flex: none; width: 290px; display: flex; flex-direction: column; background: var(--fl-panel); border-left: 1px solid var(--fl-line); }
    .fl-panel { padding: 12px 14px; display: flex; flex-direction: column; gap: 12px; border-bottom: 1px solid var(--fl-line); }
    .fl-panel--grow { flex: 1; border-bottom: 0; }
    .fl-grad { height: 56px; border-radius: 4px; background: linear-gradient(to bottom, transparent, rgba(0, 0, 0, .55)), linear-gradient(to right, #fff, color-mix(in srgb, var(--fl-accent) 70%, #fff)); opacity: .55; }
    .fl-layer { display: flex; align-items: center; gap: 10px; padding: 6px; border-radius: 4px; background: color-mix(in srgb, var(--fl-accent) 18%, transparent); }
    .fl-layer__t { width: 28px; height: 22px; border-radius: 3px; border: 1px solid var(--fl-line); background-image: conic-gradient(var(--fl-line) 25%, transparent 0 50%, var(--fl-line) 0 75%, transparent 0); background-size: 8px 8px; }

    /* ── start screens ── */
    .fl-home { flex: 1 1 auto; min-height: 0; display: flex; background: var(--fl-panel); }
    :host([data-app='synapse']) .fl-home, :host([data-app='axon']) .fl-home { background: color-mix(in srgb, var(--fl-panel) 70%, var(--fl-chrome)); }
    :host([data-app='myelin']) .fl-home { background: var(--fl-canvas); }
    :host([data-app='retina']) .fl-home { background: var(--fl-canvas); }
    .fl-nav { flex: none; width: 196px; padding: 18px 0; display: flex; flex-direction: column; gap: 4px; background: var(--fl-light-nav); color: var(--fl-ink); border-right: 1px solid var(--fl-line); font-size: 14px; }
    .fl-nav--solid { background: var(--fl-nav); color: var(--fl-nav-ink); border-right: 0; }
    .fl-nav__back { padding: 6px 22px 14px; }
    .fl-nav__i { display: flex; align-items: center; gap: 14px; height: 38px; padding: 0 22px; white-space: nowrap; }
    .fl-nav__i.on { background: rgba(255, 255, 255, .14); box-shadow: inset 3px 0 0 rgba(255, 255, 255, .7); font-weight: 600; }
    .fl-nav:not(.fl-nav--solid) .fl-nav__i { margin: 0 6px; padding: 0 12px; border-radius: 4px; font-size: 13px; }
    .fl-nav:not(.fl-nav--solid) .fl-nav__i.on { background: var(--fl-panel); box-shadow: 0 0 0 1px var(--fl-line); color: var(--fl-accent); }
    .fl-nav__i.dim { opacity: .5; }
    .fl-nav__ico { width: 18px; height: 18px; }
    .fl-home__body { flex: 1; min-width: 0; padding: 30px 44px; display: flex; flex-direction: column; align-items: flex-start; gap: 14px; overflow: hidden; }
    .fl-home--pad .fl-home__body { padding: 30px 36px; }
    .fl-home--center { justify-content: center; }
    .fl-home__body--narrow { flex: 0 1 760px; align-items: stretch; padding-top: 36px; }
    .fl-h1 { font-size: 28px; font-weight: 400; color: var(--fl-ink); margin-bottom: 6px; }
    .fl-h2 { margin-top: 10px; font-size: 15px; font-weight: 700; color: var(--fl-ink); }
    .fl-title { display: flex; align-items: center; gap: 8px; font-size: 24px; font-weight: 600; color: var(--fl-ink); }
    .fl-rule { width: 100%; margin: -4px 0 4px; border: 0; border-top: 1px solid var(--fl-line); }
    .fl-tiles { display: flex; gap: 18px; flex-wrap: wrap; }
    .fl-tile { display: flex; flex-direction: column; gap: 10px; }
    .fl-thumb { width: 150px; height: 104px; border: 1px solid var(--fl-line); background: var(--fl-paper); display: flex; align-items: center; justify-content: center; border-radius: 3px; }
    .fl-thumb[data-kind='synapse'] { height: 104px; color: #3b3b45; }
    .fl-thumb[data-kind='axon'] { width: 160px; height: 90px; }
    .fl-thumb__plus { color: var(--fl-accent); }
    .fl-thumb__grid { width: 130px; height: 84px; display: flex; flex-direction: column; justify-content: space-around; padding: 10px 0 2px 36px; box-sizing: border-box;
      background-image: linear-gradient(to right, #e3e3e3 1px, transparent 1px), linear-gradient(to bottom, #e3e3e3 1px, transparent 1px); background-size: 33px 12px; border: 1px solid #e3e3e3; }
    .fl-thumb__grid--hd { background-color: #fff; box-shadow: inset 0 12px 0 #eeeaf8; }
    .fl-thumb__grid i { height: 6px; border-radius: 1px; background: color-mix(in srgb, var(--color-primary, #7c3aed) 60%, #fff); }
    .fl-thumb__slide { position: relative; width: 100%; height: 100%; padding: 12px; box-sizing: border-box; display: flex; flex-direction: column; gap: 6px; }
    .fl-thumb__slide .a { width: 16%; height: 3px; background: var(--color-primary, #7c3aed); }
    .fl-thumb__slide .img { position: absolute; right: 12px; bottom: 18px; width: 24%; height: 36%; background: color-mix(in srgb, var(--color-primary, #7c3aed) 22%, #fff); }
    .fl-orow, .fl-recent { display: flex; align-items: center; gap: 14px; min-height: 40px; padding: 0 10px; width: 100%; box-sizing: border-box; }
    .fl-orow--plain { min-height: 36px; }
    .fl-orow__t { display: flex; flex-direction: column; gap: 7px; }
    .fl-recent__when { width: 60px; margin-left: auto; margin-right: 10%; }
    .fl-cards { display: flex; gap: 14px; flex-wrap: wrap; }
    .fl-card { width: 228px; height: 102px; border: 1px solid var(--fl-line); border-radius: 6px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; background: var(--fl-panel); }

    /* Phones and narrow frames: the engines fold their side panels away. */
    @container (max-width: 720px) {
      .fl .fl-rail, .fl .fl-tools, .fl .fl-panels, .fl .fl-nav, .fl .fl-search { display: none; }
      .fl .fl-note { top: auto; bottom: 28px; }
      .fl-ribbon { height: 64px; }
      .fl .fl-big .fl-b { display: none; }
      .fl-home__body { padding: 22px 18px; }
      .fl-canvas--doc { padding: 12px 0 0; }
      .fl-page--doc { width: calc(100% - 24px); padding: 40px 8% 0; }
      .fl-canvas--pdf { padding: 12px 12px 0 60px; }
      .fl-page--pdf { padding: 40px 7% 0; }
      .fl-canvas--slide { padding: 16px; }
      .fl-checker { width: 72%; }
      .fl .fl-recent__when { display: none; }
      .fl-card { width: 100%; }
      .fl-cards { width: 100%; flex-direction: column; }
      .fl-thumb { width: 120px; height: 84px; }
      .fl-thumb[data-kind='axon'] { width: 132px; height: 74px; }
      .fl-thumb__grid { width: 104px; height: 68px; padding-left: 28px; }
      .fl-tiles { gap: 12px; }
    }

    @media (prefers-reduced-motion: reduce) {
      :host { transition: none; }
      .fl-b { animation: none; background-image: none; }
      .fl-pill { animation: none; }
      .fl-hint { animation: fl-hint 0s linear 3s both; }
    }
  `],
})
export class FilesLoadingComponent {
  /** The app whose first screen is drawn (an unknown id falls back to the first app, as the editor does). */
  readonly app = input.required<FilesAppId | string>();
  /** `file`: the editor with a file; `start`: the app's own start screen (`/files/<kind>/start`). */
  readonly mode = input<FilesLoadingMode>('file');

  protected readonly def = computed(() => filesApp(this.app()) ?? FILES_APPS[0]);
  protected readonly appId = computed(() => this.def().id);
  protected readonly label = computed(() => `Opening ${this.def().name}…`);
  protected readonly startNav = computed(() => START_NAV[this.appId() as keyof typeof START_NAV] ?? []);
  protected readonly tiles = computed(() => this.range(START_TILES[this.appId()]));

  protected readonly letters = LETTERS;
  protected readonly rows = ROWS;
  protected readonly sheetBars = SHEET_BARS;
  protected readonly menu = MENU;
  protected readonly pdfMenu = PDF_MENU;
  protected readonly pdfTabs = PDF_TABS;
  protected readonly pdfTools = [86, 54, 66, 72, 92, 104, 96, 74, 88, 78];
  protected readonly retinaTools = Array.from({ length: 16 }, (_, i) => i + 1);
  protected readonly docLines = [96, 92, 98, 60, 0, 94, 97, 90, 72, 0, 95, 88, 64];

  protected tabsFor(id: 'neuron' | 'synapse' | 'axon'): readonly string[] { return TABS[id]; }
  protected ribbonFor(id: 'neuron' | 'synapse' | 'axon'): readonly { big: number; cols: number }[] { return RIBBON[id]; }
  protected icon(name: string): readonly string[] { return ICONS[name] ?? ICONS['New']; }
  protected range(n: number): number[] { return Array.from({ length: n }, (_, i) => i); }
}
