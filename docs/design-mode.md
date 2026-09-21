# Design mode — capture any screen into Figma

Design mode lets a designer capture **live app screens** (real data, real
styles) straight into Figma as **editable layers** — no localhost, no
developer in the loop. It works on any environment the designer can sign
into (dev server included).

## One-time setup (designer)

1. Ask an admin to grant your user the **Design mode** permission
   (Admin → Users & roles → role editor → *Setup & configuration* →
   "Design mode"). Lab Admins have it by default.
2. Install the **html.to.design** Chrome extension
   (chrome web store → "html.to.design").
3. In Figma, open the **html.to.design** plugin in the file you want
   captures to land in, and keep it open.

## Capturing a screen

1. In the app, open the avatar menu (top-right) → **Design mode** → On.
   - The screen freezes for capture: animations/transitions pause, the
     text caret hides.
   - A small badge appears bottom-left showing the **frame name**
     (route + breakpoint + width). Click it to copy — paste as the Figma
     frame name so captures stay consistently named.
2. Navigate to the screen and state you want (open panels, pick the
   breakpoint by resizing the window — the badge shows Phone / Tablet /
   Laptop / Wide live).
3. Minimise the badge (— button) so it isn't in the capture.
4. Click the **html.to.design extension** button → the screen lands in
   Figma as editable layers.
5. Repeat for as many screens/states as you like. Design mode stays on
   until you switch it off (avatar menu or the ✕ on the badge).

## Frame naming convention

`<route> · <breakpoint> <width>` — e.g. `lab/my-work · Laptop 1280`.
This matches the existing capture pages in the Figma file.

## Notes

- Design mode is a pure UI affordance — it grants **no extra data
  access**. Captures show exactly what that user can already see, so use
  a demo tenant (Micro World) when capturing patient-facing screens.
- The permission code is `design_mode` (seeded by the backend; grantable
  per role in the role editor).
