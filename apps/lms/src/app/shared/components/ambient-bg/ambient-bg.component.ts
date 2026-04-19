import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * Ambient flowing background — lives behind all shell content at z-index 0.
 * Three layers, each with heavy blur + low opacity so they read as atmosphere,
 * never noise:
 *
 *  1. Base wash — 135° multi-stop gradient keyed to the theme
 *  2. DNA flow — vertical-scrolling column of radial gradient blobs (40s loop)
 *  3. Drifting elements — ECG pulse lines, DNA helix coils, medical glyphs
 *     floating across the viewport
 *
 * Ported from resident-fe's floating-bg pattern. Respects prefers-reduced-motion.
 */
@Component({
  selector: 'pf-ambient-bg',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="root" aria-hidden="true">
      <!-- Base wash -->
      <div class="wash"></div>

      <!-- DNA flow: two scrolling layers of blurred blobs offset in time -->
      <div class="dna-flow"></div>

      <!-- Floating medical elements -->
      <div class="float-layer">
        <!-- ECG pulse lines drifting across -->
        <svg class="float float-pulse float-1" viewBox="0 0 200 50" preserveAspectRatio="none">
          <path d="M0,25 L30,25 L40,10 L50,40 L60,20 L70,30 L80,25 L200,25"
                fill="none" stroke="currentColor" stroke-width="2"/>
        </svg>
        <svg class="float float-pulse float-2" viewBox="0 0 200 50" preserveAspectRatio="none">
          <path d="M0,25 L30,25 L40,10 L50,40 L60,20 L70,30 L80,25 L200,25"
                fill="none" stroke="currentColor" stroke-width="2"/>
        </svg>

        <!-- DNA helix coils rising -->
        <svg class="float float-dna float-3" viewBox="0 0 60 200">
          <path d="M10,0 Q50,25 10,50 Q-30,75 10,100 Q50,125 10,150 Q-30,175 10,200"
                fill="none" stroke="currentColor" stroke-width="2"/>
          <path d="M50,0 Q10,25 50,50 Q90,75 50,100 Q10,125 50,150 Q90,175 50,200"
                fill="none" stroke="currentColor" stroke-width="2"/>
        </svg>
        <svg class="float float-dna float-4" viewBox="0 0 60 200">
          <path d="M10,0 Q50,25 10,50 Q-30,75 10,100 Q50,125 10,150 Q-30,175 10,200"
                fill="none" stroke="currentColor" stroke-width="2"/>
          <path d="M50,0 Q10,25 50,50 Q90,75 50,100 Q10,125 50,150 Q90,175 50,200"
                fill="none" stroke="currentColor" stroke-width="2"/>
        </svg>

        <!-- Medical cross glyphs drifting -->
        <svg class="float float-glyph float-5" viewBox="0 0 24 24" fill="currentColor">
          <path d="M10 3h4v7h7v4h-7v7h-4v-7H3v-4h7z"/>
        </svg>
        <svg class="float float-glyph float-6" viewBox="0 0 24 24" fill="currentColor">
          <path d="M10 3h4v7h7v4h-7v7h-4v-7H3v-4h7z"/>
        </svg>

        <!-- Heartbeat pulse large -->
        <svg class="float float-heart float-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5l7 7Z"/>
          <path d="M3.22 12H9.5l.5-1 2 4 1-2 1.5 1h5.27"/>
        </svg>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      position: fixed;
      inset: 0;
      z-index: 0;
      overflow: hidden;
      pointer-events: none;
    }
    .root { position: absolute; inset: 0; }

    /* ── Layer 1: base wash ───────────────────────────────────── */
    .wash {
      position: absolute;
      inset: 0;
    }
    :root.dark .wash, :root:not(.light) .wash {
      background:
        linear-gradient(135deg, #0a0612 0%, #0d0818 25%, #12091f 50%, #0d0818 75%, #0a0612 100%);
    }
    :root.light .wash {
      background:
        linear-gradient(135deg, #f5f0fc 0%, #ece1f8 25%, #e2d4f2 50%, #ece1f8 75%, #f5f0fc 100%);
    }

    /* ── Layer 2: DNA flow (blurred gradient column scrolling) ─ */
    .dna-flow {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 200%;
      animation: pf-dna-scroll 40s linear infinite;
    }
    .dna-flow::before,
    .dna-flow::after {
      content: '';
      position: absolute;
      inset: 0;
      height: 100%;
    }
    :root.dark .dna-flow::before,
    :root:not(.light) .dna-flow::before {
      background-image:
        radial-gradient(ellipse 220px 14px at 15%  5%, rgba(139,  92, 246, 0.38) 0%, transparent 70%),
        radial-gradient(ellipse 200px 12px at 40% 15%, rgba(168,  85, 247, 0.32) 0%, transparent 70%),
        radial-gradient(ellipse 220px 14px at 70% 25%, rgba(139,  92, 246, 0.38) 0%, transparent 70%),
        radial-gradient(ellipse 200px 12px at 25% 40%, rgba(168,  85, 247, 0.30) 0%, transparent 70%),
        radial-gradient(ellipse 220px 14px at 80% 55%, rgba(139,  92, 246, 0.34) 0%, transparent 70%),
        radial-gradient(ellipse 200px 12px at 50% 70%, rgba(168,  85, 247, 0.30) 0%, transparent 70%),
        radial-gradient(ellipse 220px 14px at 80% 85%, rgba(139,  92, 246, 0.38) 0%, transparent 70%);
      filter: blur(30px);
    }
    :root.dark .dna-flow::after,
    :root:not(.light) .dna-flow::after {
      background-image:
        radial-gradient(ellipse 200px 12px at 80% 10%, rgba(236,  72, 153, 0.28) 0%, transparent 70%),
        radial-gradient(ellipse 220px 14px at 55% 20%, rgba(217,  70, 239, 0.30) 0%, transparent 70%),
        radial-gradient(ellipse 200px 12px at 15% 35%, rgba(236,  72, 153, 0.24) 0%, transparent 70%),
        radial-gradient(ellipse 220px 14px at 65% 50%, rgba(217,  70, 239, 0.28) 0%, transparent 70%),
        radial-gradient(ellipse 200px 12px at 30% 65%, rgba(236,  72, 153, 0.26) 0%, transparent 70%),
        radial-gradient(ellipse 220px 14px at 75% 80%, rgba(217,  70, 239, 0.28) 0%, transparent 70%),
        radial-gradient(ellipse 200px 12px at 40% 95%, rgba(236,  72, 153, 0.24) 0%, transparent 70%);
      filter: blur(35px);
    }
    :root.light .dna-flow::before {
      background-image:
        radial-gradient(ellipse 220px 14px at 15%  5%, rgba(124,  58, 237, 0.22) 0%, transparent 70%),
        radial-gradient(ellipse 200px 12px at 40% 15%, rgba(168,  85, 247, 0.20) 0%, transparent 70%),
        radial-gradient(ellipse 220px 14px at 70% 25%, rgba(124,  58, 237, 0.22) 0%, transparent 70%),
        radial-gradient(ellipse 200px 12px at 25% 40%, rgba(168,  85, 247, 0.18) 0%, transparent 70%),
        radial-gradient(ellipse 220px 14px at 80% 55%, rgba(124,  58, 237, 0.20) 0%, transparent 70%),
        radial-gradient(ellipse 200px 12px at 50% 70%, rgba(168,  85, 247, 0.18) 0%, transparent 70%),
        radial-gradient(ellipse 220px 14px at 80% 85%, rgba(124,  58, 237, 0.22) 0%, transparent 70%);
      filter: blur(30px);
    }
    :root.light .dna-flow::after {
      background-image:
        radial-gradient(ellipse 200px 12px at 80% 10%, rgba(219,  39, 119, 0.18) 0%, transparent 70%),
        radial-gradient(ellipse 220px 14px at 55% 20%, rgba(217,  70, 239, 0.20) 0%, transparent 70%),
        radial-gradient(ellipse 200px 12px at 15% 35%, rgba(219,  39, 119, 0.16) 0%, transparent 70%),
        radial-gradient(ellipse 220px 14px at 65% 50%, rgba(217,  70, 239, 0.20) 0%, transparent 70%),
        radial-gradient(ellipse 200px 12px at 30% 65%, rgba(219,  39, 119, 0.18) 0%, transparent 70%),
        radial-gradient(ellipse 220px 14px at 75% 80%, rgba(217,  70, 239, 0.20) 0%, transparent 70%),
        radial-gradient(ellipse 200px 12px at 40% 95%, rgba(219,  39, 119, 0.16) 0%, transparent 70%);
      filter: blur(35px);
    }
    @keyframes pf-dna-scroll {
      to { transform: translateY(-50%); }
    }

    /* ── Layer 3: drifting medical elements ──────────────────── */
    .float-layer {
      position: absolute;
      inset: 0;
    }
    .float {
      position: absolute;
      filter: blur(6px);
    }

    .float-pulse {
      width: 300px;
      height: 60px;
      color: rgba(139, 92, 246, 0.28);
    }
    .float-1 {
      top: 28%;
      left: -5%;
      animation: pf-float-right 35s linear infinite;
    }
    .float-2 {
      top: 72%;
      right: -5%;
      width: 350px;
      color: rgba(236, 72, 153, 0.24);
      animation: pf-float-left 42s linear infinite;
      animation-delay: -15s;
    }
    @keyframes pf-float-right {
      to { transform: translateX(calc(100vw + 100%)) rotate(5deg); }
    }
    @keyframes pf-float-left {
      from { transform: translateX(100vw) rotate(5deg); }
      to   { transform: translateX(-100%) rotate(-5deg); }
    }

    .float-dna {
      width: 80px;
      height: 250px;
      color: rgba(139, 92, 246, 0.22);
      filter: blur(4px);
      animation: pf-float-up 50s linear infinite;
    }
    .float-3 { top: 40%; left: 5%; }
    .float-4 {
      top: 60%;
      right: 8%;
      width: 60px;
      height: 200px;
      color: rgba(236, 72, 153, 0.20);
      animation-delay: -12s;
    }
    @keyframes pf-float-up {
      to { transform: translateY(-120%) rotate(360deg); }
    }

    .float-glyph {
      width: 60px;
      height: 60px;
      filter: blur(8px);
      opacity: 0.55;
      animation: pf-glyph-drift 55s linear infinite;
    }
    .float-5 {
      top: 38%;
      left: 85%;
      color: rgba(16, 185, 129, 0.32);
    }
    .float-6 {
      top: 62%;
      left: 3%;
      width: 80px;
      height: 80px;
      color: rgba(139, 92, 246, 0.26);
      animation-delay: -20s;
    }
    @keyframes pf-glyph-drift {
      0%   { transform: translate(0, 0) rotate(0deg); }
      25%  { transform: translate(30px, -40px) rotate(90deg); }
      50%  { transform: translate(-20px, -20px) rotate(180deg); }
      75%  { transform: translate(-40px, 30px) rotate(270deg); }
      100% { transform: translate(0, 0) rotate(360deg); }
    }

    .float-heart {
      width: 120px;
      height: 120px;
      color: rgba(236, 72, 153, 0.22);
      top: 15%;
      right: 12%;
      filter: blur(10px);
      animation: pf-heart-float 30s ease-in-out infinite;
    }
    @keyframes pf-heart-float {
      0%, 100% { transform: translate(0, 0) scale(1); }
      50%      { transform: translate(-30px, 30px) scale(1.1); }
    }

    /* Light-mode float colors (less saturated, darker for contrast) */
    :root.light .float-pulse.float-1 { color: rgba(124, 58, 237, 0.20); }
    :root.light .float-pulse.float-2 { color: rgba(219, 39, 119, 0.18); }
    :root.light .float-dna           { color: rgba(124, 58, 237, 0.18); }
    :root.light .float-dna.float-4   { color: rgba(219, 39, 119, 0.16); }
    :root.light .float-glyph.float-5 { color: rgba(5, 150, 105, 0.24); }
    :root.light .float-glyph.float-6 { color: rgba(124, 58, 237, 0.20); }
    :root.light .float-heart         { color: rgba(219, 39, 119, 0.18); }

    @media (prefers-reduced-motion: reduce) {
      .dna-flow,
      .float { animation: none; }
    }
  `]
})
export class AmbientBgComponent {}
