# Design mode — capture any screen into Figma

Design mode captures **live app screens** (real data, real styles) into
Figma as **editable layers** — no subscriptions, no third-party service,
no developer in the loop. Two halves:

1. **In the app** — a Design-mode switch in the avatar menu with a
   **Capture** button that saves the visible screen as a
   `.pfcapture.json` file (a self-contained layer tree).
2. **In Figma** — our own **Prefrontal Capture** plugin
   (`tools/figma-capture-plugin/`) rebuilds that file as native Figma
   frames, rectangles, text, vectors and images.

Anyone with Design mode can capture (e.g. the owner on the dev server)
and simply send the files to the designer — chat, drive, anything.

## One-time setup

**Whoever captures** needs the **Design mode** permission
(Admin → Users & roles → role editor → *Setup & configuration* →
"Design mode"). Lab Admins have it by default.

**The designer** (once, ~1 minute):

1. Get the `tools/figma-capture-plugin/` folder (three small files —
   zip it from the repo or have it sent over).
2. In the Figma **desktop app**: Menu → Plugins → Development →
   **Import plugin from manifest…** → pick `manifest.json` from that
   folder. "Prefrontal Capture" now appears under Plugins → Development,
   in every file, forever. No publishing, no account tier needed.

## Capturing a screen

1. Avatar menu (top-right) → **Design mode** → On. The app freezes for
   capture (animations pause, caret hides) and a badge appears bottom-left.
2. Navigate to the screen/state you want. The badge live-shows the frame
   name: `route · breakpoint width` (resize the window to switch
   Phone / Tablet / Laptop / Wide).
3. Hit **Capture** on the badge → a `.pfcapture.json` downloads
   (e.g. `lab-my-work-laptop1280.pfcapture.json`). The badge itself is
   never part of a capture.
4. Repeat for as many screens/states/breakpoints as you like, then send
   the files to the designer.

## Importing in Figma

Open **Plugins → Development → Prefrontal Capture** and drop the file(s)
in. Each becomes a frame named like `lab/my-work · Laptop 1280` — matching
the existing capture pages — with editable layers: real text layers, true
vector icons, glass blur as background-blur effects, shadows, gradients.

## Fidelity notes (v1)

- Layers are **pixel-accurate but absolutely positioned** — no
  auto-layout inference yet. Perfect as reference/redline; components
  are rebuilt on top as before.
- One text layer per element; mixed inline formatting inside a single
  element collapses to that element's font.
- Fonts must exist in Figma (Inter and JetBrains Mono are built in;
  anything missing falls back to Inter).
- Captures show exactly what the signed-in user sees — capture from the
  Micro World demo tenant when patient data would be on screen.
