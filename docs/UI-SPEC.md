# Prefrontal LMS — UI Functional Specification

Audience: Business Analysts and QC. This document is the contract for what every control in the Prefrontal LMS UI must do. It consolidates the eleven area briefs into one numbered specification.

---

## 1. How to read this document

**The control-table format.** Every screen is specified as one table with six columns:

| Column | Meaning |
|---|---|
| ID | The document-wide unique control identifier (see numbering scheme below) |
| Control (label) | The visible label or name of the control |
| Type | What kind of widget it is (button, text input, toggle, read-only display, …) |
| What it does | The control's function in plain language |
| Rules / validation | Enable/disable conditions, visibility gating, input validation, defaults |
| Result (success / failure) | What the user observes after acting — on success AND on failure |

Each screen section also states its **Purpose**, **Who sees it** (permission / module / workflow gating), and ends with numbered **Flows** — end-to-end scenarios QC can execute as pass/fail scripts. "Toast" throughout means the app's transient notification banner (green = success, red = error, amber = warning, violet/blue = info).

**The numbering scheme.** Every control ID is `PREFIX-n`, where the prefix identifies the screen (or shared surface) and `n` is a running number within it. Prefixes are unique document-wide, so any control can be referenced unambiguously in a bug report (e.g. "REG-3", "BILL-7"). The full prefix map:

| Prefix | Screen / surface | Prefix | Screen / surface |
|---|---|---|---|
| LGN | Sign in | RQ | Report queue |
| SPW | Choose a new password | RV | Report viewer |
| TOP | Desktop top bar | PUB | Public report viewer (patient) |
| NAV | Mobile & tablet navigation | TRK | Result tracking (patient) |
| SHL | Shell-global elements | BILL | Collect payment |
| FDL | Frontdesk landing & order board | CNTR | Billing counter |
| APS | Advanced patient search dialog | AINV | Admin inventory |
| REG | Register patient | STO | Stores / inventory desk |
| PPF | Patient profile | RLAB | Referral / outsourced labs |
| DOC | Patient profile — Documents tab | LBL | Post-payment label printing (outsourcing badge) |
| QRP | Patient QR open (/p/:id) | RPT | Report "Tested at" line |
| ORD | Build an order | LSET | Lab settings |
| PAY | Build an order — inline payment pane | TST | Tests catalog |
| OQR | Order QR router (/o/:id) | PRC | Tests catalog — Pricing tab |
| SCOL | Sample collection worklist & collect drawer | TED | Test editor |
| REJ | Reject-with-reason dialog | USR | Users & access |
| SCAN | Barcode scanner modal | INV | Invite user |
| QUE | Collection queue | ROL | Role editor |
| HCA | Unassigned home collections | BRN | Branches & departments |
| HCV | My visits (home-collection agent) | PWB | Process workflow builder |
| AGT | Home-collection agents (admin) | BCF | Billing config (admin) |
| MW | Lab — My Work / workbench | MSGL | Messages — locked screen |
| SRE | Sample-level result entry | RAIL | Messages — left rail, Chats tab |
| RE | Legacy per-test result entry | CLOG | Messages — Calls tab |
| CUL | Culture & sensitivity entry | THR | Messages — thread |
| PLM | Plate measure dialog | CMP | Messages — composer |
| DEL | Delegate modal | NEWC | New chat / new group modal |
| CMT | Comment thread (shared) | MEM | Group members modal |
| PV | Pending validation queue | ADDM | Add-member sub-modal |
| VR | Validate result | FWD | Forward modal |
| KPI | KPI configuration (admin) | RING | Incoming-call ringer |
| | | ORING | Outgoing-call ringer |
| | | CALL | Active-call screen |
| | | PILL | Minimized call pill |
| | | PPL | People drawer |
| | | NTF | Notification surfaces |

Where two source briefs described the same screen, they have been merged into a single section and renumbered; cross-references inside tables always use the final IDs in this document.

**The golden rule.** *Behavior not specified here is a question for the BA, not a guess.* If a tester or developer encounters a state, control, or transition this document does not describe, the correct action is to raise it with the BA — never to assume intended behavior, and never to pass/fail it on intuition. Sections explicitly marked "known gaps" or "out of scope" describe current behavior that is documented but not necessarily intended; log these as noted, not as new defects.

A complete **Control index** (every ID → screen → label) is in the appendix at the end.

---

## 2. Auth & App Shell

**Scope note for QC:** The shell has exactly two live navigation surfaces: the desktop **top strip** (viewports ≥ 1280 px wide, web/Electron only) and the **bottom nav** (floating pill on phones ≤ 640 px; vertical left rail 641–1279 px and on ALL native builds regardless of width, including large iPad Pro). There is no classic expandable sidebar in the live shell. Everything below reflects what actually renders.

### 2.1 Sign in (/login)

**Purpose:** Tenant-scoped staff sign-in using organization + username + password.
**Who sees it:** Anyone signed out. A user navigating anywhere while unauthenticated is redirected here with a `returnUrl` query parameter preserved.

| ID | Control (label) | Type | What it does | Rules / validation | Result (success / failure) |
|---|---|---|---|---|---|
| LGN-1 | Organization | Text input with suggestion dropdown | Captures the tenant/organization name. Typing clears any visible error. Dropdown suggests up to 8 previously-used organizations (most recent first, remembered on this device after successful sign-ins). Pre-filled with the most recent remembered org on load, or with the `org` query parameter from a credentials-email deep link. | Required (non-empty after trimming). Autocapitalize/autocorrect/spellcheck off. | Feeds LGN-4 submit. |
| LGN-2 | Username | Text input | Captures the username. Typing clears any visible error. Pre-filled from a `username` query parameter on deep link. | Required (non-empty after trimming). | Feeds LGN-4 submit. |
| LGN-3 | Password | Password input + eye toggle button | Captures the password. Typing clears any visible error. The eye icon toggles masked/plain-text display (icon and accessible label switch "Show password"/"Hide password"). | Required (at least 1 character). Not trimmed. | Feeds LGN-4 submit. |
| LGN-4 | Sign in | Submit button | Attempts sign-in. Works on Enter (form submit) AND on click (duplicate submissions suppressed). While in flight the label changes to "Signing in…" with a spinner and the form dims. | Disabled only while a sign-in is in flight. Clicking with any field empty does NOT call the server; shows inline error "Enter your organization, username and password to continue." Hard 15-second timeout aborts a hung request with "Sign-in timed out — check your connection". | **Success:** org remembered for LGN-1; then routing: (1) account owes a password change → /set-password; (2) else a valid `returnUrl` (not "/login" or "/", and admin URLs require an admin permission) → go there; (3) else land by first matching permission: manage_tests→Admin, register_patient→Frontdesk, enter_result→Lab My Work, validate_result→Pathologist, collect_sample→Sample Collection, any inventory permission→Stores, dashboard permissions→Dashboard; (4) fallback → Dashboard. **Failure:** inline error banner (LGN-5) with a humanized message; button re-enables. |
| LGN-5 | Error banner | Inline alert (conditional) | Shows the current sign-in error with a "!" icon. | Appears only after a failed/blocked submit; cleared by typing in any field. Messages: wrong credentials → "Wrong organization, username or password. Try again."; network/CORS failure → "Can't reach the backend (host)…" (extra CORS hint on native builds); expired session → "Session expired. Try again."; otherwise the raw server message. | — |
| LGN-6 | "Locked out? Ask your admin to reset your password." | Static hint text | Informational only — there is deliberately NO self-service password reset link. | — | — |
| LGN-7 | API host strip (native builds only) | Static diagnostic text | On iOS/Android app builds only, shows "api" + the backend host the app points at, so connection problems are diagnosable from login. Never shown on web. | — | Not interactive. |

**Flows**
1. Normal sign-in: enter org/username/password → Sign in → "Signing in…" → lands on the permission-appropriate home (LGN-4 routing order).
2. First login / after admin reset: sign in with the temporary password → automatically routed to /set-password; the rest of the app is blocked until a new password is set.
3. Credentials-email deep link: opening /login?org=X&username=Y pre-fills both fields; the user types only the temp password.
4. Deep-link bounce: visiting a protected URL while signed out redirects to /login?returnUrl=…; after sign-in the user returns there — unless it is an admin URL and they hold no admin permission, then they land on their role home.
5. Wrong password: red inline error; fields keep their values; typing in any field clears the error.
6. Returning user on same device: Organization is pre-filled with the last used org and the dropdown offers up to 8 previous ones.
7. Restored session: a user with a still-valid saved session goes straight in without re-typing credentials (session survives app restarts; expired tokens are silently refreshed once).

### 2.2 Choose a new password (/set-password)

**Purpose:** Forced replacement of a temporary password before any other screen is usable.
**Who sees it:** Only a signed-in user who still owes a password change. Signed-out visitors are bounced to /login; users who don't owe a change are bounced to the app root. While the obligation is pending, EVERY in-shell route redirects back here.

| ID | Control (label) | Type | What it does | Rules / validation | Result (success / failure) |
|---|---|---|---|---|---|
| SPW-1 | New password | Password input + shared eye toggle | Captures the new password. Typing clears any error. The eye toggle reveals/masks BOTH password fields simultaneously. | 8–64 characters (length-only policy, no composition rules). Live amber hint "At least 8 characters." appears once 1–7 characters are typed. The server independently re-checks length and screens against known-breached passwords — a breached password is rejected server-side even if the client accepts it. | Feeds SPW-3. |
| SPW-2 | Confirm password | Password input | Re-entry of the new password. Typing clears any error. | Must match SPW-1 exactly. Live amber hint "Passwords don't match." once the fields differ. | Feeds SPW-3. |
| SPW-3 | Set password & continue | Submit button | Saves the new password. Shows "Saving…" with spinner while in flight. | **Disabled** until: new password is 8–64 chars AND both fields match (re-disabled while saving). Belt-and-braces: even if submitted, out-of-range length shows "Password must be 8–64 characters." and mismatch shows "The two passwords don't match." without calling the server. | **Success:** forced-change gate clears; user is routed to the app root, then to their permission-appropriate home. **Failure:** server error in the inline banner (e.g. breached-password rejection); button re-enables. |
| SPW-4 | Sign in as a different user | Text-style button | Abandons the password change: signs the current session out and returns to /login. | Always enabled. | User is signed out; the obligation persists for that account's next login. |
| SPW-5 | Error banner | Inline alert (conditional) | Shows validation or server errors with a "!" icon. | Cleared by typing in either field. | — |

**Flows**
1. Happy path: type a valid password twice → button enables → Set password & continue → lands on role home; revisiting /set-password afterwards bounces to the app root.
2. Escape attempt: while the change is owed, manually navigating to any app URL redirects back to /set-password.
3. Mismatch: confirm field differs → live "Passwords don't match." hint + button stays disabled.
4. Server rejection (e.g. breached password): inline error; user picks a different password and retries.

### 2.3 Desktop top bar (all authenticated routes, viewport ≥ 1280 px, web/Electron only)

**Purpose:** Persistent chrome: branding, primary workflow navigation, branch context, quick actions (scan, admin, people, notifications), and the profile menu.
**Who sees it:** Every authenticated user on a wide web/desktop viewport. Hidden entirely on phones/tablets (≤ 1279 px) and on ALL native builds (they use NAV instead). Individual controls are permission-gated as listed.

| ID | Control (label) | Type | What it does | Rules / validation | Result (success / failure) |
|---|---|---|---|---|---|
| TOP-1 | Prefrontal brand lockup (PF glyph + pulse + "PREFRONTAL / Lab Management System") | Link | Navigates "home" — the first landing the user's permissions allow (same priority list as login routing). | Always visible. | Navigates; a user with no landing permission goes to the 403 page. |
| TOP-2 | Tenant/client brand pill (logo and/or org name) | Link (admins) / static badge (others) | Shows the organization's branding. Rendering follows the tenant's branding mode: logo only, name only, or both; falls back to the org's initial in a colored square when no logo. For users with any admin permission it is a LINK to the Setup/Branding wizard; display-only for everyone else. | Renders only after tenant info has loaded (no placeholder flash). Hidden on very narrow widths. | Admin click → Setup wizard. |
| TOP-3 | Primary nav (icon+label buttons, e.g. Frontdesk, Lab, Collect, Billing, Queue, Home Visits, Validate, Results, Messages, Inventory) | Link group | One button per work area; active route highlighted. The set is **dynamic**: built from the admin-configured active workflow (admin's area names, icons, order), falling back to built-in defaults when no workflow is configured. | Per-item gating (APF-ed): user holds ≥1 of the item's permissions; branch collection mode (e.g. "Collect" only in dedicated-counter mode); branch billing mode (e.g. "Billing" counter only in separate-counter mode); branch inventory toggle; tenant plan module entitlement (Inventory / Messages / Home Collection / Reports); the workflow action must be enabled in the Process builder. Messages leaves no trace when the module is off. | Click navigates to the work area's screen. |
| TOP-4 | Branch pill (pin icon + branch name + chevron) | Dropdown trigger | Opens the branch switcher popover. Shows the current active branch name. | Rendered once tenant info loads (≥ medium widths only). **Disabled** (no chevron, non-interactive) when the user may access only one branch. Opening closes any other popover. Escape / outside click closes. | Opens TOP-5. |
| TOP-5 | Branch switcher popover | Menu | Header "Active branch" + current name, then one row per accessible branch; active row carries a checkmark. | Only branches from the user's permitted list. Selecting the already-active branch does nothing. | Selecting a different branch: choice persisted on the device, then the **whole app reloads** so every screen re-scopes. All API calls carry the new branch; the server independently validates it against the user's permitted list and falls back to their default if not allowed. A stale stored branch (revoked access) is silently reset to the user's default at next profile load. |
| TOP-6 | Scan order QR | Icon button | Opens the full-screen camera/barcode scanner modal titled "Scan order QR". | Visible only when the workflow's sample-collection action is enabled AND the user holds collect_sample. | Successful scan: a patient ID-card QR jumps to that patient's profile; any other code is resolved server-side to an order and opens it (collection drawer or patient profile per the user's rights). A code matching nothing is **silently ignored** (scanner stays available, no error toast). Cancel closes the modal. |
| TOP-7 | Admin (gear) | Icon link | Navigates to the Admin overview. | Visible only with at least one of: manage tests / users / workflows / branches. Desktop-only by design (mobile gets its Admin tab in the bottom nav). Highlights on admin routes. | Navigates to /admin. |
| TOP-8 | People | Icon button with unread badge | Toggles the slide-out People drawer (tenant contacts, live presence dots, 1:1 chat, per-person voice-call entry). | Visible only when the Messages workflow action is enabled AND the tenant plan includes the Messages module. Badge shows total unread chat count, capped at "9+". Active state while the drawer is open. | Drawer opens/closes. |
| TOP-9 | Notifications bell | Icon button with count badge | Toggles the notifications panel. Bell shakes periodically while unread items exist. Badge shows unread count, capped at "99+". | Visible to all authenticated users. List refreshes every time the panel opens. Escape / outside click closes. | Opens TOP-10. |
| TOP-10 | Notifications panel ("Inbox / Notifications") | Popover panel | Lists notifications newest-first with a per-type colored icon (critical value/result rejected = red, sample rejected/TAT breach = amber, report ready = green, other = violet), title, optional body, time, type label. Unread rows are tinted with a dot. | **Empty state:** "You're all caught up / New alerts will land here." **"Mark all read"** link shows only while ≥1 unread exists. | Clicking an unread row marks just that one read (server call; row un-tints). Clicking a read row does nothing. "Mark all read" marks every unread read (immediately in the UI, one server call each). Rows do NOT navigate anywhere. |
| TOP-11 | Profile avatar (initials + presence dot) | Menu trigger | Opens the profile popover. Avatar shows the user's initials (first name + father's name initials, falling back to display-name initials) plus a presence dot (solid color; white dash for do-not-disturb grades; hollow ring for Away). | Always visible. Opening closes other popovers; Escape/outside click closes. | Opens TOP-12…16. |
| TOP-12 | Profile header | Static | Large initials + presence dot, display name, caption line. **Known cosmetic issue QC should expect:** the caption currently reads the hardcoded text "admin · mock" for every user, not their real role. | — | — |
| TOP-13 | Status row (current presence + chevron) | Expanding menu row | Shows the current presence status label; when the status is a DND grade it adds the sub-line "Calls & alerts silenced". Tapping expands/collapses the 7-preset list. | — | Expands TOP-14. |
| TOP-14 | Status presets list | Radio-style menu | Seven presets: Available (green), Busy (red), With a patient (red), On rounds (amber), In surgery (dark red, DND), Do not disturb (dark red, DND), Away (hollow grey). Current one carries a checkmark. Footer: "'In surgery' & 'Do not disturb' block incoming calls and silence push alerts." | One selectable at a time. | Picking one collapses the list, updates the avatar dot everywhere (top bar, mobile account button, People drawer), persists to the server and broadcasts live. DND grades cause the server to block incoming calls to this user and silence their device pushes; bell/unread counters still accumulate. |
| TOP-15 | Tenant branding | Menu link | Navigates to the Setup/Branding wizard and closes the menu. | Visible only with at least one admin permission. | Navigates to /setup. |
| TOP-16 | Switch to light / Switch to dark | Menu button | Toggles the app theme. Label and icon reflect the mode you'd switch TO. Closes the menu. | Always visible. | Theme flips immediately, persists across sessions. (Desktop menu is a two-state toggle; the mobile More menu instead cycles System→Light→Dark.) |
| TOP-17 | Sign out | Menu button (red) | Full logout sequence: unregisters push for this device, disconnects chat and call/signaling connections, resets any in-progress call state, closes open patient/appointment overlays, clears cached tenant/branch/entitlement data, clears the auth session, then navigates to /login. | Always visible. | Lands on /login signed out. Each teardown step is best-effort — a failure in one (e.g. push unregister offline) does not block sign-out. |

**Flows**
1. Branch switch: click branch pill → popover lists permitted branches → pick another → app fully reloads scoped to the new branch; pill shows the new name. Single-branch users see a non-interactive pill.
2. Only one popover at a time: opening the branch picker closes the profile menu and vice versa; Escape or clicking outside closes whichever is open.
3. Scan-to-open: Scan → camera modal → order QR → modal closes and the order opens; patient ID card QR → patient profile; unrecognized code does nothing visible.
4. Going DND: avatar → status row → "In surgery" → dot turns dark red with a white dash everywhere; teammates calling this user are told why the call won't ring; pushes are silenced until the status changes.
5. Notifications: badge shows 3 → open panel → click one unread row (badge drops to 2) → "Mark all read" → badge disappears, shake stops.
6. Permission-driven chrome: a receptionist (no manage permissions) sees no gear icon, no "Tenant branding" menu item, and cannot click the tenant brand pill; a lab tech without collect_sample sees no Scan button; a tenant without the Messages module sees no People button and no Messages nav item anywhere.

### 2.4 Mobile & tablet navigation (all authenticated routes; phone ≤ 640 px = floating bottom pill; 641–1279 px and all native builds = left rail)

**Purpose:** Sole navigation surface where the top bar is hidden: workflow tabs plus an account menu ("More") that absorbs the top bar's right-cluster actions.
**Who sees it:** Every authenticated user on phone/tablet web widths and on every native (iOS/Android) build at any width. Hidden ≥ 1280 px on web/desktop.

| ID | Control (label) | Type | What it does | Rules / validation | Result (success / failure) |
|---|---|---|---|---|---|
| NAV-1 | Workflow tabs (icons, e.g. Frontdesk / Lab / Collect / Validate / Results / Messages / Inventory) | Tab buttons | Same dynamic, permission/module/mode/workflow-gated set as the desktop primary nav (TOP-3). Tap navigates. A gradient indicator pill glides under the active tab. | With 4+ visible tabs the phone pill goes icon-only (labels return on wider widths); with ≤ 3 tabs labels always show. On the iPad rail, tabs are always icon-only and the active tab carries its own gradient highlight. | Tap → navigates; indicator springs to the tab. The active tab also tracks URL changes made elsewhere (deep links, back button). |
| NAV-2 | Drag-to-switch gesture (phone pill only) | Touch gesture | Press anywhere on the pill and slide horizontally: a magnifying "liquid glass" pill follows the finger, live-highlighting whichever tab it passes. | Requires ~4 px of horizontal movement to arm; not available in rail mode. The synthetic tap after a drag is suppressed (no double navigation). | Releasing navigates to the tab under the finger; releasing over the account button opens the More menu instead. |
| NAV-3 | Admin tab | Tab link (after a divider) | Navigates directly to the Admin overview. | Rendered only for users holding at least one manage permission — non-admins see no Admin tab at all. | Navigates to /admin; highlights on admin routes. |
| NAV-4 | Rail brand mark (rail mode only, top of rail) | Static badge | Shows the client/tenant logo (or org initial) — display only. | Rail mode only. | Not interactive. |
| NAV-5 | Notifications (rail: standalone bell near rail bottom; phone: inside More menu) | Icon button / menu row | Intends to open notifications. **Known gap QC should expect:** it navigates to a "/notifications" route that does not exist, so the tap currently does nothing visible (failure is swallowed). There is no notification bell panel on phone/tablet. | Rail: always shown. Phone: listed in the More menu. | No visible effect today — treat as unspecified/pending until a notifications screen exists. |
| NAV-6 | People (rail: standalone icon; phone: inside More menu) | Icon button / menu row | Opens the People drawer (contacts, presence, 1:1 chat, calls). | Shown only when the Messages workflow action AND module are enabled. | Drawer slides open; More menu closes first (phone). |
| NAV-7 | Account button (PF glyph + presence dot, end of pill / bottom of rail) | Menu trigger | Opens the "More" account popover (upward from the pill on phone; to the right of the rail on iPad). Carries the user's presence dot. | Always visible. Tap outside (transparent backdrop) or any action closes it. | Opens NAV-8…12. |
| NAV-8 | Status row + presets (in More menu) | Expanding radio menu | Identical behavior to the desktop status picker (TOP-13/TOP-14): current status with "Calls & alerts silenced" sub-line for DND grades; expands to the 7 presets with checkmark; footer note about In surgery/DND blocking calls. | — | Picking a status closes the menu, updates the dot, persists + broadcasts; DND grades block calls and silence pushes. |
| NAV-9 | Notifications / People rows (phone only) | Menu rows | Phone-only duplicates of NAV-5/NAV-6 (rail mode shows them as standalone rail buttons instead, so the menu omits them there). | Same gating as NAV-5/6. | Same results as NAV-5/6. |
| NAV-10 | Theme (with current-mode chip) | Menu row | Cycles the theme System → Light → Dark → System on each tap. "System" follows the OS appearance live. Trailing chip shows the current mode. The menu deliberately STAYS OPEN so the user can keep tapping and preview each mode. | Always visible. | Theme changes instantly each tap; persists. |
| NAV-11 | Branch (with current-branch chip) | Menu row | Each tap cycles to the next branch in a list. **Known gap QC should expect:** unlike the desktop branch switcher, this is UI-only against a hardcoded demo list (Chennai Main / Anna Nagar / T. Nagar / OMR) — it does NOT re-scope data, does not persist, and does not reload the app. Treat real branch switching on mobile as unspecified. | Always visible. | Chip label cycles; no data change. |
| NAV-12 | Sign out | Menu row (red) | Signs out: unregisters this device's push token first (while the session is still valid), clears the session, navigates to /login. | Always visible. | Lands on /login. Note: this path does a lighter teardown than the desktop sign-out (no explicit chat/call hub disconnect or tenant cache clear before redirecting). |
| NAV-13 | Auto-minimize (phone pill only) | Automatic behavior | Scrolling DOWN any page shrinks the pill toward bottom-center (~82% size, labels dropped, slightly dimmed); scrolling UP or returning near the top restores it. All tabs stay tappable while minimized. | Phone only; never on rail/desktop; disabled under reduced-motion (snaps instead of animating). | — |
| NAV-14 | Keyboard/chat hiding | Automatic behavior | The pill hides entirely while the soft keyboard is up (typing), and inside an open chat thread on phone (the message composer owns the bottom edge). Reappears when the keyboard/thread closes. | Phone/native only. | — |
| NAV-15 | Edge swipe back | Touch gesture on page content | A one-finger drag starting within ~28 px of the LEFT screen edge and travelling right drags the page with the finger; passing ~40% of screen width commits a "back" navigation, otherwise the page snaps back. | Touch only; disabled on top-level landing screens (nothing to go back to). | Commit → navigates back; cancel → page snaps back in place. |

**Flows**
1. Phone tab switch by drag: touch the pill on Frontdesk → slide right → the glass pill magnifies and passes Lab, Validate… → lift over Results → app navigates to Results; the follow-up tap event is ignored.
2. Account actions: tap the PF glyph → menu opens upward → tap Theme three times to preview Light, Dark, System (menu stays open) → tap Sign out → device push unregistered → login screen.
3. iPad rail: full-height left rail with client logo top; workflow icons; divider; Admin gear (admins only); then at the bottom bell, People, and the account glyph whose popover opens to the RIGHT of the rail.
4. Scroll behavior: reading a long worklist scrolls the pill down to its condensed form; a flick upward restores it instantly.
5. Non-admin user: sees only their workflow tabs + the account glyph — no Admin tab, and no People icon if Messages is off for the tenant.

### 2.5 Shell-global elements (visible on every authenticated screen)

**Purpose:** Cross-cutting overlays owned by the shell rather than any one page.
**Who sees it:** All authenticated users (individual items gated as noted).

| ID | Control (label) | Type | What it does | Rules / validation | Result (success / failure) |
|---|---|---|---|---|---|
| SHL-1 | Offline banner | Fixed top strip (red glass) | "No connection — changes won't save until you're back online" with a pulsing dot. Appears the moment connectivity drops (native network plugin on apps; browser online/offline events on web), disappears on reconnect. Sits above ALL other UI including toasts. | Shows only after connectivity state has initialized (no false flash on boot). Does not push content around. | Informational only; not dismissible. |
| SHL-2 | Toasts | Top-right stack | Success (green check), error (red cross), warning (amber), info (violet) message cards raised by any screen's actions. Each has a close (×) button. | Anchored top-right on purpose (clear of bottom nav and page action buttons). | × dismisses that toast. |
| SHL-3 | Barcode scanner modal | Full-screen overlay | The camera scanner opened by the top-strip Scan button (TOP-6). "Scan order QR" title; scanning a code resolves it to an order and navigates; Cancel closes. | Only exists while scanning is active. Unmatched codes are silently ignored. | Match → navigate to the order-open screen; cancel → close. |
| SHL-4 | Dialog host | Themed prompt/confirm overlay | Renders the app's styled replacements for browser prompt/confirm dialogs, invoked by feature screens. | — | Per invoking feature. |
| SHL-5 | Call overlay & People drawer | Global overlays | Incoming-call ringer + active-call pill, and the contacts/chat drawer. | Rendered ONLY when the tenant's plan includes the Messages module — a gated tenant has no trace of calls/chat and never connects to the realtime hubs. | Per the Comms chapter. |
| SHL-6 | Patient profile modal | Global modal | Any screen can pop a patient's profile over the current page without navigation. | — | Per the Reception / Patients chapter. |
| SHL-7 | Route-level access handling | Automatic | Every in-shell route re-checks: authentication (else → /login with returnUrl), the owed-password gate (else → /set-password), per-route permissions, workflow-action enablement, and module entitlement. Blocked users land on the 403 page ("Forbidden — You do not have permission for this action."). Unknown URLs redirect to the root, which then routes by permission. | Landing priority when hitting "/": Admin → Frontdesk → Lab My Work → Pathologist → Sample Collection → Stores → Dashboard → 403. | — |
| SHL-8 | Stale-permission refresh | Automatic | When the app window regains focus after ≥ 5 minutes, the user's roles/permissions are silently re-fetched — an admin revoking a permission takes effect on the open tab's next focus, hiding the relevant nav items/screens. | Best-effort; retries on next focus. | Nav and gating recompute live. |

**Flows (global)**
1. Session expiry mid-use: an API call gets a 401 → one silent token refresh is attempted; only if that fails is the user signed out and returned to /login.
2. Permission revoked while working: admin removes a permission → within one focus-cycle (≤ 5 min idle) the tab re-fetches the profile → affected nav tabs vanish; directly visiting the now-forbidden URL yields the 403 page.
3. Going offline: pull the network → red banner appears instantly at the very top on every layout (including phone where there is no top bar); restore network → banner disappears.

**Known gaps QC should log as current behavior, not necessarily intended:** (a) profile popover caption is hardcoded "admin · mock"; (b) mobile More-menu Branch row cycles a hardcoded demo branch list and does not re-scope data (the desktop branch switcher is the real one); (c) mobile Notifications button targets a route that doesn't exist and silently does nothing; (d) notification rows never deep-link to the referenced order/report; (e) the mobile sign-out performs a lighter teardown than desktop.

---

## 3. Reception / Patients & Frontdesk

**Scope note for QC:** All screens below live under the Frontdesk shell. The route parent `/frontdesk` requires at least one of: *register_patient*, *create_order*, *view_patient*. Legacy `/reception/...` URLs permanently redirect to the equivalent `/frontdesk/...` URLs (bookmarks must still work). All money is Indian Rupees (₹). Cross-cutting rules for this chapter and the Orders chapter: workflow toggles (walk-in order, appointment, sample collection, billing, home visits, patient registration, queue) are admin-configurable per tenant — a disabled workflow removes the corresponding controls/routes without error. Branch billing mode is either **front-desk billing** (payment taken on the order screen) or **separate billing counter** (order screen only raises an invoice).

### 3.1 Frontdesk landing & order board (`/frontdesk`)

**Purpose:** Reception's home: the patient-search entry points into every patient flow, PLUS the live operations board — lists of in-progress and completed orders (and appointment/home-collection panes), with per-order lifecycle actions (bill, collect, dispatch, labels, download report) and a detail drawer offering profile/repeat/invoice/modify/report/labels/cancel. Also hosts the billing surfaces: payments-due drawer, per-order Create Bill / View invoice, and the Cancel-order dialog. Data auto-refreshes on a ~30 s poll; several actions force an immediate refresh.
**Who sees it:** Any user with *register_patient*, *create_order*, or *view_patient*. Individual actions/icons are further gated per permission/workflow as noted.

| ID | Control (label) | Type | What it does | Rules / validation | Result (success / failure) |
|---|---|---|---|---|---|
| FDL-1 | "Search patient · name, phone, MRN, ABHA…" | Text input with typeahead dropdown | Live patient lookup. Debounced 220 ms; queries the patient search API, max 10 results. | Minimum 2 characters (below that, hint "Type at least 2 characters to search"). Dropdown only opens while the field is focused. | Results show avatar, full name, phone · sex · age. Clicking a row (or Enter on the highlighted row) opens that patient's profile. No matches → "No patient matches "…"". API error → silently shows empty list. |
| FDL-2 | Clear (×) inside search field | Icon button | Empties the field and results. | Only visible when the field has text. | Field cleared; dropdown closes. |
| FDL-3 | ↑ / ↓ / Enter / Esc in search field | Keyboard | Arrow keys move the highlight through results (wraps); Enter picks the highlighted result; Esc clears and closes. | First result auto-highlighted when results arrive. | Enter → navigates to that patient's profile. |
| FDL-4 | Advanced-search icon (funnel, right edge of search field; tooltip "Advanced search · ⌘K") | Icon button | Opens the Advanced Patient Search dialog (APS). | Also opened by Cmd+K / Ctrl+K anywhere on the landing page — except while typing in another input. Cmd+K toggles (press again to close). | Modal opens with focus in the Mobile-number field. |
| FDL-5 | Scan QR (header icon) | Icon button | Opens the camera barcode/QR scanner modal. | Scanned order QR (`…/o/{id}`) opens the order via the Order-QR router (OQR); result-tracking QR (`…/track/{token}`) opens the public tracker; any other text (MRN / phone from a patient ID card) runs the patient lookup and the **top** match's profile opens. | Match → navigation. No match → warning toast "No match for that code". |
| FDL-6 | Book appointment (header icon) | Link | Goes to `/frontdesk/appointments/new`. | Only visible when the appointment workflow is enabled. | Navigation. |
| FDL-7 | Create order (header icon) | Link | Goes to `/frontdesk/order`. | Only visible when the walk-in-order workflow is enabled. | Navigation. |
| FDL-8 | New patient (+ header icon, primary style) | Button | Goes to `/frontdesk/patients/new`. | Only visible when the patient-registration workflow step is enabled (mandatory/locked by default, so normally always shown). | Navigation to Register Patient. |
| FDL-9 | "New patient" (empty-state tile CTA) | Button | Same as FDL-8, shown inside empty-state widgets when there is no activity yet. | — | Navigation to Register Patient. |
| FDL-10 | "N ready" alert chip (header) | Button | Opens the ready-for-pickup / Results delivery area (FDL-32). | Visible only when ≥1 completed order is still undelivered. | Navigates / drawer opens. |
| FDL-11 | "N payments" alert chip | Button | Opens the payments-due drawer (FDL-33); count = bills with a balance > 0. | Hidden when the count is 0. The drawer also **auto-opens** whenever a new pay-later is recorded anywhere in the app. | Drawer slides in. |
| FDL-12 | "N need follow-up" alert chip | Button (popover) | Opens the stragglers popover: missed appointments (>24 h, still booked), uncollected reports (completed >24 h), unpaid bills (>24 h). | Hidden once dismissed for the day. | Each row's "Open →" navigates to that patient's profile; × dismisses the whole popover for today. |
| FDL-13 | STAT pinned row | Chip list | One chip per non-completed order with priority STAT. | Row hidden when none. | Chip click opens that order's detail drawer (FDL-21). |
| FDL-14 | In progress / Completed tabs (work pane) | Tabs with counts | Switch the order list between actively-moving orders and finished ones. | **In progress** = orders in the selected date range excluding completed/validated/partially-validated/delivered/cancelled. **Completed** = validated/partially-validated/delivered/completed; when the range is "today" a report finished today for an older order still shows. Chosen tab persists across sessions. | Empty states: "All caught up" (with a New patient CTA) / "Nothing to deliver yet". |
| FDL-15 | Date-range pills (Yesterday / Today / Tomorrow / 7d / Month / Custom) | Pill filter (dropdown on narrow screens) | Filters both order lists by creation date. | Default Today; Custom opens a date-range picker; × clears custom back to Today. | Lists re-filter immediately. |
| FDL-16 | Order card (token, patient, MRN, sample count, per-department pills, status chip) | Clickable card | Opens the order detail drawer. | Department pills tint as tubes progress; a "✓ Partial ready · N/M" tag shows when some departments are fully validated. Status chip shows an *effective* status — if tubes have physically moved further than the stored order status, the chip shows the further state. Chip tones: green = billed/validated/delivered/completed; red = cancelled/rejected; violet = in lab/processing/resulted; teal = collected/dispatched/in-transit; amber = created/draft. | Drawer opens (FDL-21). |
| FDL-17 | Select checkbox (card corner) | Toggle | Adds/removes the order from the bulk selection. | — | Bulk bars appear (FDL-19/FDL-20). |
| FDL-18 | Card quick actions: **Bill** / **Collect** / **Dispatch** / **Reprint Labels** | Buttons on card (mutually exclusive by state) | One-tap next step. | **Bill**: only when billing mode = front-desk, user has `create_bill`, order status = created. **Collect**: only when this branch collects at the front desk, user has `collect_sample`, order is created or billed, has ≥1 sample, and no tube has moved past pending (also shows while partially collected). **Dispatch**: user has `dispatch_sample` and every tube is collected but none has left. **Reprint Labels**: order status = billed; disabled while a reprint is loading. | Bill → billing screen for the order. Collect → sample-collection flow for the order. Dispatch → all collected tubes flip to dispatched, toast "N tubes dispatched to lab", card updates immediately then re-syncs; failure → error toast. Reprint → fetches the full order and prints only the tube-label sheet (no bill, no navigation); "No samples on this order to print" warning if none; load failure → error toast. |
| FDL-19 | Bulk dispatch bar ("N selected" + **Mark dispatched** + **Bundle as package · QR** + ×) | Action bar | Appears above the In-progress list when ≥1 *selected* order has at least one collected tube. | Only such orders count toward N. | **Mark dispatched** → toast "Dispatched X samples across Y orders", selection cleared, list refreshes. **Bundle as package** → creates a dispatch package, toast "Package <code> created with N orders", opens the package modal (FDL-31). Failures → error toasts. |
| FDL-20 | Bulk comms bar (SMS / WhatsApp / Clear) | Action bar (bottom) | Appears when anything is selected (orders or appointments). | — | Queues bulk messages (toast confirms count) and clears selection. |
| FDL-21 | **Order detail drawer** | Side dialog | Full order view: patient header + status chip, meta (Created, Priority, Samples, Doctor), a **Preliminary report** panel (per-department validated results with observed value, reference range, and Normal/Abnormal/Critical flags — only for departments already fully validated), and a 5-step **Timeline** (Billing → Sample → Dispatch → Result → Report) with live captions like "2/3 collected", "4/5 tests resulted", "Ready for delivery" / "Partial ready · awaiting full sign-off" / "Report delivered". | Opens from any order card / STAT chip / ready-list card. Backdrop click or × closes. | — |
| FDL-22 | Drawer footer — Profile | Icon button | Opens the patient's profile page. | Error toast "No patient linked to this order" if orphaned. | Navigation. |
| FDL-23 | Drawer footer — Repeat | Icon button | Opens Build an Order pre-filled with this order's tests (new order, patient attached). | — | Navigation with repeat pre-fill (see ORD entry variants). |
| FDL-24 | Drawer footer — Invoice | Icon button | Renders and shows the order's invoice as an in-app PDF preview. | Hidden for draft or cancelled orders; disabled while generating. Works for unpaid orders too (bill created/fetched on demand with zero discount). | Preview modal opens with the invoice number in the header; warning toast if the tracking QR can't be generated (invoice still shows); error toast "Could not load the invoice" on failure. |
| FDL-25 | Invoice preview modal — Download / Print / × | Buttons | **Download** saves the already-rendered PDF (no re-render) named `<invoice number>.pdf` (fallback `invoice.pdf` when the bill has no invoice number). **Print** opens the browser print dialog for the same PDF via a hidden frame. **×** (or backdrop click) closes the preview and releases the rendered file. | Both buttons act on the PDF rendered when the preview opened; they do nothing if the preview failed to render (the error toast from FDL-24 already covered that). Print failures are silently swallowed — the preview stays on screen. | Download → file saved by the browser; no toast. Print → print dialog (outcome up to the user); no delivery status change. **Known gap (native app):** unlike RQ-15, this modal has no native share-sheet fallback — Download/Print may do nothing visible inside the iOS/Android web view; log as noted, not as a new defect. |
| FDL-26 | Drawer footer — Modify | Icon button | Opens Build an Order in EDIT mode for this order. | Requires `modify_order`; hidden on cancelled orders (allowed at any other live stage — the server refuses removing an already-validated test). | Navigation; on save the bill recomputes and the difference is collected/refunded (see ORD-25 edit mode). |
| FDL-27 | Drawer footer — Report | Icon button | Downloads the finished report PDF (tenant template, resolved layouts). | Only when order status is validated / partially validated / delivered / completed; disabled while preparing (label "Wait…"). | PDF downloads. "No report yet for this order — try again in a moment." warning if not generated yet; error toast on failure. |
| FDL-28 | Drawer footer — Labels | Icon button | Reprints tube labels. | Only when status = billed; disabled while loading. | Same as the card Reprint (FDL-18). |
| FDL-29 | Drawer footer — **Cancel** (red) | Icon button | Opens the cancel-order dialog. | Requires `cancel_order`; hidden on already-cancelled orders. | Dialog opens (FDL-30). |
| FDL-30 | **Cancel order dialog** — Refund mode chips (Cash/UPI/Card), Reason text, **Keep order**, **Cancel & refund** | Modal dialog | Voids the order and refunds anything already paid in the chosen mode. | Refund mode defaults to Cash; reason is optional free text (placeholder "e.g. patient left, duplicate order"). Confirm disabled while processing ("Cancelling…"); Confirm ignored while in flight. | Success: dialog + drawer close, toast "Order cancelled — any payment refunded", lists refresh, order disappears from In-progress (status cancelled); the refund appears in the Billing counter's day-end summary as a refund row. Failure: error toast with server reason; dialog stays open. "Keep order" / backdrop abandons with no change. |
| FDL-31 | Dispatch package modal (code, QR, Copy code, manifest, Done) | Modal | Shows the generated package code + QR the lab scans to receive every bundled order at once, plus a manifest (patient, short order id, sample count per order). | Opens after FDL-19 bundle succeeds. | Copy code → clipboard + toast "Code <X> copied" (warning toast if clipboard blocked); Done/backdrop closes. |
| FDL-32 | Ready-for-pickup drawer (via FDL-10) | Drawer | Lists completed-but-undelivered orders with waiting time; "Nudge" opens WhatsApp to the patient. | — | Card click opens the order drawer. |
| FDL-33 | Payments-due drawer (via FDL-11) | Side drawer (dialog) | Lists every unpaid/partially-paid bill: due amount ("₹X / due"), patient avatar + name, "Bill #<short id> · <date>", red "unpaid" chip. | Empty state "No unpaid bills."; header shows the count; × or backdrop closes. | — |
| FDL-34 | Collect (payments-due drawer row) | Ghost button | Jumps into Collect Payment for that bill's order. | — | Navigates to `/frontdesk/billing?orderId=…`. |
| FDL-35 | Create Bill (order card) | Button | Starts billing for a freshly created order. | Rendered only when the branch bills at the front desk AND the user holds `create_bill` AND the order status is "created". In separate-counter mode an "Awaiting Billing" badge shows instead. | Navigates to Collect Payment. |
| FDL-36 | Completed-tab card — **Download** | Button | Downloads the report PDF (same as FDL-27). | Shown only for not-yet-delivered completed orders (delivered ones show a "Delivered" chip instead); disabled while preparing ("Preparing…"). | Same results as FDL-27. |
| FDL-37 | Appointment card — **Check-in** | Button | Checks the appointment in; if tests were pre-booked an order is spawned automatically (patient appears under In progress, toast "<name> checked in — order in progress"); if not, navigates to Build an Order with patientId+appointmentId so reception picks tests. | Only on status = booked. | See left; failure → error toast. |

**Flows**
1. Type ≥2 characters in FDL-1 → spinner → result list → click / Enter → patient profile opens.
2. Press Cmd+K (or the funnel icon) → Advanced search modal opens with the Mobile field focused.
3. Scan a patient's printed ID card QR with FDL-5 → lands directly on that patient's profile.
4. After an advanced search runs, the filter set is written into the landing URL (`?aps=1&aps_phone=…` etc.); pressing browser Back from a patient profile re-opens the modal with the same filters and re-runs the search automatically. Explicitly closing the modal (× / Esc / backdrop) strips those URL params.
5. Order life at a glance: a new order appears under **In progress** with an amber "Created" chip → after billing the chip goes green "Billed" and the card offers Collect/Reprint Labels → once every tube is collected the card offers **Dispatch** → dispatching flips the chip to "Dispatched", later "In Lab" → when the lab validates, the order moves to **Completed** with a Download button → delivering swaps it to a "Delivered" chip.
6. Cancel with refund: order card → drawer → Cancel → choose refund mode + optional reason → "Cancel & refund" → toast confirms, order leaves the board.
7. Bundle dispatch: tick 3 orders with collected tubes → bulk bar "3 selected" → "Bundle as package · QR" → modal shows code + QR → the lab scans it to receive all three; "Copy code" covers no-camera situations.
8. Partial results early view: while some departments are validated, the card shows "✓ Partial ready · 1/3"; opening the drawer shows those validated departments' actual values (flagged Normal/Abnormal/Critical) under "Preliminary report" before the full report exists.
9. Scan-to-open: header Scan QR reads the staff QR on an invoice → a user with collect permission lands directly in collection for that order; otherwise on the patient's profile (see OQR).
10. Repeat from history: drawer → Repeat → Build an Order opens with the same tests pre-selected → adjust and submit as a fresh order.
11. Unpaid follow-up: "N payments" chip → payments-due drawer → Collect jumps straight into billing for that order. A pay-later confirmed on the billing screen makes this drawer pop open by itself with the new row.
12. Copy of a bill: order card → View invoice (FDL-24) → PDF preview → Print or Download; no payment state changes.

**Known gaps QC should flag as "by design":** bulk SMS/WhatsApp (FDL-20) only shows a confirmation toast — no message is actually dispatched from the client. Cancel-order refund mode is recorded with the cancellation; the UI does not verify how much (if anything) was actually paid — the "any payment refunded" toast wording is unconditional.

### 3.2 Advanced Patient Search (dialog over `/frontdesk`; toggled by ⌘K / funnel icon)

**Purpose:** Multi-criteria patient lookup when simple search fails or is ambiguous — combines mobile, name, MRN, age, sex, branch, tests taken, and visit-date range.
**Who sees it:** Same as the landing page (no extra permission). Branch list and test list load lazily on first open.

| ID | Control (label) | Type | What it does | Rules / validation | Result (success / failure) |
|---|---|---|---|---|---|
| APS-1 | Mobile number (badge "priority") | Tel input, auto-focused on open | Filter by phone. | Sanitised live: only digits and `+` kept (any other character typed is stripped). Exact-digit matches get a "Best match" tag in results. | Included as phone filter. |
| APS-2 | Patient name | Text input | Filter by first or father's name (partial). | Free text. | Included as name filter; matched fragment highlighted in result rows. |
| APS-3 | MRN (placeholder e.g. `DEL-2605-004217-3`) | Text input | Filter by patient MRN. | Sanitised live: only letters, digits and hyphens kept. | Included as MRN filter. |
| APS-4 | Age | Number input | Filter by current age. | Sanitised live: digits only, clamped 0–130. | Included as age filter. |
| APS-5 | Sex pills (Any / Male / Female / Other) | Single-select pill group | Filter by sex. | Exactly one pill active; "Any" = no filter. | Included as sex filter. |
| APS-6 | Branch | Dropdown ("Any branch" + branch list) | Filter by branch of the last/any visit. | Branch list de-duplicated; loads on first open of the modal. | Included as branch filter. |
| APS-7 | Tests multiselect ("Pick one or more tests") | Popover multi-select with its own search box | Restrict to patients who have ≥1 order containing ≥1 of the picked tests. | Opens on click of the trigger; the inner search filters the active test catalogue by name or code (first 200 shown); clicking a row toggles its checkmark; clicking outside closes. Selected tests render as removable chips (× removes). "N selected" counter next to the label. | Each picked test is sent by name; backend OR-merges them. Empty popover search → "No tests match "…"". |
| APS-8 | Visit date pills (Any date / Today / Yesterday / Last 7 days / This month / Custom…) | Single-select pill group | Restrict by date of the patient's visits. | Choosing any non-custom preset clears manually entered custom dates. Choosing "Custom…" reveals APS-9/APS-10. | Translated to from/to bounds (single-day presets send the same day for both). |
| APS-9 | From date picker | Date input (visible only when "Custom…" selected) | Custom range lower bound. | Must be a real calendar date; a hand-typed invalid date is rejected with inline error `Invalid date "…" — pick from the calendar` and the filter is not updated. | Included as date-from. |
| APS-10 | To date picker | Date input (visible only when "Custom…" selected) | Custom range upper bound. | Same validation as APS-9. | Included as date-to. |
| APS-11 | Clear | Ghost button | Resets all filters, results, and error text; refocuses the Mobile field. | **Disabled** when no filter is set. | Modal returns to the idle "Enter at least one filter" state. |
| APS-12 | Search | Primary button (shows "Searching…" + spinner while running) | Runs the search (page size 20). Enter anywhere in the filter area also triggers it. | **Disabled** while loading or when no filter is set. Attempting to run with zero filters shows inline error "Enter at least one filter to search". | Success → results table replaces the empty state; filter set persisted into the URL (new history entry per search). Failure → inline red error with server message or "Search failed — try again". Zero hits → "No patients found / Try fewer filters or a partial spelling." |
| APS-13 | Results table row — patient name cell | Button (avatar + name; "Best match" tag when phone matched exactly) | Opens that patient's profile. | Name/phone match fragments render highlighted. Columns: Patient, MRN, Mobile, Age/Sex, Last visit ("No visits" if none), Branch, Actions. | Navigates to the patient profile (modal disappears because the page unmounts — the URL keeps the search state for Back). |
| APS-14 | View (row action) | Button | Same as APS-13. | On phones only the first row action is visible. | Profile opens. |
| APS-15 | Order (row action, accented) | Button | Starts a new order for that patient. | — | Navigates to `/frontdesk/order?patientId={id}`. |
| APS-16 | Book (row action) | Button | Books an appointment for that patient. | — | Navigates to `/frontdesk/appointments/new?patientId={id}`. |
| APS-17 | Load N more (results footer) | Ghost button | Fetches the next page and appends. | Only shown while shown < total; label states how many more will load (max 20); disabled with "Loading…" while fetching. Footer always shows "Showing X of Y". | List grows; silent failure leaves the list unchanged. |
| APS-18 | Close (×) / Esc / backdrop click | Button / key / click | Closes the modal. | Esc works globally while the modal is open. | Modal closes; search URL params removed. |

**Flows**
1. Enter a mobile number → Search → rows whose phone digits exactly equal the input show a green "Best match" tag.
2. Pick "Custom…" then type an impossible date → inline error appears; Search still uses the last valid state.
3. Search → click a patient → profile opens → browser Back → modal re-opens with the same filters and auto-runs the search (same result list).
4. Open the Tests picker, select two tests → chips appear in the trigger; × on a chip removes just that test.

### 3.3 Register Patient (`/frontdesk/patients/new`)

**Purpose:** Capture a new patient's demographics via the tenant-configurable "patient registration" workflow form, then land on the profile — or jump straight into an order/appointment.
**Who sees it:** Users with *register_patient*, and only when the patient-registration workflow step is enabled (route blocked otherwise).

**Important for QC:** the field list is **admin-configured** (Workflow Builder → patient registration). The renderer behavior below is fixed; the exact fields/steps vary per tenant. Standard fields map to the patient record (first name, father's name, phone, email, sex, date of birth/age, blood group, ABHA, guardian details, etc.); admin-added custom fields are stored in the patient's "attributes" bag. Steps and fields can be conditionally shown/skipped by admin rules (e.g. guardian step only when computed age < 18) — the renderer re-evaluates these live as values are typed.

| ID | Control (label) | Type | What it does | Rules / validation | Result (success / failure) |
|---|---|---|---|---|---|
| REG-1 | Back | Ghost button (header) | Returns to the Frontdesk landing. | Always enabled. | Navigates to `/frontdesk`. Unsaved input is lost without warning. |
| REG-2 | Step indicator (numbered circles + connecting line) | Progress display | Shows position in the multi-step form; completed/current steps filled. | Display only, not clickable. Hidden steps (admin "show when" rules false) don't appear at all. | — |
| REG-3 | Workflow fields (per admin config) | Text / phone / email / number / date / select / multiselect / radio / textarea etc. | Capture patient data. Field widths (half/full) follow admin config. Required fields show a red asterisk. | **Date-of-birth is a hybrid:** a date picker "or" an Age (yrs) number box (0–150) side by side — enter either. Age-only entries are converted to a synthetic DOB anchored to today (so displayed age keeps incrementing yearly); when a real DOB exists, any static age is discarded and age is always recomputed. Phone fields render with `+91…` placeholder. Select fields default placeholder "— Select —". | Values feed live into the condition engine (e.g. a DOB computing to <18 can reveal a guardian step). |
| REG-4 | ← Back (step footer) | Ghost button | Goes to the previous visible step. | **Disabled** on the first step. | Previous step's fields shown with previously entered values intact; any validation error is cleared. |
| REG-5 | Next → (step footer, non-final steps) | Primary button | Validates the current step then advances (respecting admin skip/branching rules). | All **required visible** fields on the step must be non-empty; otherwise an inline red message "Please fill: <field titles>" appears and the step does not advance. A step with no fields shows "This step has no fields. Hit Next to continue." | Advance to next applicable step; if routing rules jump past the end, the form submits as in REG-6. |
| REG-6 | Register patient (final step) | Primary button (label "Submitting…" while saving) | Validates the last step and saves the patient. | Same required-field validation; disabled while saving; double-submit guarded. | **Success:** green toast `Registered <name>`, form clears, navigate to the new patient's profile. **Failure:** red toast with server error (or "Registration failed"); user stays on the form with values intact. |
| REG-7 | Create Order (final step, ghost) | Button | Saves the patient (same validation/save as REG-6) then jumps into order creation. | Disabled while saving. | Success → toast `Registered <name>` → `/frontdesk/order?patientId={new id}` with the patient pre-attached. Failure → same as REG-6. |
| REG-8 | Create Appointment (final step, ghost) | Button | Saves the patient then jumps into appointment booking. | Disabled while saving. | Success → `/frontdesk/appointments/new?patientId={new id}`. Failure → same as REG-6. |

**Loading / error states:** while the workflow definition loads, a centered "Loading workflow…" logo shows instead of the form. If the definition can't be fetched or parsed, an error toast appears ("Could not load patient_registration workflow" / "Could not parse workflow") and the loading state persists.

**Flows**
1. Fill required fields → Next through each step → Register patient → toast → land on the new profile.
2. Enter only "Age 30" (no DOB) → save → profile shows "30y" today and will show "31y" in a year (age derived from a synthetic DOB anchored to registration date).
3. Enter a DOB for a 10-year-old → if the tenant's workflow has a guardian step conditioned on age < 18, that step appears; the profile later shows a MINOR badge.
4. Leave a required field empty and press Next → inline "Please fill: …" message; correcting the field clears it immediately.
5. On the last step press Create Order → patient is saved and the Build-an-order screen opens with them attached.

### 3.4 Patient Profile (`/frontdesk/patients/:id`)

**Purpose:** Single patient's record — demographics, ID card, activity KPIs, visit history, lab orders, documents — plus edit, merge, share and next-action shortcuts.
**Who sees it:** Users with *view_patient* or *register_patient*. Editing and merging require *edit_patient* or *register_patient*. "Send to Chat" requires the Messages module.

**⚠ Demo-data warning for QC:** The **OPD Records, IPD Admissions and Pharmacy tabs, the vitals history and allergies inside the Visits Timeline**, and — on the Lab Orders tab — the fallback "Observed" value and the fixed reference range "3.5 – 5.5 g/dL" are **deterministically generated mock content** (seeded from the patient id; same patient always shows the same fake records). They are not backend data and must not be tested as such. Real data: demographics, lab order history, KPIs, documents.

| ID | Control (label) | Type | What it does | Rules / validation | Result (success / failure) |
|---|---|---|---|---|---|
| PPF-1 | Back chevron (beside avatar) | Icon button | Goes back in history; falls back to `/frontdesk` when there's no history. | Only rendered when the app's nav-back service says a back target exists. | Navigation. |
| PPF-2 | MRN badge | Display chip | Shows the patient MRN, tooltip "MRN: …". Shows "—" (tooltip "No MRN on file") for legacy patients. | — | — |
| PPF-3 | MINOR badge | Display chip | Shown when the record is flagged as a minor. | — | — |
| PPF-4 | Edit | Button | Opens the **Edit patient info** modal pre-filled with current values. | Visible only with *edit_patient* or *register_patient*. | Modal opens (PPF-30…39). |
| PPF-5 | Phone value | tel: link | Starts a phone call via the OS. | Rendered only if a phone exists. | Dialer opens. |
| PPF-6 | Email value | mailto: link | Opens the mail client. | Rendered only if an email exists. | Mail compose opens. |
| PPF-7 | Guardian details block | Display | Shows guardian name, relationship (defaults to "Guardian") and phone. | Only when a guardian name exists. | — |
| PPF-8 | New Lab Order | Primary gradient button | Starts an order for this patient. | Always shown. | Navigates to `/frontdesk/order?patientId={id}` (any saved draft for this patient restores automatically there). |
| PPF-9 | Book Appointment | Button | Books an appointment for this patient. | Always shown. | Navigates to `/frontdesk/appointments/new?patientId={id}`. |
| PPF-10 | Send to Chat | Button | Opens the colleague picker to share this patient as a tap-to-open card in Messages. | Only when the Messages module is enabled. | Picker sheet opens (PPF-26…29). |
| PPF-11 | Merge Duplicate Into This Patient | Button | Opens the merge picker. | Visible only with *edit_patient* / *register_patient*. | Merge sheet opens (PPF-40…44). |
| PPF-12 | Print ID card | Button (under the ID-card preview) | Prints ONLY the ID card block (name, age/sex, phone, DOB, blood group, MRN, and a QR encoding the app's `/p/{id}` open-route). | Print stylesheet forces a light card on paper even in dark mode. | Browser print dialog with just the card. |
| PPF-13 | Tab bar: Overview / Visits Timeline / Lab Orders / OPD Records / IPD Admissions / Pharmacy / Documents | Tab buttons (with count badges) | Switches the right-hand content pane. Counts: timeline events, lab orders, OPD, IPD, prescriptions. | Horizontally scrollable on small screens. Default tab = Overview. | Pane swaps; no data reload. |
| PPF-14 | Overview KPI cards (Lab visits / Tests ordered / Total billed / Last visit) | Display | Real numbers derived from the patient's lab order history. | "—" for Last visit when no orders. | — |
| PPF-15 | Vitals & BMI card / Active Allergies box (Overview) | Display | Explicit "Not recorded — captured at OPD/IPD intake" empty states. | Always the empty state in the lab product. | — |
| PPF-16 | Fall Risk Level / Pediatric Care Protocol / Isolation Status rows | Display | Derived flags: Fall risk "Moderate" if stored age > 60 else "Low Risk"; Pediatric row only for minors ("Guardian Required"); Isolation always "Standard". | Heuristic display only. | — |
| PPF-17 | ABHA Health Card + status pill | Display card | Shows ACTIVE (green) when an ABHA id is linked, else UNLINKED (amber) and "IDENTITY LINK PENDING". | ABHA address shown is synthesized from the name when linked. | — |
| PPF-18 | Verify & Link ABHA Card | Button | **Placeholder** — shows only the info toast "ABHA integration workflow initiated. Connecting registry..." No real integration. | Only shown when no ABHA id is linked. | Toast only; nothing changes. |
| PPF-19 | Recent Lab Orders mini-list + "View All (N) →" (Overview) | Cards / link | Shows the two most recent orders (id prefix, status chip, test count, date, amount); clicking a card or View All switches to the Lab Orders tab. | Empty state "No lab orders on record." | Tab switch only. |
| PPF-20 | Active Medications mini-list + "View All (N) →" (Overview) | Cards / link | Mock prescriptions preview; click switches to the Pharmacy tab. | **Mock data.** | Tab switch. |
| PPF-21 | Timeline event card (Visits Timeline tab) | Expandable card | One card per event (LAB = real orders; OPD/IPD = mock), colour-coded, newest first. Clicking anywhere toggles "View details / Hide details". | Empty state "No visits or orders recorded on timeline." | Expanded LAB view lists each test with status chip and the order total; OPD/IPD expansions show mock symptoms/notes/progress. |
| PPF-22 | Lab Orders tab — order card | Display card | Per order: date/time, referring doctor ("Self Referral" when none, shown as "Ref: <doctor>"), status chip, priority, amount, and each test with code badge, name, tube/department, status chip. | Empty state "No diagnostic orders yet for this patient." Order chip tones: completed = green, billed = amber, cancelled = red, in-progress = violet. Per-test chip tones: validated/completed/reported = green, rejected = red, in-progress/resulted = violet, pending = amber. Completed/validated tests show an "Observed" box — **the value falls back to a generated number and the reference range is hard-coded "3.5 – 5.5 g/dL"** when no real result is attached (do not treat as clinical output). | — |
| PPF-23 | Repeat (per order card; tooltip "Repeat this order — re-bills the same tests") | Button | Re-orders the same tests. | Needs a resolvable patient id (falls back to the profile's patient). | Navigates to `/frontdesk/order?patientId={id}&fromOrderId={orderId}`; the cart pre-fills with that order's still-active tests; deactivated tests are dropped with a warning toast on the order screen. |
| PPF-24 | OPD / IPD / Pharmacy tabs | Display | Read-only mock clinical records (see warning above). | Empty states: "No OPD records on record." / "No IPD records on file. No past admissions." / "No prescriptions on record." | — |
| PPF-25 | Documents tab | Embedded panel | Upload/list/delete patient documents — see the DOC table below. | — | — |
| PPF-26 | Send-to-chat sheet — Search by name or email | Text input (autofocus) | Filters the staff directory list live. | Directory loads on first open; the current user and deactivated users are excluded. | Empty result → "No colleagues match." Directory load failure → toast "Could not load directory." |
| PPF-27 | Send-to-chat sheet — Colleague row | Button (initials avatar, name, email) | Sends the patient card to that person's chat. | All rows disabled while a send is in flight. | Success → toast `Sent <patient> to <colleague>`, sheet closes, app navigates to `/messages`. Failure → error toast; sheet stays open. |
| PPF-28 | Send-to-chat sheet — Close (×) | Button | Closes the sheet. | Backdrop click also closes. | — |
| PPF-29 | Send-to-chat sheet — header | Display | "Send patient to a colleague — <name> will appear in their chat as a tap-to-open card." | — | — |
| PPF-30 | Edit modal — First name | Text input | Edits first name. | **Required** — Save is disabled while blank; attempting save with only whitespace shows warning toast "First name is required". | Feeds PPF-39 (Save changes). |
| PPF-31 | Edit modal — Father's name | Text input | Edits father's name. | Optional; empty string clears the value. | Feeds PPF-39 (Save changes). |
| PPF-32 | Edit modal — Phone | Tel input | Edits phone. | Free text (no format enforcement); empty clears. | Feeds PPF-39 (Save changes). |
| PPF-33 | Edit modal — Email | Email input | Edits email. | Browser email keyboard; empty clears. | Feeds PPF-39 (Save changes). |
| PPF-34 | Edit modal — Sex | Select (— / Male / Female / Other) | Edits sex. | "—" leaves it unchanged/blank. | Feeds PPF-39 (Save changes). |
| PPF-35 | Edit modal — Date of birth | Date picker | Edits DOB. | Hybrid rule with PPF-36: if a DOB is set, the Age field is ignored and age is always recomputed live from DOB. | Feeds PPF-39 (Save changes). |
| PPF-36 | Edit modal — Age (placeholder "auto from DOB") | Number input 0–150 | Sets age when no DOB is known. | If DOB is empty and age is 0–149, a synthetic DOB anchored to today is stored so displayed age keeps incrementing. | Feeds PPF-39 (Save changes). |
| PPF-37 | Edit modal — Blood group | Select ("Not recorded", O+, O−, A+, A−, B+, B−, AB+, AB−) | Edits blood group. | "Not recorded" clears it. | Feeds PPF-39 (Save changes). |
| PPF-38 | Edit modal — Cancel / × / backdrop | Buttons | Closes without saving. | — | Draft discarded. |
| PPF-39 | Edit modal — Save changes | Primary button ("Saving…" while busy) | Persists the edit. | **Disabled** while saving or while First name is blank. | Success → header/demographics refresh with the returned record, green toast "Patient updated", modal closes. Failure → error toast with server message ("Could not update patient" fallback); modal stays open. |
| PPF-40 | Merge sheet — Search patients by name, MRN or phone | Text input (autofocus) | Searches on every keystroke for the DUPLICATE record. | The currently open patient is filtered out (cannot merge into itself). Empty query → prompt "Search for the duplicate record to merge."; no matches → "No other patients match." | — |
| PPF-41 | Merge sheet — Duplicate row (name, MRN · phone · sex · age) | Button | Selects that record as the merge **source**. | Rows disabled while a merge runs. | Opens the confirm dialog PPF-42. |
| PPF-42 | Merge confirm dialog "Merge <dup> into <this>?" | Danger confirm ("Merge records") | Warns: all orders, bills and appointments of the duplicate move into this record and the duplicate is deactivated; **cannot be undone**. | Cancel aborts with no change. | Confirm → PPF-43. |
| PPF-43 | (merge execution) | — | Calls the merge API with this profile as target. | — | Success → toast summarising counts, e.g. "Merged 3 orders, 2 bills, 1 appointment into this record", sheet closes, profile reloads showing the moved history. Failure → error toast ("Could not merge patients" fallback); sheet stays open. |
| PPF-44 | Merge sheet — Close (×) / backdrop | Button | Closes the sheet. | **Ignored while a merge is running.** | — |

**Other states:** while loading, skeleton placeholders render; if the patient id doesn't resolve, a full-width "Patient record not found." panel shows.

#### Documents tab (inside Patient Profile)

| ID | Control (label) | Type | What it does | Rules / validation | Result (success / failure) |
|---|---|---|---|---|---|
| DOC-1 | Type | Select (Photo / Prescription / Report·scan / ID proof / Consent form / Other) | Sets the category the next upload is tagged with. | Defaults to "Report / scan". | Feeds DOC-3 (Upload file). |
| DOC-2 | Note (optional) | Text input (e.g. "fasting sample") | Free-text note stored with the next upload. | Trimmed; cleared automatically after a successful upload. | Feeds DOC-3 (Upload file). |
| DOC-3 | Upload file | File-picker button (label becomes "Uploading…") | Opens the OS file picker and immediately uploads the chosen file with the selected type + note. | Accepts images and PDF only. Disabled/dimmed while an upload is in flight. | Success → new tile appears at the top of the grid + toast "Document uploaded". Failure → error toast with the server message, or "Upload failed — is storage configured?". Picker resets either way. |
| DOC-4 | Document tile (thumbnail / file icon) | Link | Opens the document in a new browser tab via a short-lived pre-signed URL. | Images show a thumbnail; PDFs a file glyph. Tile shows filename (tooltip = full name), type label and size (KB/MB). | New tab opens. |
| DOC-5 | Delete (trash, top-right of tile) | Icon button | Deletes the document after a native browser confirm `Delete "<filename>"?`. | On desktop the button appears on hover; on touch devices it is always visible. | Confirm → tile removed. Failure → toast "Delete failed". Cancel → nothing. |
| DOC-6 | Empty state | Display | "No documents yet. Upload a photo, prescription or scan." | Shown when list is empty; "Loading documents…" while fetching. | — |

**Flows (profile)**
1. Edit → change only Age (DOB empty) → Save → demographics show the new age and it auto-increments annually.
2. Merge: search a duplicate → pick → read the danger dialog → confirm → toast with moved counts → the Lab Orders tab now includes the duplicate's orders; searching for the duplicate later finds it deactivated.
3. Lab Orders tab → Repeat on an old order → Build-an-order opens with that patient attached and the same tests in the cart (dropped tests are reported by toast).
4. Send to Chat → pick a colleague → toast → user is taken to Messages where the shared patient card is visible.
5. Print ID card → paper shows only the card; scanning its QR with a phone camera or FDL-5 opens this profile.
6. Returning patient: profile → Lab Orders tab → last visit's order → **Repeat** → Build an Order opens with the same cart → adjust → submit.

### 3.5 Patient QR Open (`/p/:id`)

**Purpose:** Landing route encoded in the printed patient ID-card QR; resolves the scan to the patient's profile.
**Who sees it:** Any signed-in user (shell auth). No visible controls.

| ID | Control (label) | Type | What it does | Rules / validation | Result (success / failure) |
|---|---|---|---|---|---|
| QRP-1 | (auto-redirect) | — | Shows "Opening patient…" spinner and immediately forwards. | URL with an id → the patient profile (replacing this entry in history); missing id → app root. Profile-route permission checks then apply (no *view_patient*/*register_patient* → 403). | Profile opens; unknown id shows the profile's "Patient record not found." state. |

---

## 4. Orders

Cross-cutting rules: all money in ₹ (INR). Permissions referenced: `create_order`, `create_bill`, `collect_payment`, `collect_sample`, `dispatch_sample`, `modify_order`, `cancel_order`, `give_discount`, `override_discount`. The order list, detail drawer, and lifecycle actions live on the Frontdesk landing & board (section 3.1, FDL-10…FDL-37). The per-patient order history lives on the Patient Profile (PPF-22/PPF-23).

### 4.1 Build an Order (`/frontdesk/order`)

**Purpose:** Compose a lab order for a patient — attach patient, referring hospital/doctor, pick tests/packages, set priority, preview price (subtotal, GST, discount, TAT), then either take payment inline (front-desk billing mode) or generate an invoice for the billing counter. Also serves as the EDIT screen for an existing order (via "Modify" elsewhere). This is where a bill is **born**: the cart defines the line items; there is no manual "add line item" UI anywhere — line items always mirror the order's tests.
**Who sees it:** Users with `create_order` AND at least one of the walk-in-order / appointment workflows enabled. Others are blocked at the route. Discount entry additionally depends on `give_discount` (Level-1 cap) / `override_discount` (Level-2 cap). The inline payment pane appears only when the branch's billing mode is "front desk" and a NEW order is being created (never in edit mode). The "Collect sample" follow-up appears only when collection happens at the front desk, the collection workflow step is enabled, and the user holds `collect_sample`.

**Entry variants (deep links):**
- Plain visit — empty screen, patient search focused automatically.
- `?patientId=` — patient pre-attached (from profile / advanced search).
- `?patientId=&fromOrderId=` — "Repeat order": cart pre-filled with the prior order's tests, intersected with the currently-active catalogue. Toast "Repeated from <date>: N tests added", or a warning "N carried over, M no longer available" if some tests were deactivated since.
- `?patientId=&appointmentId=` — appointment check-in; if the appointment had draft tests they pre-load into the cart with info toast "Pre-filled N tests from the appointment". The created order is tagged source = appointment.
- `?editOrderId=` — EDIT mode: order + patient load, current tests pre-selected, submit button reads "Update order & reconcile", inline payment pane suppressed. Info toast: "Editing order — N tests loaded. Add or remove, then Update."
- A saved local draft for the attached patient (ORD-27) always wins over fromOrderId/appointmentId pre-fill; toast "Draft restored".

| ID | Control (label) | Type | What it does | Rules / validation | Result (success / failure) |
|---|---|---|---|---|---|
| ORD-1 | Patient search ("Search patient by name, phone, MRN, ABHA…") | Type-ahead search field | Searches patients; picking one attaches them to the order. | Min 2 characters; 220 ms debounce; max 10 results; states: hint ("keep typing") <2 chars, spinner while loading, empty state when no match. Auto-focused on a fresh visit. | Pick → patient attached, URL gains `?patientId=`, patient details fetched, any saved draft for that patient auto-restores ("Draft restored" toast). Fetch failure → error toast "Could not load patient details". |
| ORD-2 | Attached patient tile (name, age/sex, avatar) | Read-only tile | Shows who the order is for. | Replaces the search field once a patient is attached. | — |
| ORD-3 | Change patient (pencil icon on tile) | Icon button | Swaps the tile back to an inline patient search. | Only visible when a patient is attached. | Picking a new patient re-attaches (same as ORD-1 pick). |
| ORD-4 | Cancel change (× inside inline search) | Icon button | Aborts the patient swap, restores the tile. | Only during "changing patient" state. | Original patient kept. |
| ORD-5 | Referring hospital ("Referring hospital (optional)") | Free-text with suggestion popover | Records the referring hospital on the order. | Optional. Focus shows recent hospital suggestions; typing filters them (200 ms debounce). Suggestions come from previously used names. | Picking/typing sets the value. **Changing the hospital clears the referring doctor field** (doctor may belong to another hospital). Stored on the order (null when blank). |
| ORD-6 | Clear hospital (× in field) | Icon button | Empties the hospital field. | Visible only when field has text. | Field cleared; doctor also cleared (value changed). |
| ORD-7 | Referring doctor ("Referring doctor (optional)") | Free-text with suggestion popover | Records the referring doctor. | Optional. Focus shows suggestions even on empty input; typing filters (200 ms debounce). When a hospital is set, suggestions are filtered to that hospital. Popover hides shortly after blur so a click on a suggestion still lands. | Picked/typed name sent with the order (trimmed; blank = none, shown as "Self Referral" in history). |
| ORD-8 | Clear doctor (×) | Icon button | Empties the doctor field. | Visible only when field has text. | Field cleared. |
| ORD-9 | Test search ("Search tests or packages — name, code, department…") | Text field | Filters the test catalogue. | Matches test name, HSN/SAC code, and department name; tolerant of US/UK medical spellings (hema↔haema, pedia↔paedia, anesth↔anaesth, fetal↔foetal, leuk↔leuc). Typing auto-switches the tabs to "All tests"; clearing returns to the previous tab. Tab key with text present jumps focus to the first result card. | Live filtering; empty result shows 'No tests match "<query>"'. |
| ORD-10 | Clear search (×) | Icon button | Empties the test search. | Visible when query non-empty. | List unfiltered; tab restored. |
| ORD-11 | Priority toggle (Normal / Urgent) | Two-option radio group | Sets order priority. | Defaults to Normal. | Urgent shows an "Urgent priority" badge in the cart; value saved on the order. |
| ORD-12 | Category tabs (Recent / Favourites / Packages / All tests) | Tab strip with counts | Switches which slice of the catalogue is shown. | Counts per tab. Recent = tests this user ordered before (most-recent first). Favourites = tests the user starred. Both per-user, filtered to active tests, load best-effort (failures silent — lists just show empty). On phones tabs render as icons. | Empty states: Recent — "No recent tests yet — they appear here once you create your first order."; Favourites — "No favourites yet — click the ☆ on any test to pin it here."; Packages — "No packages configured."; All — "No tests configured." |
| ORD-13 | Test card (code, name, price, TAT) | Toggle card | Adds/removes the test from the cart. | Selected card shows a green ✓; clicking again removes. If a search query was active, selecting a test clears the query and refocuses the search box (rapid multi-add). | Cart count/price update instantly; no toast. |
| ORD-14 | Star (☆/★) on test card | Icon toggle | Pins/unpins the test to the user's Favourites. | Optimistic — flips immediately, saved to server. | On server failure the star reverts and error toast "Could not update favourites". |
| ORD-15 | Package card (PACKAGE badge, member count, price) | Toggle card | Adds/removes a package (bundle of tests, single price) from the cart. | Same toggle + search-clear behavior as ORD-13. | Cart updates; the TAT estimate uses the slowest member test inside the package. |
| ORD-16 | A–Z index strip (phone ≤640 px only, All-tests tab) | Touch scrubber | Jump/scroll the department-grouped list to a letter; a magnified letter callout follows the finger. | Only shows when ≥2 distinct department first-letters exist; non-alphabetic departments bucket under "#". Tap jumps; press-and-slide scrubs live. | Purely navigational — no data change. |
| ORD-17 | Cart floating button (phone/tablet <1024 px) | FAB with badge | Opens/closes the cart drawer. | Badge shows selected count; hidden on desktop where the cart is a fixed right column. | Drawer slides in with backdrop; backdrop click or × closes. |
| ORD-18 | Clear (cart header) | Text button | Empties the whole cart. | Hidden when cart empty; hidden after payment is recorded. | All selections removed. Empty cart shows "No tests selected yet". |
| ORD-19 | Remove item (× per cart row) | Icon button | Removes one test from the cart. | Hidden after payment is recorded. | Row disappears; totals recompute. |
| ORD-20 | "Save with a package" — Apply | Button per suggestion | Swaps the individual tests for a covering package. | Suggestion appears only when EVERY individual test in the cart is contained in the package and the package itself isn't already in the cart; suggestions sorted cheapest first, showing member count, struck-through individual sum, package price, and "Save ₹X" when positive. | Success toast "Switched to <package> — saving ₹X"; the covered tests leave the cart, the package enters. |
| ORD-21 | Discount unit toggle (₹ / %) | Two-tab toggle | Chooses flat-rupee vs percentage discount entry. | The whole discount block is hidden if the admin "Allow discounts" switch is off, OR if the user's discount cap is 0 (neither `give_discount` nor `override_discount`). Cap shown inline: "(max N%)" — Level-1 cap for `give_discount`, higher Level-2 cap for `override_discount`. | — |
| ORD-22 | Discount amount | Numeric input | Enters the discount, applied to the pre-discount total. | Whole numbers ≥0; % capped at 100 in the input; the resolved ₹ amount is clamped to the bill total but **not** silently clamped to the user's cap. | Within cap → "You save −₹X" line appears and Total drops. Over cap → input turns red, inline error "Exceeds your N% limit — reduce the discount to continue.", and payment confirmation is blocked (PAY-8). The resolved ₹ value is carried into the bill on confirm, and into the billing screen's `?discount=` on hand-off. |
| ORD-23 | Totals block (Subtotal / GST · 18% / Total) | Read-only | Live pricing preview. | GST row hidden entirely when the tenant GST switch is off (bill becomes a Bill of Supply; tax = 0). GST = 18% of subtotal, rounded — mirrors the server. | Total = subtotal + GST − discount, floored at 0. |
| ORD-24 | TAT line ("Report ready in ≈ Nh / N days") | Read-only | Estimated report ETA. | Driven by the slowest selected test (packages = slowest member). Hidden when no test has a TAT. | — |
| ORD-25 | **Proceed to billing / Update order & reconcile** (separate-counter mode, or edit mode) | Primary button | Creates the order (or PATCHes it in edit mode). | **Disabled** while saving, when the cart is empty, or when no patient is attached. Label is "Update order & reconcile" in edit mode, else "Proceed to billing". | **Create (separate counter):** order created (status "created"), any local draft cleared, cart+patient reset, invoice auto-generated (allocates invoice number + tracking QR) → toast "Invoice <no> generated — send the patient to the billing counter", navigate to the front-desk landing. If invoice generation fails the order still exists → toast "Order created — billing request raised" (the counter can still bill by patient/order). **Edit:** tests updated with reason "reception edit" (backend blocks removing an already-validated test) → toast "Order updated — reconcile payment", navigate to the billing screen for that order (carrying any cart discount) so the difference is collected/refunded. Failures → error toast with server message ("Update failed" / "Order failed"). |
| ORD-26 | **Inline payment pane** (front-desk billing mode only, new orders only) | Embedded panel | Takes payment as part of order creation — see the PAY table below. | Only rendered when billing mode = front-desk AND not in edit mode. If no patient or empty cart, shows placeholder "Select a patient and tests to collect payment." instead. | See PAY-9. |
| ORD-27 | Save as draft | Button | Saves the cart (tests + priority) locally on this browser, keyed per patient. | **Disabled** when no patient or empty cart. Triggered anyway (via keyboard): warning "Pick a patient first" / info "Cart is empty — nothing to save". Drafts expire after 7 days. | Success toast "Saved as draft", then navigates back to the front-desk landing. Draft auto-restores next time this patient is attached on this browser. Storage failure → error toast "Could not save draft (storage full?)". |
| ORD-28 | Discard draft | Ghost button | Deletes the saved draft for the current patient. | Visible only when a draft exists/was just saved. | Info toast "Draft discarded". |
| ORD-29 | Urgent badge ("Urgent priority") | Read-only chip | Reminds the cashier of priority in the cart. | Shown only when priority ≠ Normal. | — |
| ORD-30 | Invoice preview modal | Dialog (in-app PDF frame) | Shows the invoice after payment when the OS share path isn't available. | Backdrop click or × closes; on phones the A4 page scales to fit width. | — |

#### Inline payment pane (front-desk billing mode) — sub-controls of Build an Order

| ID | Control (label) | Type | What it does | Rules / validation | Result (success / failure) |
|---|---|---|---|---|---|
| PAY-1 | Payment mode tiles (UPI / Card / Cash / Wallet / Split / Pay later) | 6-tile selector | Chooses how payment is taken. | Default = Cash. Selecting Wallet lazily loads the vendor list. | Body below swaps per mode. |
| PAY-2 | UPI mode | QR display | Shows the amount + a scannable UPI QR ("Scan to pay"). | QR encodes the exact cart total. | Confirm enabled whenever total > 0. |
| PAY-3 | Card mode — "Reference no. (optional)" | Text input | Records the card terminal/slip reference. | Optional, trimmed. | Sent with the payment record. |
| PAY-4 | Cash mode — num-pad + "Exact" + "+100/+500/+2000" | Num-pad & quick buttons | Enters cash received; computes change. | Whole rupees only. Live status strip: idle ("Enter the amount received · due ₹X"), "Return to patient ₹X" (green), "Exact — no change due", "Short by ₹X" (red). **Confirm is disabled until cash received ≥ total.** | Change math is display-only; the recorded payment equals the bill total. |
| PAY-5 | Wallet mode — "Search vendor…" + vendor list | Search + pick list | Charges a credit-vendor wallet: search by name/code, pick from list (name + balance); "Change" swaps vendor. | Only active vendors listed (up to 25 unfiltered); shows each balance; **Confirm disabled until a vendor is picked**. "Loading vendors…" / "No vendors." states. On this screen there is **no client-side balance check** — the server rejects insufficient credit. | Vendor id attached to the payment. |
| PAY-6 | Split mode — two rows of mode-select (Cash/UPI/Card) + amount | Paired inputs | Splits payment across two tenders. | Status line "Allocated ₹X of ₹Y" turns green only when the parts sum EXACTLY to the total (and total > 0) — **Confirm disabled otherwise**. | Each non-zero part is recorded as its own payment. |
| PAY-7 | Pay later — "Advance now" amount + tender chips (Cash/UPI/Card) | Numeric input + chips | Optionally collects a partial advance; balance stays outstanding ("due on report"). | Digits only; advance capped at the total. Hint: "Collect ₹A now · ₹B stays outstanding", or "No advance — the full ₹X is due on the report." when 0. Tender chips appear only once an advance > 0 is typed. | Advance recorded as a partial payment; the rest stays due (surfaces in the landing's payments-due drawer). |
| PAY-8 | Confirm button (label varies: "Confirm payment · ₹X" / "Collect advance · ₹X" / "Place order (pay later)") | Primary button | Fires the whole create-order-and-pay sequence. | **Disabled** when: busy ("Processing…"), the discount is over the user's cap, or the per-mode gate fails (PAY-4/5/6). Pay-later needs nothing. | See PAY-9. |
| PAY-9 | (behavior of Confirm) | — | Creates the order → creates the bill (with the cart discount) → records the payment(s) per mode. | Discount over cap at this moment → error toast "Discount N% exceeds your limit of M%…" and nothing is created. | Success: local draft cleared; pane swaps to the **paid state**; toast "Payment collected" (paid) / "Advance collected — balance pending" / "Order placed — payment pending" (pay-later, no advance). Any step failing → error toast with the server message; note the order/bill may already exist if a later step failed. |
| PAY-10 | Paid state — Print invoice | Button ("Payment recorded ✓" panel) | Builds the A4 invoice PDF (letterhead, invoice number, patient-tracking QR + staff order QR, cashier name) and opens the print dialog. | On the native mobile app, printing goes through the OS share sheet instead; fallback is the in-app PDF preview modal (ORD-30). | Print dialog / share sheet opens; QR failures degrade gracefully (invoice still renders). |
| PAY-11 | Paid state — Share on WhatsApp | Button | Native app: hands the actual invoice PDF to the OS share sheet. Web: opens WhatsApp click-to-chat to the patient's phone pre-filled with invoice number + paid amount + "report will be shared here" message. | Requires the paid bill; uses the patient's phone. | New tab / share sheet opens. |
| PAY-12 | Paid state — Collect sample | Primary button | Jumps into the sample-collection flow for the just-paid order. | Only visible when this branch collects at the front desk AND the sample-collection workflow is on AND the user holds `collect_sample`. | Navigates to the collection screen with this order preloaded; finishing there returns to the front-desk landing. |
| PAY-13 | Paid state — New order | Button (primary if PAY-12 hidden, ghost otherwise) | Resets the whole screen for the next patient. | — | Cart, patient, discount, paid state all cleared; patient search refocused. |

**Flows**
1. Walk-in, front-desk billing: search patient → pick → add tests (totals update live) → optionally enter discount within cap → pick payment mode → Confirm → order + bill + payment created in one go → paid panel → Print/WhatsApp invoice → "Collect sample" (if permitted) or "New order".
2. Walk-in, separate billing counter: same build-up, but the right column ends in "Proceed to billing" → order + invoice created, toast tells reception to send the patient to the counter, screen resets to the landing.
3. Cash short-pay attempt: entering less cash than the total shows a red "Short by ₹X" strip and Confirm stays disabled until the tendered amount ≥ total.
4. Over-cap discount: entering a discount above the user's tier cap turns the field red, shows the inline limit message, and blocks Confirm; reducing the value re-enables it.
5. Package upsell: adding CBC + ESR individually when a package contains both surfaces the "Save with a package" card → Apply swaps the two tests for the package and toasts the saving.
6. Draft resume: build a cart → "Save as draft" → screen returns to the landing → later reopening order-create for the same patient (≤7 days, same browser) restores the cart and priority with an info toast; completing payment or the order deletes the draft; "Discard draft" removes it.
7. Repeat: arriving with `fromOrderId` pre-fills the prior order's tests; tests deactivated since are dropped with an explanatory warning toast.
8. Edit: arriving with `editOrderId` loads the order's patient + tests; add/remove; "Update order & reconcile" saves and routes to billing to settle the price difference (Balance due → collect; Refund due → refund panel). Inline payment is never shown in edit mode.
9. Search auto-tab: typing in the test search flips to "All tests"; picking a result clears the search and returns focus for the next query; clearing the search returns to the tab you were on.
10. Split ₹1000 as ₹600 cash + ₹400 UPI: the indicator turns green only at exactly ₹1000; Confirm then records two payments.
11. Appointment check-in: arriving with `appointmentId` pre-fills the tests drafted at booking; the created order is tagged with source "appointment".

**Known gaps QC should flag as "by design":** the order-create UPI QR (and the dispatch-package QR on the board) are generated via an external QR-image service — they require internet access to render.

### 4.2 Order QR Router (`/o/:id`)

**Purpose:** Landing for a scanned staff order-QR (printed on invoices/labels); no visible controls — it decides where "open this order" should go.
**Who sees it:** Any signed-in user; behavior branches on permissions.

| ID | Control (label) | Type | What it does | Rules / validation | Result (success / failure) |
|---|---|---|---|---|---|
| OQR-1 | (none — full-screen "Opening order…" loader) | Auto-redirect | Routes based on capability. | If the sample-collection workflow is enabled AND the user holds `collect_sample` → straight into the Sample Collection screen deep-linked to this order (Collect drawer opens directly; closing returns to the originating screen/home). Otherwise the order is loaded and the user lands on its patient's profile. | Missing/invalid id, load failure, or an order with no patient → silently redirected to the app home (no error dialog — QC: this is specified behavior, not a crash). |

**Flows**
1. Phlebotomist scans an invoice's order QR → lands directly in collection for that order.
2. Receptionist without collect permission scans the same QR → lands on the patient's profile where the order is listed.
3. Scanning a dead/foreign order id → returns to home without an error message.

---

## 5. Sample Collection & Home Collection

All screens require sign-in; per-screen permissions listed below. If a required permission or workflow toggle is missing, the route is blocked (user bounced away, or to the 403 page).

### 5.1 Sample Collection worklist + Collect drawer (`/lab/collect`, also served at `/sample-collection`)

**Purpose:** The phlebotomist's queue of orders awaiting sample draw — find a patient by search/scan, tap each vial as it is drawn, print tube labels, dispatch to the lab, or flag tubes that could not be collected.
**Who sees it:** Users with **collect_sample**, and only while the sample-collection workflow stage is enabled. The `/sample-collection` variant additionally applies "effective" permission suppression: when the branch's collection mode is *dedicated counter*, a receptionist whose role technically includes collect_sample is bounced — only dedicated collectors get in. The **Dispatch** button additionally requires **dispatch_sample**.

**Deep-link behavior:** Arriving with `?orderId=…` (e.g. from Front desk "Collect" or a scanned order QR) hides the whole queue/KPI/search chrome, shows an "Opening collection…" loading animation, then opens that order's Collect drawer directly. Closing the drawer in this mode navigates back to the originating screen (the `from` parameter if provided, otherwise Front desk) instead of showing the queue.

| ID | Control (label) | Type | What it does | Rules / validation | Result (success / failure) |
|---|---|---|---|---|---|
| SCOL-1 | KPI strip | Read-only stat strip | Shows the KPI tiles an admin assigned to the **Sample collection** screen in KPI configuration (section 11.10 — candidate metrics include Awaiting collection, Collected today, Dispatched today, STAT today). Shared strip behavior (labels, value formats, 30 s auto-refresh, per-tile permission gating) is specified in 11.10. | Hidden in deep-link mode. Hidden entirely when no KPIs are assigned/enabled for this screen (the default for a fresh tenant) or the fetch fails — never an error state. | Informational only. |
| SCOL-2 | Refresh | Ghost button (header) | Re-fetches the pending-collection list. | Hidden in deep-link mode. | Queue re-renders; silent on failure (list unchanged). |
| SCOL-3 | Camera icon (left of search) | Icon button | Opens the barcode Scanner modal (SCAN). | — | Scanner modal appears over the page. |
| SCOL-4 | "Find patient or scan" | Text input | Single search box: live-filters the pending list as you type; Enter runs a full search. | Autofocused so a plugged-in barcode gun types straight into it and its terminating Enter triggers the search. Live filter matches: patient name (contains), order number prefix (leading "#" ignored), vial barcode (contains), patient phone (contains), MRN (contains). Case-insensitive. | List narrows while typing; heading count updates. Empty input shows everything. |
| SCOL-5 | Scan | Button | Opens the same Scanner modal as SCOL-3. | — | Scanner modal appears. |
| SCOL-6 | Find | Button | Executes the search on the current input. | **Disabled** while the box is empty or a barcode lookup is in flight (label "Searching…"). Resolution order: (1) exactly one queue match → opens that order's drawer and clears the box; (2) no match and the text looks like a vial barcode (starts with "PF-" or is 6+ digits) → exact barcode lookup; (3) no match otherwise → resolved as an order code (order QR/URL/GUID/invoice number); (4) multiple matches → nothing happens, filtered list stays for the user to pick. | Barcode hit → drawer opens for that vial's order, box clears. Barcode miss → error toast "No sample with that barcode". Order-code hit → drawer opens (order's vials merged in even if already collected). Order-code miss → warning toast "No matching order for that scan." |
| SCOL-7 | Pending-collection heading | Read-only | "Pending collection · N patient(s)" — count of orders after filtering. | Correct singular/plural. | — |
| SCOL-8 | Patient card (one per order) | Button (full card) | Opens the Collect drawer for that order. | Card shows avatar, patient name, meta line (sex · age · #first-8-of-order-number), a mini "rack" of coloured chips (one per vial, colour = tube convention; dimmed when already drawn; outlined style if the vial is outsourced), and a tail count: "N vials", or "n/m" progress when partially drawn. Cards sort oldest order first. | Drawer opens. |
| SCOL-9 | Empty state | Read-only | "No samples waiting for collection." shown when the (filtered) queue is empty. | — | — |
| SCOL-10 | Backdrop / ✕ close (Collect drawer) | Click area / icon button | Closes the drawer. | — | Normal mode: drawer closes and the queue silently refreshes (fully-collected orders drop off). Deep-link mode: navigates back to the originating screen. |
| SCOL-11 | Progress "n/m vials drawn" + bar | Read-only | Live count of drawn vials with a proportional progress bar. | Counts every vial not in "pending". | — |
| SCOL-12 | Vial tile (one per tube) | Toggle button (large illustrated tube) | Tap = mark this vial **collected** (fill animation; green tick; timestamp). Tap again = undo back to pending. | Only toggles pending ↔ collected. Vials already dispatched/received/etc. are **locked** — tapping does nothing. Tile shows tube type label (EDTA·Lavender, SST·Gold, Plain·Red, Citrate·Blue, Heparin·Green, Fluoride·Grey, urine cup, sterile container — from the test's sample type, else the department's convention), department name, first test name (+N for more, full list on hover), vial barcode (— if none), and a stamp: collection time, "Dispatched", or "Tap when drawn". | Collect: instant optimistic UI, saved in the background; if the save fails the tile reverts with error toast "Could not mark collected — try again". Undo: same optimistic pattern; failure reverts with "Could not undo — tube may have moved to the lab". While the drawer is open the list is never re-fetched, so just-tapped vials do not vanish. |
| SCOL-13 | Can't collect | Ghost button (footer) | Opens the Reject-with-reason dialog (REJ). | Shown only while the order is **not** dispatched. Does nothing if no vial is still pending. | Reject dialog opens. |
| SCOL-14 | Print labels | Ghost button (footer) | Prints one barcode+QR tube label per vial of this order (same label design as front desk) — only the labels reach paper. | Available any time in the drawer (before or after drawing). | Browser print dialog with the label sheet. If the order has no tubes: warning toast "No tubes to label". |
| SCOL-15 | Status stamp | Read-only (footer) | "Dispatched to lab" once every tube is past collected; "All vials collected" once n=m; otherwise "X remaining". | — | — |
| SCOL-16 | Dispatch | Primary button (footer) | Hands all collected tubes of the order over to the lab. | **Visible only when**: every vial is collected AND the user holds **dispatch_sample** AND the order isn't already dispatched. Disabled while the call runs ("Dispatching…"). | Success: tubes flip to Dispatched, toast "Dispatched to lab", footer shows Undo dispatch. Failure: toast "Could not dispatch — try again". |
| SCOL-17 | Undo dispatch | Ghost button (footer) | Reverts dispatched tubes back to collected. | Shown only while the order shows as dispatched; disabled while running ("Undoing…"). Only possible while the lab has not received the tubes. | Success: toast "Dispatch undone", Dispatch button returns. Failure: toast "Could not undo — the lab may have received it". |
| SCOL-18 | Done / "Collect all to finish" | Button (footer) | Closes the drawer. | **Disabled** (label "Collect all to finish") until every vial is drawn; becomes "Done" (primary style once dispatched). | Same close behavior as SCOL-10. |
| SCOL-19 | Outsourced vial indicator | Read-only indicator on vial chips (queue cards) | Marks vials destined for a referral lab: the chip carries a **pink outline** in addition to its tube colour; hover/long-press tooltip reads "<tube label> · Outsourced" (plain "<tube label>" otherwise). | Outsourced vials exist as separate tubes per (referral lab + department at vendor) because the split happens automatically at order creation. There is **no extra "send out" / dispatch action** on this screen — outsourced vials are collected through exactly the same drawer/scan flow. | — |

#### Reject-with-reason dialog (opens from SCOL-13)

| ID | Control (label) | Type | What it does | Rules / validation | Result (success / failure) |
|---|---|---|---|---|---|
| REJ-1 | Reason chips | Single-select chip group | Pick why collection failed: *Patient refused, Patient fainted, Vein not found, Insufficient sample, Wrong tube, Other*. | Exactly one must be selected; selected chip highlights. | Enables the notes field and (subject to REJ-2) the submit button. |
| REJ-2 | Notes | Multi-line text | Free-text detail sent to the lab with the reason. | Optional for named reasons ("Notes (optional)"); **required non-blank** when reason = Other ("Reason"). | Combined as "Reason label — note". |
| REJ-3 | Cancel (also backdrop click) | Button | Abandons the rejection. | — | Dialog closes; nothing changes. |
| REJ-4 | Reject N tube(s) | Danger button | Flags every still-pending vial of the order for re-collection. | **Disabled** until a reason is picked (and a note typed, if Other). Button label shows the live count of pending tubes; already-drawn tubes are untouched. | Success: toast "N tube(s) flagged for re-collection"; dialog **and** drawer close; queue refreshes — rejected tubes reappear as pending so they can be re-collected (this is the recollect path). Individual tube failures are silently skipped. |

#### Barcode Scanner modal (opens from SCOL-3/SCOL-5; the same shared modal is used elsewhere with an "expected barcode" — both behaviors specified)

| ID | Control (label) | Type | What it does | Rules / validation | Result (success / failure) |
|---|---|---|---|---|---|
| SCAN-1 | Live status ("Scanner · LIVE / STARTING") | Read-only | Indicates whether the camera stream is decoding. | — | — |
| SCAN-2 | Camera viewfinder | Live video | Continuously decodes QR/barcodes from the camera. | If the camera cannot start, a friendly message is shown: permission denied / no camera / camera in use / generic failure — plus a hint that a handheld gun still works. | On decode: see SCAN-5 matching rules. |
| SCAN-3 | HID scanner buffer | Read-only code readout | A handheld gun "types" its code; keystrokes while the modal is open are buffered and shown live; the gun's terminating Enter submits the buffer. | Buffer resets if >600 ms passes between keystrokes (blocks slow human typing); keys typed into a focused input/textarea are ignored. | Enter → code processed as a scan. |
| SCAN-4 | Enter manually / Use camera | Toggle button | Switches between camera view and a manual-entry panel; camera pauses while the manual panel is open. | Manual entry is only functional when the caller supplied an expected barcode (this screen supplies none, so the panel shows "Manual entry isn't available without an expected barcode. Use the search bar's manual option instead."). | Panel swaps; camera resumes when toggled back. |
| SCAN-5 | (scan match rule) | Behavior | With **no** expected barcode (this screen): any decoded code is accepted → modal closes, the code lands in the search box and the search runs immediately. With an expected barcode (other call sites): a non-matching scan flashes an inline red alert "Scanned X — expected Y. Keep the correct vial and try again." for 2.5 s and the camera stays live; only the exact match closes the modal. | Match comparison is case-insensitive. | Accepted scan → follows SCOL-6 resolution (drawer / toasts). |
| SCAN-6 | Manual 5-digit sequence | Numeric input (+ on-screen numpad on touch devices) | When an expected barcode of the form PF-vendor-year-#####-dept exists, all segments are shown locked and only the 5-digit sequence is typed. | Digits only, max 5; on touch devices the keyboard is suppressed and the on-screen numpad is used. Enter submits when 5 digits present. | Assembled code goes through the same match rule (a typo triggers the mismatch flash). |
| SCAN-7 | Confirm | Button | Submits the manual sequence. | **Disabled** until exactly 5 digits entered. | As SCAN-6. |
| SCAN-8 | Cancel / ✕ / backdrop | Buttons | Closes the scanner without a result. | Camera is stopped. | Modal closes; nothing else changes. |

**Flows**
1. Gun scan of a vial: cursor sits in the autofocused search box → gun types "PF-…" + Enter → exact barcode lookup → the vial's order drawer opens (or toast "No sample with that barcode").
2. Camera scan: tap Scan → point at any vial barcode or order QR → modal closes, code drops into the search and resolves → drawer opens.
3. Typing a patient name narrows the queue live; if exactly one order remains when Enter is pressed, its drawer opens and the box clears; if several remain, the list stays filtered for a manual tap.
4. Drawing vials: tap each tube as drawn → fill animation + tick + timestamp; a mis-tap is undone by tapping again (only until dispatch). When the last tube is tapped the footer flips to "All vials collected" and, for dispatch-capable users, the Dispatch button appears.
5. Dispatch → "Dispatched to lab" stamp + Undo dispatch appears; Undo works only until lab receipt.
6. Failed draw: "Can't collect" → pick a reason chip (note mandatory only for Other) → "Reject N tubes" → pending tubes are flagged with the reason, drawer closes, and they return to the pending queue for re-collection.
7. Front-desk hand-off: FD clicks Collect on an order → this page opens straight into the drawer (no queue flash); closing the drawer returns to the FD screen.
8. Outsourced order (e.g. one test outsourced to Apollo, dept Biochemistry): the patient card shows separate chips — the Apollo vial's chip has a pink outline and the tooltip "<tube> · Outsourced"; both vials are collected identically.

### 5.2 Collection Queue (`/frontdesk/queue`)

**Purpose:** Live front-desk view of who is waiting to have samples collected today, with call/skip/no-show/urgent controls and a walk-in add.
**Who sees it:** Users with **any** of register_patient / create_order / view_order / collect_sample, and only while the *queue* workflow stage is enabled.

The subtitle states the branch's queue mode: "Token queue — patients called by priority", "Walk-up — served first-come", or "Home collection — by scheduled visit time". The page **auto-refreshes every 20 seconds**.

| ID | Control (label) | Type | What it does | Rules / validation | Result (success / failure) |
|---|---|---|---|---|---|
| QUE-1 | "N waiting · ~Xm avg" | Read-only (header) | Waiting count (waiting + in-progress) and average collection minutes from the server. | — | — |
| QUE-2 | Refresh | Ghost button | Reloads the queue immediately. | — | Sections re-render; failure toast "Could not load the queue." |
| QUE-3 | + Walk-in / Close | Primary button | Toggles the walk-in panel open/closed (label flips). | — | Panel appears/disappears. |
| QUE-4 | Walk-in patient search | Type-ahead search input | Search an existing patient (name / MRN / phone / ABHA); picking a result adds them to today's queue as checked-in with a token. | Minimum 2 characters (hint shown); ~0.2 s debounce. Helper text: "Adds the patient as checked-in with a token. Mark urgent from the row if it's a STAT sample." | Success: toast "Added to queue.", panel closes, queue reloads. Failure: toast "Could not add walk-in." |
| QUE-5 | Section headers | Read-only | Queue grouped: **Now collecting** (in progress), **Waiting** (checked-in, with count; empty state "No one waiting."), **Upcoming (not arrived)** (booked), **Done today** (completed / no-show / skipped, rendered dimmed). | Sections with no rows are hidden (except Waiting, always shown). | — |
| QUE-6 | Queue row | Read-only card | Per person: token number box (border colour by visit type — urgent/emergency red, appointment amber, walk-in yellow, follow-up green; "—" if no token), type dot + patient name + type text, red **late** badge when late, status line ("Waiting 25m · ~10m to go" — waits ≥60 min show "1h 5m"; "Collecting now"; "Scheduled ‹slot›" for booked; otherwise the status), phone if known. | — | — |
| QUE-7 | Priority score chip | Read-only chip | Numeric priority (higher = called sooner; tooltip explains base-by-type + minutes waited − late penalty; urgent jumps top). | **Only shown in token-queue mode**, and only on waiting / in-progress rows (walk-up is first-come and home-collection is by slot time). | — |
| QUE-8 | Check in | Primary button (booked rows) | Marks an expected patient as arrived → moves to Waiting. | — | Row moves to Waiting on refresh; failure toast "Action failed." (applies to QUE-8..13). |
| QUE-9 | No-show | Ghost button (booked & waiting rows) | Marks the person as a no-show. | — | Row moves to Done today. |
| QUE-10 | Call | Primary button (waiting rows) | Starts collecting this patient → moves to Now collecting. | — | Row moves to Now collecting. |
| QUE-11 | Urgent | Ghost button (waiting rows) | Escalates the visit to urgent priority. | **Hidden** if the row is already urgent/emergency. | Type/colour changes to urgent; priority jumps. |
| QUE-12 | Skip | Ghost button (waiting rows) | Skips the person (moved out of the active queue). | — | Row moves to Done today as "Skipped". |
| QUE-13 | Complete | Primary button (in-progress rows) | Finishes the collection for this patient. | — | Row moves to Done today. |

**Flows**
1. Walk-in arrives: "+ Walk-in" → search their name/phone (2+ characters) → tap the match → toast "Added to queue.", the person appears under Waiting with a token.
2. Calling the next patient (token mode): highest-priority Waiting row → "Call" → row jumps to Now collecting → after the draw, "Complete" → row drops to Done today.
3. STAT sample: on a waiting row press "Urgent" → row recolours red and its score jumps it to the top of the call order.
4. Booked appointment arrives: their row sits under Upcoming → "Check in" moves them to Waiting; if they never arrive, "No-show" retires the row.
5. Leave the tab open: counts, wait times and ordering refresh themselves every 20 seconds.

### 5.3 Unassigned Home Collections (`/frontdesk/home-collection`)

**Purpose:** Reception's catch tray for home-collection requests that no agent's coverage area matched — pick an agent manually for each.
**Who sees it:** Users with **any** of manage_home_collection / register_patient / create_order; the *home visits* workflow stage AND the *Home Collection* module must both be on.

| ID | Control (label) | Type | What it does | Rules / validation | Result (success / failure) |
|---|---|---|---|---|---|
| HCA-1 | Refresh | Ghost button (header) | Reloads the unassigned-request list. | — | List re-renders; failure toast "Could not load requests." |
| HCA-2 | No-agents banner | Read-only amber banner | "No home-collection agents exist yet. Add some in Admin → Home-collection agents." | Shown only when requests exist but zero active agents are configured. | — |
| HCA-3 | Request card | Read-only | One card per unassigned request: patient name, address (or "No address") · pincode, slot time (— if none) · patient phone. | — | — |
| HCA-4 | Choose agent | Dropdown (per card) | Pick the agent for this request. | Lists **active** agents only, by display name; one independent selection per card. | Enables that card's Assign button. |
| HCA-5 | Assign | Primary button (per card) | Assigns the chosen agent to the request. | **Disabled** until an agent is chosen in HCA-4. | Success: toast "Assigned.", list reloads and the card disappears (it now appears in that agent's My Visits). Failure: toast "Could not assign." |
| HCA-6 | Empty state | Read-only | "Nothing waiting — every home-collection request has an agent." | Shown when the list is empty. | — |

**Flows**
1. A booking's pincode matched no agent → the request lands here → receptionist picks an agent → "Assign" → toast "Assigned." and the card leaves the list.
2. No agents configured at all → amber banner points the admin to the agent-setup screen; Assign stays unusable (dropdown has no options).

### 5.4 My Visits — home-collection agent view (`/home-collections`)

**Purpose:** The field agent's own list of assigned home-collection visits: navigate to the address, check in on arrival (which creates the lab order), collect on the standard collection screen, then close the visit.
**Who sees it:** Users with **collect_sample**; *home visits* workflow stage AND *Home Collection* module on. Only visits assigned to the signed-in agent appear.

| ID | Control (label) | Type | What it does | Rules / validation | Result (success / failure) |
|---|---|---|---|---|---|
| HCV-1 | Refresh | Ghost button (header) | Reloads the visit list. | — | Failure toast "Could not load visits." |
| HCV-2 | Visit card | Read-only | Patient name, "Scheduled Visit" label, status chip (Booked = neutral, "Checked in" = amber, "Collecting" = violet), visit date (dd MMM yyyy) + slot time, address (+ pincode), phone. | — | — |
| HCV-3 | Phone number | Tap-to-call link | Dials the patient. | Shown only when the patient has a phone. | Device dialer opens. |
| HCV-4 | Directions ↗ | External link | Opens Google Maps: exact pin when the request has coordinates, otherwise a search on address + pincode. | **Hidden** when the visit has neither coordinates nor an address; opens in a new tab/app. | Maps opens. |
| HCV-5 | Check in & collect | Primary button | Marks arrival; the check-in **creates the lab order from the pre-booked tests**, then jumps to the Sample Collection screen to draw the vials. | Shown only while the visit status is **booked**. | Success: toast "Checked in — collect the samples." then navigate to the collection screen. Failure: toast "Check-in failed.", list reloads. |
| HCV-6 | Collect samples | Secondary button | Re-opens the Sample Collection screen (no state change) — for returning to a draw already in progress. | Shown for any non-booked status. | Navigates to the collection screen. |
| HCV-7 | Complete visit | Primary button | Closes the visit once samples are drawn; the appointment becomes *completed* and leaves this list. | Shown only while the visit is **checked in** or **collecting**. No confirmation prompt. | Success: toast "Visit completed.", list reloads without the card. Failure: toast "Could not complete the visit.", list reloads. |
| HCV-8 | Empty state | Read-only | "No home-collection visits assigned to you." | — | — |

**Flows**
1. Standard visit: tap Directions → drive out → "Check in & collect" (toast, lab order spawned) → land on Sample Collection → the patient's order is in the pending queue → draw the vials → back here → "Complete visit" → card disappears.
2. Interrupted draw: return mid-visit → status chip reads "Checked in"/"Collecting" → "Collect samples" returns to the collection queue without touching the visit state.
3. Calling ahead: tap the phone number on the card to ring the patient before setting off.

### 5.5 Home-Collection Agents (admin) (`/admin/home-collection`)

**Purpose:** Configure which staff are home-collection agents, the geographic area each covers (pincode list or geo radius), and their share of auto-routed work.
**Who sees it:** Users with **manage_home_collection** or **manage_branches**; *Home Collection* module on. (Requests inside a coverage area are auto-routed to agents, load-balanced by weight; anything unmatched falls to the front-desk assignment screen 5.3.)

| ID | Control (label) | Type | What it does | Rules / validation | Result (success / failure) |
|---|---|---|---|---|---|
| AGT-1 | + Add agent / Cancel | Primary button (header) | Opens the agent form blank; label flips to "Cancel" which closes it. | Opening always resets the form to defaults (Pincode mode, radius 5 km, weight 1). | Form panel shows/hides. |
| AGT-2 | Agent (staff member) | Dropdown | Pick the staff user to make an agent. | Lists **active** users only, as "Name · email". **Disabled when editing** an existing agent (you edit the area, not the person). | Required — Save stays disabled without it. |
| AGT-3 | Coverage | Segmented toggle | "Pincode list" vs "Geo radius" — switches which area fields show. | — | Field set swaps (AGT-4 vs AGT-5/6/7). |
| AGT-4 | Pincodes — list and/or ranges | Text input | The pincodes this agent serves. | Comma-separated; ranges written "600001-600050" or "600001 to 600050" (helper text shows both). Whitespace-trimmed; blank entries dropped. No format validation beyond that — invalid tokens are sent as typed. | Saved as the coverage list. |
| AGT-5 | Centre latitude | Numeric stepper | Radius-mode centre point latitude. | Step 0.001; may be left empty (card then reads "Radius area — coordinates not set" and no auto-routing match is possible). | — |
| AGT-6 | Centre longitude | Numeric stepper | Radius-mode centre point longitude. | Step 0.001; may be left empty. | — |
| AGT-7 | Radius (km) | Numeric stepper | Coverage radius around the centre. | Step 1, minimum 1, default 5; may be empty. | — |
| AGT-8 | Weight (share of work) | Numeric stepper | Load-balancing weight — weight 2 gets ~twice the auto-routed requests of weight 1. | Step 1, minimum 1, default 1; empty resets to 1; any value below 1 is raised to 1 on save. | — |
| AGT-9 | Cancel (form footer) | Ghost button | Closes the form, discarding changes. | — | Form hides. |
| AGT-10 | Save agent | Primary button | Creates or updates the agent record (saved as active). | **Disabled** until an agent user is picked, and while saving ("Saving…"). Only the fields for the selected coverage mode are saved; the other mode's fields are cleared. | Success: toast "Saved.", form closes, card list reloads. Failure: toast "Could not save agent.", form stays open. |
| AGT-11 | Agent card | Read-only | Name, violet "weight N" chip, grey "inactive" chip when deactivated, and an area summary: "Pincodes: …" / "Pincode area — none set" / "X km around lat, lng" / "Radius area — coordinates not set". | — | — |
| AGT-12 | Edit | Secondary button (per card) | Opens the form pre-filled with that agent's area, mode, radius and weight; heading reads "Edit area". | Agent picker locked (AGT-2). | On Save, same as AGT-10. |
| AGT-13 | Remove | Ghost button (per card) | Deletes the agent record. | **No confirmation dialog** — removal is immediate. | Success: toast "Removed.", card disappears. Failure: toast "Could not remove." |
| AGT-14 | Empty state | Read-only | "No home-collection agents yet." | — | — |

**Flows**
1. New pincode agent: "+ Add agent" → pick user → leave Coverage on "Pincode list" → type "600001, 600028, 600040-600060" → set weight → "Save agent" → toast "Saved.", card appears with the pincode summary.
2. Switch an agent to radius coverage: card → "Edit" → Coverage → "Geo radius" → enter lat/lng/radius → Save; pincodes are cleared automatically.
3. Rebalance workload: Edit → bump Weight from 1 to 2 → Save; future auto-routing sends this agent roughly double share.
4. Remove: tapping Remove deletes instantly (QC note: there is deliberately no "are you sure" step).

**Cross-screen QC notes**
- **Recollect path:** rejected tubes (REJ-4) revert to *pending* and reappear in the worklist with the rest of the order — there is no separate "recollect" screen; recollection = drawing them again from the queue.
- **Role differences:** collect_sample → worklist + agent visits; dispatch_sample → Dispatch/Undo in the drawer; manage_home_collection (or manage_branches) → admin agents; front-desk perms → queue + unassigned-assignment; receptionists lose access to `/sample-collection` when the branch runs a dedicated collection counter.
- **Module/workflow toggles:** every home-collection screen disappears entirely (route blocked) when the Home Collection module or the *home visits* workflow stage is off; the worklist requires the *sample collection* stage; the queue requires the *queue* stage.
- All destructive/final actions (queue No-show/Skip, agent Remove, Complete visit) act **without confirmation dialogs**; only "Can't collect" (structured reasons) and dispatch (explicit button + undo) have guarded flows.

---

## 6. Processing & Validation (Result Entry, Validation, Amendments)

Scope: the Lab worklist ("My Work"), the two result-entry forms (tube/sample-level and legacy per-test), the structured Culture & Sensitivity sub-form and its plate-measure dialog, the supervisor Delegate picker, the shared validator↔tech comment thread, and the two pathologist screens (Pending Validation queue and Validate Result). "Amendments" in this area are realised as (a) the tech **reopen/undo-submit** of a not-yet-validated tube, and (b) the validator **Edit values** in-place before sign-off. There is no separate post-release amendment screen in this feature area (a released report carries an "amended" status flag, but that belongs to the Reports area).

### 6.1 Lab — My Work / Workbench (`/lab/my-work`)

**Purpose:** The lab tech's landing worklist — scan or pick a tube to open result entry, receive incoming samples, and (for supervisors) delegate/reassign work.
**Who sees it:** Users with `enter_result` **or** `receive_sample`, and only when the result-entry workflow action is enabled. Intake-only staff (only `receive_sample`) land here to use the embedded Lab Intake pane. Supervisor-only extras (Delegate on the Queue tab, Show claimed) require `reassign_result`.

| ID | Control (label) | Type | What it does | Rules / validation | Result (success / failure) |
|---|---|---|---|---|---|
| MW-1 | Stats (bar-chart icon, phone only ≤640px) | Icon toggle button | Opens a popover listing the 5 counter filters with live counts. | Phone only; hidden ≥641px where inline pills (MW-3) show instead. | Popover opens anchored under the button; tapping a counter filters and closes it. |
| MW-2 | Refresh | Button | Re-fetches the active tab's rows and all tab counts. | Always enabled. | Queue and counts reload. |
| MW-3 | Counter pills: Pending / Critical / In progress / Done today / All | Segmented filter (5 cells, desktop ≥641px) | Filters the visible queue by result status. Pending = pending+re_entry; Critical = result snapshot flagged critical; In progress = in_progress+entered; Done = validated; All = everything. | Single-select; "All" is the default. | Selected pill highlights; queue re-filters instantly (client-side, no fetch). |
| MW-4 | Scan barcode / type sample ID | Text input | Type or scan a tube barcode / sample ID. | Placeholder shows an example ID derived from tenant sample-number width + dept code + 2-digit year. | On Enter or Open (MW-6): resolves per flow 1 below. |
| MW-5 | Manual entry / Close manual | Toggle button | Opens the structured manual-barcode composer (MW-8..12). | Hidden on phone (≤640px). | Composer tile expands/collapses; loads departments on first open. |
| MW-6 | Open (arrow) | Primary button | Submits the scan input. | **Disabled when the scan field is empty.** | Routes to result entry, opens an order, or warns "No match for that code". |
| MW-7 | Camera (scan) | Icon button | Opens the camera barcode scanner ("Scan any vial barcode"), no expected code. | — | On decode, value drops into the scan field and submits through the same gate. |
| MW-8 | Manual: Department | Dropdown | Picks the department whose 2-digit sample code prefixes the barcode. | Persisted as "last dept" in local storage; auto-selects last-used or first. | Preview code (MW-12) updates. |
| MW-9 | Manual: sequence number | Numeric input | The running number segment of the barcode. | Digits only; **max length = tenant sample-number width (1–9, default 5)**; non-digits stripped. | Shows "N more digit(s)" hint until full. |
| MW-10 | Manual numpad (touch devices) | On-screen keypad | Enters the sequence number on coarse-pointer devices. | Same length cap; no decimal, no negative. | Mirrors MW-9. |
| MW-11 | Manual: Open | Primary button | Builds full barcode `DD+YY+seq` and submits it as a scan. | **Disabled unless sequence is full length AND the selected department has a sample code assigned.** | Same resolution as MW-6; sequence field clears after. |
| MW-12 | Preview code | Read-only display | Shows the assembled barcode live. | — | — |
| MW-13 | Lab Intake — inline scan bar (icon input + camera + Receive) | Text input + buttons | Receives an incoming sample into the lab by barcode; embeds the Receive-Samples component. | **Receive button disabled while the field is empty (trimmed)**; camera opens the intake scanner. | On match, sample is auto-intaken; field clears. Hidden entirely when the lab-intake action is switched off in the Process builder. |
| MW-14 | Intake search magnifier (phone) | Icon toggle | Expands/collapses the cramped intake search to full-width. | Phone only. | Field expands and focuses. |
| MW-15 | Intake / My Work / Queue (phone tabs) | Tabs | Switches the single visible pane on phones; My Work → loads my-work data, Queue → loads the service queue. | Intake tab hidden if lab-intake is off (auto-falls to My Work). | Pane swaps; count badges on My Work/Queue. |
| MW-16 | My Work / Queue (desktop tabs) | Tabs | My Work = tubes assigned to me needing action (pending / in_progress / re_entry); Queue = the unclaimed pool. | Count badge per tab. | Fetches the matching endpoint and refreshes. |
| MW-17 | Show claimed (Queue tab only) | Toggle | Also lists tubes other techs already claimed (badged with owner name) so stuck work can be found. | Loads the user directory on first enable. | Queue re-fetches including assigned tubes; owner pills appear. |
| MW-18 | Splitter handle (desktop ≥1024px) | Drag separator | Resizes the Intake vs Workbench panes. | Clamped 20–80%; persisted in local storage. | Pane widths change; saved on release. |
| MW-19 | Patient group card | Expander button | Expands/collapses a patient's tubes (grouped by order). | Card TAT level = worst of any test in the order. | Chevron rotates; tube rows reveal. |
| MW-20 | Open tube / Re-enter tube (My Work) | Primary button per tube | Opens the tube for result entry (one scan → all tests). "Re-enter tube" shown when the tube has rejected tests; a green "✓ All entered" pill replaces the button when the whole tube is done. | If the tube has a barcode, opens the scan-to-pick gate (flow 2); barcodeless tubes navigate directly. | A ~600ms "picking" fill animation, then routes to the sample-level entry screen. |
| MW-21 | Delegate (My Work, per tube) | Button | Opens the Delegate picker for every still-writable test on the tube. | Only shown when the tube is not fully done. | Delegate modal opens (see 6.6). Warns "Nothing to delegate…" if all tests already submitted. |
| MW-22 | Pick · view tests (Queue) | Button | Opens the Claim popup showing the tube's tests before claiming. | Shown when the tube is unassigned or already mine. | Claim sheet opens (MW-25..27). |
| MW-23 | Delegate (Queue) | Button | Reassigns pool/other-tech work. | **Only rendered when the user has `reassign_result`** (backend also enforces). | Delegate modal opens. |
| MW-24 | Rejection banner (per tube) | Read-only panel | Surfaces "Sent back for re-entry" with each rejected test name + pathologist's reason. | Shown only when ≥1 test in the tube is re_entry with a reason. | — |
| MW-25 | Claim popup — Scan tube to claim / Claim into my work | Button | Claims the whole tube (all writable tests) to me. | Label & behavior depend on the tenant no-scan-claim setting: if allowed → direct claim; if not → opens the scan gate first. | On success: toast "Claimed into My Work…", switches to My Work tab, counts refresh. Failure toast "Could not claim — try again". |
| MW-26 | Claim popup — close (✕) / backdrop | Button | Dismisses the claim popup. | Blocked while a claim is in flight. | Popup closes. |
| MW-27 | Claim scan gate | Camera modal | Requires scanning the tube's exact barcode before the claim commits. | Modal only emits on an exact barcode match; backend re-verifies. | On match, claim commits; cancel closes the gate. |
| MW-28 | (Legacy flat grid, hidden) | — | An older per-test card grid retained behind a flag; not rendered. | — | — |

**Flows**
1. **Scan resolution (MW-4/6/7/11):** If the scanned text is an order QR URL (`/o/<id>`) or a track URL (`/track/<token>`), it routes to that opener. Otherwise it looks for a row in the current queue whose barcode/id matches → claims by scan (backend verifies the user is the assignee and the code matches) → on success navigates to sample entry marked "just scanned". If not in my queue, the barcode is resolved to a sample with an info toast "This tube isn't in your queue — entering results will claim it to you." before opening it. No match → warning "No match for that code".
2. **Scan-to-pick a tube (MW-20):** Clicking Open tube opens the camera modal seeded with that tube's expected barcode. The modal only fires on an exact match; the backend then re-checks assignment — a wrong-vial scan is rejected in both places. A tube with no barcode skips the scan and navigates directly. A barcodeless tube on a per-test pick shows warning "This sample has no barcode — ask supervisor to reprint."
3. **Delegate (MW-21/23):** Picking a target user delegates every still-writable test on the tube; the new assignee must scan to pick up. Partial success shows "Delegated X of N — Y failed"; full success "Delegated — the new assignee must scan to pick up." Queue + counts refresh.

### 6.2 Sample-Level Result Entry (`/lab/sample/:sampleId`)

**Purpose:** Enter results for **all tests in one tube on a single screen** and submit once; the tube is the unit of work.
**Who sees it:** Users with `enter_result` **or** `edit_result`.

| ID | Control (label) | Type | What it does | Rules / validation | Result (success / failure) |
|---|---|---|---|---|---|
| SRE-1 | Back (chevron) | Button | Returns to My Work. | — | Navigates back. |
| SRE-2 | Grid / Form view toggle | Segmented (2) | Grid mirrors the report PDF columns (Parameter · Result · Unit · Reference range · Method); Form is a labelled field layout. | Persisted in local storage; hidden on phone (grid forced). | View switches. |
| SRE-3 | Save draft (disk icon in header + footer button) | Button | Saves partial values without finalising; tube stays in progress. | **Disabled while submitting or already saving**; only shown when ≥1 test is still writable. | Success toast "Draft saved — you can finish this tube later", then returns to My Work after ~600ms. Warns "Nothing to save yet — enter a value first" if no values. Failure "Could not save draft — try again". |
| SRE-4 | Submit all results (check icon in header + footer button) | Primary button | Finalises every writable test on the tube; backend runs the conditions/critical engine. | **Disabled while submitting/saving or when no test is writable**; skips validated + entered tests (re-submitting them would conflict). | Success: shows returned flags, toast "Submitted N test(s) — back to your queue", returns to My Work after ~700ms. Warns "Enter at least one value before submitting" (or "Every test on this tube is already submitted or validated"). Failure "Could not submit — try again". |
| SRE-5 | Undo submit & edit (reopen — footer button + header undo icon) | Button | Pulls a submitted (awaiting-validation) tube back into editable state and reloads its values. | Only shown when a test is in `entered` state and nothing is currently writable; **disabled while submitting**. | Success toast "Reopened — edit and submit again". Failure "Could not reopen — it may already be validated". |
| SRE-6 | Reject banner (top) | Read-only | Lists tests sent back for re-entry + the pathologist's reason. | Shown when ≥1 test is re_entry. | — |
| SRE-7 | + Note / Notes (N) (per test header) | Toggle button | Opens the overall (test-level) comment thread; label flips to "Notes (N)" once comments exist. | Existing comments force the thread visible. | Thread block reveals under the test header. |
| SRE-8 | Numeric result field | Number input (any step) | Enters a numeric parameter value. | Accepts decimals; right-aligned in grid. | Value stored; autosaved to local draft (debounced 500ms). |
| SRE-9 | Text result field | Text input | Enters a free-text value. | — | Stored/autosaved. |
| SRE-10 | Dropdown result field | Select | Picks one option (first entry is "—" = blank). | Options come from the parameter schema. | Stored/autosaved. |
| SRE-11 | Textarea result field | Textarea | Multi-line value. | — | Stored/autosaved. |
| SRE-12 | Checkbox result field | Checkbox | Boolean value (yes/no, toggle types). | — | Stored/autosaved. |
| SRE-13 | Date result field | Date input | Date value. | — | Stored/autosaved. |
| SRE-14 | Reference-range / normal hint | Read-only text | Grid shows the Reference range + Method columns; Form shows "Normal: …", "Crit< …", "Crit> …" beneath the field. | Only rendered when the parameter carries a normal value / critical bounds. | — |
| SRE-15 | Parameter flag (↻) + red input border | Visual indicator | Marks a parameter the pathologist commented on (open thread) so the tech focuses there. | Driven by unresolved per-parameter comments. | Input gets a red flagged border; row tinted. |
| SRE-16 | Per-parameter comment thread | Embedded thread | Conversation on a single parameter (see 6.7). | Rendered when comments exist or the parameter is flagged. | Add/reply posts to the result's comments. |
| SRE-17 | "No parameter schema" notice | Read-only | Shown for a test whose schema has no inputs. | Non-culture tests fall back to a single generic "Result" text field instead, so they are always enterable. | — |
| SRE-18 | Culture entry (embedded) | Sub-form | For microbiology culture tests, replaces the flat grid with the structured Culture & Sensitivity form (6.4). | Rendered when the test's micro format = culture & sensitivity. | See 6.4. |
| SRE-19 | Flags list (post-submit) | Read-only | After submit, lists returned critical/notification flags per test. | Populated from the submit response. | Critical flags styled in red. |

**Flows**
1. **Load & draft recovery:** On open, the tube's tests load and any previously saved server values pre-fill. A locally autosaved draft (from a mid-entry app kill) is overlaid on top (local typing wins). Every field change re-schedules a debounced local autosave; a successful Save-draft or Submit clears the local draft.
2. **Submit skips locked tests:** Validated and awaiting-validation (entered) tests are shown pre-filled but excluded from the submit payload; only writable tests are sent.
3. **Reopen (amendment before validation):** SRE-5 reopens an entered tube server-side (audited), re-loads its values, and lets the tech change and re-submit — the in-workflow correction path before a pathologist signs off.

### 6.3 Legacy Per-Test Result Entry (`/lab/result/:id`)

**Purpose:** Single-test result entry with a right-rail input helper (numeric keypad / option list); the richer field-type surface. Used when a row has no sample link, or when reached from validation "Back".
**Who sees it:** Users with `enter_result` **or** `edit_result`.

| ID | Control (label) | Type | What it does | Rules / validation | Result (success / failure) |
|---|---|---|---|---|---|
| RE-1 | Back | Button | Returns to My Work, or to the Validate screen when arrived from validation. | — | Navigates. |
| RE-2 | Autosave indicator ("saved · Ns ago") | Read-only pill | Shows time since last local draft save. | Appears only after a Save draft. | — |
| RE-3 | Reject | Button (ghost) | Rejects the whole sample back for re-collection via a prompt dialog. | **Prompt requires a non-empty reason** (multiline, danger tone). | On confirm the sample is rejected, toast "Sample rejected", returns to My Work. Cancel = no-op. |
| RE-4 | Save draft | Button | Marks a local "saved" timestamp. | Disabled while saving. | Toast "Draft saved" (local only). |
| RE-5 | Submit / Submit · notify | Primary button | Finalises the single test. | **Disabled while saving OR when not all required parameters are filled / any validation error**; label becomes "Submit · notify" and turns danger-styled when a critical value is present. | Success toast "Result submitted" (or "Submitted — flagged critical"), returns. If clicked while incomplete: warning "Fill all N required parameters before submit." Failure shows the error message. |
| RE-6 | Progress header (filled / required, dot pips, %) | Read-only | Live count of filled required params, per-param pips, percent. | Layout kinds (section header / info text / stub) don't count toward required. | — |
| RE-7 | Grid / Cards view toggle | Segmented (2) | Grid mirrors the report PDF columns; Cards is the legacy vertical layout used for composed widgets. | Persisted in local storage. | View switches. |
| RE-8 | Reject/sent-back banner | Read-only | Shows the pathologist's rejection reason when the test is re_entry. | — | — |
| RE-9 | Numeric field | Number/text input (decimal keyboard) | Enters a numeric value; Enter advances to the next field. | Flagged live: Low / High / Normal vs the patient-specific reference band, or "Critical · below/above" vs critical bounds. | Inline flag pill shows tone; critical tints the row. |
| RE-10 | Dropdown / radio / yes-no / yes-no-N/A | Select or chips | Single-choice value. | — | Stored. |
| RE-11 | Chips-multi | Multi-select chips | Toggles options in/out of an array. | — | Stored as array. |
| RE-12 | Button-select | Button group | Single choice (also used for duration-period morning/afternoon/etc.). | — | Stored. |
| RE-13 | Toggle / checkbox | Switch/checkbox | Boolean; label reads On/Off or Yes/No. | Counts as filled only when a boolean is set. | Stored. |
| RE-14 | Date / time / datetime | Native pickers | Temporal value. | — | Stored. |
| RE-15 | Phone / email | Typed inputs | Contact-style value (appropriate mobile keyboard). | — | Stored. |
| RE-16 | Duration (value + unit) | Number + unit select | Compound value+unit; units long-form or short-form by field type. | Filled when value is a number. | Stored. |
| RE-17 | Size (up to 5 boxes + unit) | Number boxes + unit select | Compound values+unit. | Box count from field config (1–5, default 2); filled when any box has a number. | Stored. |
| RE-18 | Measure (slider) | Range slider | Value+unit; bounds from field config (default 0–100 step 1). | — | Live readout beside slider. |
| RE-19 | Image-select | Tile buttons | Single-choice from labelled tiles. | — | Stored. |
| RE-20 | Voice-text | Textarea + mic | Dictates into a textarea via browser speech recognition (en-IN). | Mic hidden when the browser has no speech API. | Recognised text appended; mic toggles capture. |
| RE-21 | File upload | File input | Attaches a single file. | Replace/clear supported. | Filename shown; clear removes it. |
| RE-22 | Image gallery | Multi-file input | Adds multiple images as thumbnails. | Accepts images; each thumb removable. | Thumbnails shown. |
| RE-23 | Canvas (signature / scribble) | Drawing pad | Free-hand capture persisted as an image on pointer-up; Clear wipes it. | Dimensions/stroke from field config. | Bitmap stored/restored. |
| RE-24 | Stub (Tier-3 widgets) | Read-only tile | "Preview only — interactive editor coming later". | These don't block submit. | — |
| RE-25 | Inline validation error | Read-only | Shows the first failing validator message under a field. | Runs the field validator when the new-format schema exists; drives RE-5's disabled state. | Red error text under the field. |
| RE-26 | Notes | Text input | Free note "visible to the validating pathologist". | Optional. | Stored with the result. |
| RE-27 | Right-rail helper (numpad / options / yes-no / keyboard hint) | Contextual panel | Mirrors the active field's input surface; numpad drives numeric fields. | Rail kind derived from the active field; idle types hide the pad. | Value writes back to the field. |
| RE-28 | Next empty | Button | Jumps focus to the next empty numeric field (wraps). | **Disabled when no empty field remains.** | Focus + active field move. |
| RE-29 | Clear (rail) | Button | Clears the active field's value. | **Disabled when no active field.** | Value cleared. |
| RE-30 | Mobile rail FAB | Toggle button | Opens/closes the rail as a bottom drawer on smaller screens; icon adapts to field kind. | Mobile/tablet only. | Drawer + backdrop toggle. |
| RE-31 | Patient + TAT strip | Read-only | Patient name/sex/age/dept, TAT budget, live remaining, colour-coded track. | Tone = TAT level (urgent/high/normal). | — |

**Flows**
1. **Re-scan gate:** The screen is locked behind a barcode scan unless the user arrived directly from a fresh claim-by-scan. On any revisit/reload/deep link, a "Scan vial to open result entry" modal blocks editing until the tube's exact barcode is scanned; **Cancel bounces back to the queue** (no peeking at half-entered results without the vial in hand).
2. **Live reference flagging:** Numeric values are flagged against the reference band selected for the patient's sex/age (not just the first band), and against critical bounds — the same selection the backend uses, so the preview matches the persisted flag.
3. **Enter-key navigation:** Pressing Enter in a numeric/text field advances to the next numeric-or-text field (wraps around).

### 6.4 Culture & Sensitivity Entry (embedded in 6.2 / 6.3 for microbiology tests)

**Purpose:** Structured microbiology result — specimen, gram stain, colony count, organism(s) each with an antibiotic-sensitivity (S/I/R, optional zone) table, plus resistance/clinical notes.
**Who sees it:** Same as the hosting result-entry screen (culture-format tests only).

| ID | Control (label) | Type | What it does | Rules / validation | Result (success / failure) |
|---|---|---|---|---|---|
| CUL-1 | Specimen | Text input | e.g. "Urine"; also drives the default antibiotic panel per specimen. | — | Stored. |
| CUL-2 | Colony count | Text input | e.g. "1,00,000 cfu/ml". | — | Stored. |
| CUL-3 | No growth | Checkbox | Marks the culture as no growth; hides the organism section. | When on, the result is "ready to submit" with no organisms. | Organism section hidden. |
| CUL-4 | Gram stain | Textarea | Microscopy description. | — | Stored. |
| CUL-5 | + Add organism | Button | Adds an organism row pre-seeded with the specimen's antibiotic panel. | Only when not "no growth". | New organism card appears. |
| CUL-6 | Organism name | Text input + autocomplete | Names the organism (autocomplete from common organisms). | Changing the name re-runs auto-interpretation for its non-manual rows. | Group re-derived; S/I/R may update. |
| CUL-7 | + Add antibiotic | Button | Adds a blank antibiotic row to the organism. | — | New row. |
| CUL-8 | Measure (camera plate) | Button | Opens the plate-measure dialog to photograph the plate and measure zones on-screen. | — | Plate dialog opens (6.5). |
| CUL-9 | Remove organism (trash) | Button | Deletes the organism; collapses the section if none remain. | — | Organism removed. |
| CUL-10 | Antibiotic name | Text input | Names the drug. | Changing it re-runs auto-interpretation. | Stored. |
| CUL-11 | Zone (mm) | Number input | Inhibition zone in mm. | Auto-interprets to S/I/R against the CLSI breakpoint for the organism group + drug, unless manually overridden; tooltip shows "CLSI: S ≥ x mm, R ≤ y mm" or "No CLSI breakpoint — enter S/I/R manually". | S/I/R may auto-set. |
| CUL-12 | S / I / R buttons | Toggle group | Manually sets interpretation. | **Manual selection locks the row** — auto-interpretation never overwrites it afterward. | Selected button colours (S green, I amber, R red); "auto" tag disappears. |
| CUL-13 | "auto" tag | Indicator | Marks an interpretation still driven by the zone (not manually overridden). | Shown only when not manual and an interpretation exists. | — |
| CUL-14 | Remove antibiotic (×) | Button | Deletes the antibiotic row. | Clears its manual-lock flag. | Row removed. |
| CUL-15 | Resistance pattern / Intrinsic resistance / Clinical notes / Infection control advice | Textareas | Free-text microbiology notes. | — | Stored. |
| CUL-16 | Plate photo thumbnail | Link/image | Opens the captured plate image in a new tab. | Shown when a plate image exists. | — |

**Flow:** Readiness to submit = "No growth" ticked, or at least one named organism. Breakpoints load from the server on init; offline → manual S/I/R only.

### 6.5 Plate Measure Dialog (opened from Culture "Measure")

**Purpose:** Capture a plate photo, calibrate the dish diameter, and measure inhibition zones on-screen, mapping each to an antibiotic row.
**Who sees it:** Same as Culture entry.

| ID | Control (label) | Type | What it does | Rules / validation | Result (success / failure) |
|---|---|---|---|---|---|
| PLM-1 | Full screen / Exit full screen | Icon button | Toggles fullscreen dialog. | — | Layout expands. |
| PLM-2 | Close (×) / backdrop | Button | Cancels the dialog (stops camera). | — | Dialog closes, no measurements applied. |
| PLM-3 | Capture / Take photo / Open camera | Buttons | Grabs a frame from the live camera (native "Take photo" vs web "Open camera"/"Capture"). | Native vs browser path chosen by platform. | Still image loaded for measuring. |
| PLM-4 | Choose file / gallery | File input | Loads an existing plate image (png/jpeg/webp). | — | Image loaded. |
| PLM-5 | Pan / Zoom in / Zoom out / Fit | Tool buttons | Navigate the image. | — | View transforms. |
| PLM-6 | Undo / Redo | Buttons | Step through zone edits. | **Disabled when no history / no future.** | Zone list changes. |
| PLM-7 | Clear all (trash) | Button | Removes all drawn zones. | **Disabled when no zones.** | Zones cleared. |
| PLM-8 | Got it (hint) | Button | Dismisses the how-to hint card. | — | Hint closes. |
| PLM-9 | Search antibiotics | Text input | Filters the antibiotic assignment list. | — | List filters. |
| PLM-10 | Unassign (×) | Button | Detaches a zone from an antibiotic. | — | Zone freed. |
| PLM-11 | Dish diameter (mm) | Number input | Calibration reference. | Defaults to 90 if cleared. | Scale set. |
| PLM-12 | Re-tap rim | Button | Restarts rim calibration. | — | Calibration reset. |
| PLM-13 | Measure → | Button | Advances from calibrate to measure mode. | **Disabled until calibrated.** | Mode switches. |
| PLM-14 | Auto-detect dish + zones (✨) | Button | Runs automatic detection. | **Disabled while analysing**; label shows "Analyzing…". | Zones/dish auto-populated. |
| PLM-15 | ← Recalibrate | Button | Returns to calibrate mode to re-set the dish rim (keeps the current photo and drawn zones). | Always enabled in measure mode. | Mode switches back to calibrate; the rim/scale can be re-tapped (PLM-12). |
| PLM-16 | Retake | Button | Discards the current photo and returns to capture mode to shoot/upload a new one. | Always enabled in measure mode. | Photo, calibration points, all drawn zones and the undo/redo history are cleared; on web the camera restarts. |
| PLM-17 | Re-detect (✨) | Button | Re-runs automatic dish + zone detection on the current photo. | **Disabled while analysing** (shares the "Analyzing…" busy state with PLM-14). | Zones/dish are re-populated from detection (replacing the current auto set). |
| PLM-18 | Smart-fill (⚡) | Button | Auto-maps every still-unassigned zone to an antibiotic row by reading the plate top-to-bottom, left-to-right against the order's drug list. | **Disabled when nothing is unassigned.** | Unassigned zones receive proposed antibiotic assignments; toast "Proposed a mapping — check each and adjust." (existing manual assignments are left untouched). |
| PLM-19 | Apply N zones | Primary button | Applies measured zones back to the organism's antibiotic rows and keeps the plate photo. | **Disabled while busy or when 0 zones assigned.** | Each zone drops into its antibiotic row (firing CLSI auto-interpretation); dialog closes. |

**Flows**
1. **Calibrate → measure → apply (happy path):** Culture "Measure" (CUL-8) opens the dialog → capture a frame (PLM-3) or choose a file (PLM-4) → tap the dish rim, set/confirm Dish diameter (PLM-11) → **Measure →** enables once calibrated (PLM-13) → draw or **Auto-detect** zones (PLM-14) → assign each zone to an antibiotic (or **Smart-fill**, PLM-18) → **Apply N zones** (PLM-19) → each zone's mm value drops into its antibiotic row and auto-interprets S/I/R via CLSI; the dialog closes keeping the plate photo (CUL-16 thumbnail appears).
2. **Recalibrate without losing work:** in measure mode, **← Recalibrate** (PLM-15) returns to calibrate mode; re-tap the rim (PLM-12) → **Measure →** again — drawn zones are preserved.
3. **Retake:** **Retake** (PLM-16) discards the photo, calibration, zones and history and returns to capture; nothing is applied to the antibiotic rows.
4. **Cancel:** **×** or backdrop (PLM-2) — or **Full screen** toggling aside — closes the dialog with no measurements applied and the camera stopped; the organism's existing antibiotic rows are unchanged.

### 6.6 Delegate Modal (opened from My Work Delegate)

**Purpose:** Supervisor hands a tube's tests to another lab tech.
**Who sees it:** Triggered by users with `reassign_result` (or from the My-Work default tab); backend enforces the permission.

| ID | Control (label) | Type | What it does | Rules / validation | Result (success / failure) |
|---|---|---|---|---|---|
| DEL-1 | Search by name or email | Text input | Filters the active-user list. | Matches name or email, case-insensitive. | List filters live. |
| DEL-2 | User row | Button | Chooses that user as the delegate. | Only active users listed. | Emits the pick → parent delegates every writable test on the tube. |
| DEL-3 | Close (×) / backdrop | Button | Dismisses without delegating. | — | Modal closes. |
| DEL-4 | Empty / loading state | Read-only | Loading logo while users load, then "No matching user" when the filter matches nothing. | — | — |

**Flow:** On pick, the parent posts a delegate call per test; the new assignee "must scan the vial before entering results." Result toasts as in 6.1 flow 3.

### 6.7 Comment Thread (shared; used in result entry and validation)

**Purpose:** Bidirectional validator↔tech conversation, overall or per-parameter; the correction channel that drives re-entry focus.
**Who sees it:** Techs (in result entry) and validators (in validate); role is passed in as tech or validator.

| ID | Control (label) | Type | What it does | Rules / validation | Result (success / failure) |
|---|---|---|---|---|---|
| CMT-1 | + Add Overall Observation / Correction (or custom compose label) | Button | Opens the composer. | Label depends on role: validator → "…Correction", tech → "…Observation". | Composer textarea opens and focuses. |
| CMT-2 | Composer textarea | Textarea | Types the message; role-specific placeholder. | The draft is **trimmed** before posting (leading/trailing whitespace dropped) and a whitespace-only draft leaves CMT-3 disabled. **No character cap in the UI** — unlike the chat composer (CMP/PPL-8, 4000 chars), this thread composer is uncapped by design; any server-side limit governs. | Feeds CMT-3 (post) / CMT-6 (send reply). |
| CMT-3 | Post observation / Post correction | Primary button | Submits a new root comment. | **Disabled while the trimmed draft is empty**; type = correction for validator, observation for tech. | Comment posts; thread reloads. |
| CMT-4 | Cancel | Button | Discards the composer. | — | Composer closes. |
| CMT-5 | Reply | Button | Opens a reply box on a thread. | Only on unresolved threads when compose is enabled. | Reply box opens and focuses. |
| CMT-6 | Send reply | Primary button | Posts a reply. | **Disabled while the trimmed reply is empty.** | Reply posts; thread reloads. |
| CMT-7 | "Awaiting your reply" banner | Indicator | Pulses when the last message is from the other role and the thread is unresolved. | Auto-computed. | — |
| CMT-8 | Type / role / resolved pills | Read-only | Show Observation vs Correction, author role, and "✓ Resolved". | Resolved threads are dimmed and can't be replied to. | — |

**Flow:** Threads colour-code by origin (blue observation = tech-raised, red correction = validator-raised, green = resolved). On result submit, the backend auto-resolves correction threads, and the hosting screen reloads comments to reflect it.

### 6.8 Pending Validation Queue (`/pathologist`)

**Purpose:** The pathologist's worklist of entered results awaiting sign-off, grouped by patient/order and bucketed by TAT urgency.
**Who sees it:** Users with `validate_result`, when the validate workflow action is enabled.

| ID | Control (label) | Type | What it does | Rules / validation | Result (success / failure) |
|---|---|---|---|---|---|
| PV-1 | My queue / All pathologists | Segmented tabs | Switches between results assigned to me vs all pathologists. | Default = "All pathologists". **Assignment rule (QC fixture note):** results are NOT assigned to a pathologist when the tech submits them — a test's assignee is whoever last received it via delegation/auto-assign (a lab tech) or via VR-18 Reassign. "My queue" therefore shows only tests whose assignee is the signed-in user, and for a pathologist it is **empty until another validator reassigns a test to them** (VR-18) — an empty My queue with a populated All-pathologists tab is correct behavior, not a defect. | Re-fetches the validation queue with the matching scope. |
| PV-2 | Refresh | Button | Reloads the queue. | Icon-only on phone. | Rows + counts reload. |
| PV-3 | KPI strip | Read-only | Shows the KPI tiles an admin assigned to the **Pathologist** screen in KPI configuration (section 11.10 — candidate metrics include Pending validation, Validated today, TAT breaches). Shared strip behavior is specified in 11.10. | Hidden entirely when no KPIs are assigned/enabled for this screen (the default for a fresh tenant) or the fetch fails. | Informational only. |
| PV-4 | Urgency buckets (Urgent / High / Within TAT) | Grouped sections | Group rows by TAT level; Urgent = past TAT, High = ≤60 min left, Within TAT = rest. | Order's level = most-urgent of its tests. | — |
| PV-5 | Patient/order card | Button | Opens the validation screen for the order's **first** pending test (one tap, no expand step). | Card shows a CRITICAL chip when any test's snapshot is critical; test count badge; TAT indicator. | Navigates to Validate Result. |
| PV-6 | Empty state | Read-only | "Nothing pending. Everything is validated." | Shown when the queue is empty. | — |

**Notes:** The queue is defensively filtered to only `entered` rows client-side, so already-validated or re-entry rows never surface here even if the backend leaks them. (The template contains latent per-row Reject/Reassign handlers with reason/id prompts, but the rendered card routes straight to the Validate screen where those actions live.)

**Flow:** Tapping a card opens the first pending test; after each validate/reject the pathologist returns here and the next test of a multi-test order is one tap away.

### 6.9 Validate Result (`/pathologist/validate/:id`)

**Purpose:** Review one entered result in depth (values vs reference ranges, flags, conversation), then validate, reject (send back), reassign, or edit values in place.
**Who sees it:** Users with `validate_result`.

| ID | Control (label) | Type | What it does | Rules / validation | Result (success / failure) |
|---|---|---|---|---|---|
| VR-1 | Back | Button | Returns to the pending-validation queue. | — | Navigates. |
| VR-2 | Patient/context strip | Read-only | Patient name/sex/age/dept, "entered" timestamp; CRITICAL chip when the snapshot is critical. | — | — |
| VR-3 | Sent-back banner | Read-only | Repeats the earlier rejection reason for a re-entered result. | Shown when a rejection reason exists. | — |
| VR-4 | Overall conversation | Embedded thread | Validator↔tech overall thread (6.7), current role = validator. | — | Add/reply posts corrections. |
| VR-5 | Culture review (read-only) | Panel | For culture tests, renders specimen / gram / colony / organisms with zone + S/I/R interpretation, plus notes. | Rendered when the test is culture-format; **no in-place edit** (must reject for re-entry). | — |
| VR-6 | Summary strip (Parameters / Normal / Abnormal / Critical) | Read-only counts | Counts params by flag. | Flags computed from snapshot values vs reference/critical bounds. | — |
| VR-7 | Cards / Table view toggle | Segmented (2) | Switches the parameter presentation. | — | View switches. |
| VR-8 | Parameter card (Cards view) | Button | Opens the parameter detail drawer with a range-bar visualisation. | — | Detail drawer opens. |
| VR-9 | Parameter row (Table view) | Button | Toggles the per-parameter comment thread for that row. | 💬 marker shown when an open comment exists. | Row's thread expands (one at a time). |
| VR-10 | Range bar + pin | Read-only viz | Shows critical-low/low/normal/high/critical-high zones with the value pinned. | Only for numeric params with a range or critical bound. | — |
| VR-11 | Per-parameter comment thread | Embedded thread | Comment on a single parameter. | — | Add/reply posts. |
| VR-12 | Detail drawer | Dialog | Shows the big value, range bar with ticks, reference/critical/units, and a "Why flagged" explanation. | Explanation only when the flag isn't normal. | Close via ✕ or backdrop. |
| VR-13 | Clinical comment | Textarea | Optional note attached to the validate/edit/reject action. | Optional. | Sent as the note on validate/reject/save. |
| VR-14 | Edit values | Button | Enters in-place edit mode, seeding editable fields from the snapshot. | **Hidden for culture tests** (structured object — editing flat fields would corrupt it; reject for re-entry instead). | Edit toolbar appears; toast "Edit mode — click a parameter to change". |
| VR-15 | Cancel (edit mode) | Button | Discards edits. | — | Leaves edit mode. |
| VR-16 | Save changes (edit mode) | Primary button | Re-posts edited values through the result-entry engine (numeric strings coerced to numbers, blanks → null). | **Disabled while saving.** | Success toast "Values updated" (or "Saved — flagged critical"), stays on screen with refreshed values. Failure shows the error. |
| VR-17 | Reject | Button | Sends the result back to the lab tech via a required-reason prompt. | **Prompt reason required** (multiline, danger); attaches the clinical comment as note. | On confirm toast "Rejected — lab tech notified", returns to queue. Cancel = no-op. Failure "Reject failed". |
| VR-18 | Reassign | Button | Moves the test to another pathologist's queue by setting its assignee. Opens a required-input prompt titled "Reassign to pathologist" (message names the test; placeholder "Pathologist user id"; confirm label "Reassign"). | **Prompt requires a non-empty value; the accepted identifier is the target user's GUID id** (the internal user id, not a username or email — a picker is a future enhancement, so QC must supply a real user GUID from the Users screen/API). Cancelling or an empty prompt is a no-op. | On confirm the test's assignee is set (it then appears in that user's PV-1 "My queue"); toast "Reassigned", returns to queue. A malformed or unknown id, or one for a user who cannot validate, is rejected server-side → the server's message toast, or "Reassign failed" as fallback; nothing is reassigned. |
| VR-19 | Validate / Validate · notify | Primary button | Signs off the result. | **Disabled while saving, or (non-culture) when there are no value rows**; label + danger styling switch to "Validate · notify" when any parameter is critical (validation will notify the referring doctor). | Success toast "Validated", returns to queue. Failure "Validation failed". |

**Flows**
1. **Load:** The screen fetches the full "all pathologists" validation queue and finds the matching test by id; if absent it shows "Order test not found in the validation queue."
2. **Edit-in-place (amendment before sign-off):** Edit values → change fields → Save changes re-runs the enter/critical engine and refreshes the flags without leaving validation. Culture results cannot be edited here — the validator rejects them so the structured tech screen reopens.
3. **Critical sign-off:** When any parameter is critical, the action bar reads "Critical · validation will notify referring doctor" and the Validate button turns danger-styled ("Validate · notify"), making the downstream notification explicit before the click.

**Cross-screen notes for QC**
- **Status vocabulary** governs button visibility everywhere: `pending` → not started; `in_progress` → draft saved; `entered` → submitted, awaiting validation (reopenable by tech, editable by validator); `re_entry` → rejected/sent back; `validated` → signed off (locked). A control appearing on a wrong status is a defect.
- **Reference/critical flagging** is computed client-side to preview the backend's decision; the entry screens pick the reference band by the patient's sex/age, and critical bounds override normal-range banding.
- **Amendment paths in this area** are exactly: tech reopen/undo-submit (SRE-5), validator Edit values + Save (VR-14/VR-16), reject→re-entry (RE-3, VR-17), and delegate/reassign (MW-21/MW-23, VR-18). A truly released report's "amended" re-issue is out of scope for these screens.

---

## 7. Reports

**Shared concepts:**
- **Delivery status** on a report is one of: `pending` (shown to users as **"Completed"** — lab work done, report awaits handover), `delivered`, `failed`. Colour convention everywhere: Completed = amber, Delivered = green, Failed = red.
- **Public report link**: every generated report can carry a QR token. The tokenised public link is what patients receive by WhatsApp/QR. It never requires staff login — only a DOB/phone confirmation.
- **WhatsApp delivery** does not attach the PDF. It opens WhatsApp with a pre-filled message containing the public report link. The PDF is rendered and archived to storage in the background at send time so the link resolves to a real file.
- **Phone numbers for WhatsApp**: a bare 10-digit number is treated as Indian and gets a 91 prefix; a leading 0 on an 11-digit number is replaced by 91; anything else is used as-is (digits only). If the patient has no usable phone, WhatsApp opens with the message but **no recipient** — the staff member picks a contact manually.

### 7.1 Report Queue (`/reports`)

**Purpose:** The delivery worklist — validated orders whose reports are ready to hand over to patients/doctors, plus in-progress orders eligible for a preliminary (partial) report.
**Who sees it:** Only users with **deliver_report**, and only when the "results" workflow stage is enabled. Users without access are blocked at the route.

**On load (automatic):** The screen first asks the server to back-fill any missing report records for already-validated orders (silent, failures ignored), then loads the queue and today's orders (for the Partial tab). While loading with no data yet, 4 grey skeleton rows show.

| ID | Control (label) | Type | What it does | Rules / validation | Result (success / failure) |
|---|---|---|---|---|---|
| RQ-1 | KPI strip | Display widget | Shows the KPI tiles an admin assigned to the **Report queue** screen in KPI configuration (section 11.10 — candidate metrics include Ready to deliver, Delivered today). Shared strip behavior is specified in 11.10. | Hidden entirely when no KPIs are assigned/enabled for this screen (the default for a fresh tenant) or the fetch fails. | Display only. |
| RQ-2 | Refresh | Button (header, secondary) | Re-fetches the queue and today's orders. | Always enabled. On phones ≤640px the label is hidden (icon-only, still announced to screen readers). | List and counters update. Failure: loading spinner stops silently, existing rows stay; no toast. |
| RQ-3 | Queue stats icon (phone only, ≤640px) | Icon button + popover | Toggles a small popover listing Total / Completed / Partial / Delivered / Failed counts. | Only visible on phone widths. Tapping the backdrop also closes it. | Popover opens/closes; informational. |
| RQ-4 | Generate | Button (header, primary) | Opens a themed prompt dialog: title "Generate report", message "Enter the order ID to generate a final report", placeholder "order id", buttons **Generate** / Cancel. | Input required — dialog cannot confirm empty. Cancelling does nothing. | Success: toast **"Report generated"** and navigation to the Report viewer for the new report. Failure: red toast with the server error (or "Generation failed"). |
| RQ-5 | Stats bar (desktop) | Display | Segmented strip: Total (all rows), Completed (pending-delivery count), Partial (partial-eligible order count), Delivered, Failed. | Hidden on phones (replaced by RQ-3). Counts recompute live as data/filter change. | Display only. |
| RQ-6 | Search box | Text input | Free-text filter, placeholder "Search by patient, MRN, phone, or order/report id…". | Case-insensitive substring match against patient name, phone, MRN, order ID and report ID. Applies on every keystroke; combined (AND) with the active status filter. No length limit. | Matching rows shown instantly; no matches → "Queue is empty." empty state. |
| RQ-7 | Clear search (×) | Icon button | Empties the search box. | Only visible while the search box has text. | Full (filtered-by-status) list restored. |
| RQ-8 | Status filter | Segmented pills: **All / Completed / Partial / Delivered / Failed** | Filters the list by delivery status. **Default on entry is "Completed"** (not All). | "Completed" maps to reports awaiting delivery. "Partial" switches the body to the partial-orders view (RQ-10…13) instead of the report list. | List re-renders. Empty state per tab (see flows). |
| RQ-9 | Filter icons (phone only) | 5 icon buttons | Same five filters as RQ-8, icon-only; active one highlighted violet; the active category's name written out under the row. | Drives the identical filter state as RQ-8. | Same as RQ-8. |
| RQ-10 | Partial order card header | Expand/collapse button (whole card head) | Expands one order card inline to show its validated results; collapsing chevron rotates. | Only one card open at a time (opening another collapses the first; tapping the open one closes it). Card shows patient name, order short-ID + creation time, and a "N/M depts" badge. | Body reveals per-department result values. |
| RQ-11 | Result rows inside a partial card | Display | Each validated department lists its tests and parameter values with unit, reference range, and a flag chip: **✓ Normal / ⚑ Abnormal / ⚠ Critical**. | Flags computed from the test's configured limits: at/beyond critical low/high ⇒ Critical; outside the first reference range ⇒ Abnormal; non-numeric values are never flagged. Tests with no values show "No parameter values recorded." | Display only. |
| RQ-12 | "Still pending" line | Display | Amber note inside an expanded card listing the department codes not yet validated. | Shown only when the order still has pending departments (always true on this tab by definition). | Display only. |
| RQ-13 | Generate partial PDF | Button (inside expanded card, primary) | Requests a preliminary report covering only the fully validated departments of that order. | Disabled ("Generating…") while that card's request is in flight; clicks on any other card's button are also ignored until it finishes (one generation at a time). A newer partial report supersedes the previous one. | Success: toast **"Partial PDF generated"** and navigation to the Report viewer. Server returns no report: amber toast "Could not generate — check that all selected tubes are validated." Error: red toast with the server message (or "Could not generate the partial PDF"). |
| RQ-14 | Report row | Display card | One card per generated report: status-coloured icon + left accent strip, patient name (or "Report #<8-char id>" if patient unknown), status chip (Completed/Delivered/Failed), meta line "Order #<8-char> · <type> · generated <date/time> · <phone>". On phones the meta line is replaced by a "Sex · Age" subline and the chip is hidden (accent strip carries status). | Rows come from the queue for the branch; ordering as returned by the server. | Display only; actions RQ-15…18 sit on the row. |
| RQ-15 | Download | Row action button | Renders the report PDF **in the browser** (same layouts, colours and template chrome as the viewer/print) and downloads it. On the native app, downloads don't work in the web view, so the native **share sheet** opens instead (Save to Files, AirDrop, Print…). In both cases the rendered PDF is also archived to server storage in the background so the patient's public link serves the exact same file. | Always enabled. Cancelling the native share sheet is not an error. Archiving failures are silent and never block the download. | Success: PDF file saved (named `report-<8-char id>.pdf` on native). Failure: red toast **"Could not download report"**. |
| RQ-16 | View | Row action button | Navigates to the Report viewer for that report. | Always enabled. | Viewer opens. |
| RQ-17 | WhatsApp | Row action button (green accent) | 1) If the report has a QR token, renders + archives the PDF in the background; 2) opens WhatsApp in a new tab/app pre-filled with the patient's number and a message: greeting with patient name, "Your lab report from <lab name> is ready.", the public report link (when a token exists), and "Please contact us if you have any questions."; 3) records the delivery on the server. | If the patient's phone is missing/invalid, WhatsApp opens without a recipient. No toast on success (the opened WhatsApp window is the feedback); if recording the delivery fails it is silent. | Report's status becomes **Delivered** and the list refreshes (row moves out of the Completed tab). WhatsApp window/app opens with the pre-filled message. |
| RQ-18 | Print | Row action button | **Native app:** renders the PDF and opens the native share sheet titled "Print report" (user picks Print / Save). **Web/desktop:** no print dialog opens from this row — the click only records the delivery. Either way the delivery is recorded as printed. | Cancelling the native sheet is silent. (To actually print from the web, staff use View → Print in the viewer.) | Success: toast **"Delivered via print"**, status becomes Delivered, list refreshes. Native render failure: red toast "Could not open report" (delivery is still recorded). |

**Empty states:** Partial tab — "No partial reports right now. They show up here as soon as one department finishes validation." Every other tab — "Queue is empty."

**Which orders appear on the Partial tab:** today's orders where **at least one but not all** (non-rejected) departments have every test validated. Orders that are fully validated leave this tab (they flow through the normal report list instead).

**Flows**
1. Land on the page → back-fill runs silently → queue loads → the **Completed** tab is pre-selected showing reports awaiting delivery.
2. Type part of a patient name/phone/MRN/order-id in search → list narrows live within the active tab → click × → full tab restored.
3. Click **Generate** → prompt dialog → paste an order ID → **Generate** → toast "Report generated" → land in the viewer for it. Wrong/unknown ID → red error toast, stay on the queue.
4. Open the **Partial** tab → expand a patient card → verify the validated department's values and flags → **Generate partial PDF** → "Generating…" → toast "Partial PDF generated" → viewer opens showing the PRELIMINARY banner.
5. On a Completed row, click **WhatsApp** → WhatsApp opens in a new tab with number + message containing the public link → back in the app the row has moved to **Delivered**.
6. On a Completed row, click **Print** (web) → toast "Delivered via print" → row moves to Delivered — note no browser print dialog appears from the queue row.
7. Click **Download** → a PDF matching the on-screen report downloads; simultaneously the same PDF is archived server-side so the patient link works later.

### 7.2 Report Viewer (`/reports/view/<report id>`)

**Purpose:** Full-fidelity on-screen preview of one report (identical structure to the PDF), with print, colleague-share and WhatsApp delivery actions.
**Who sees it:** Users with **deliver_report** *or* **validate_result** (delivery staff, pathologists, admins).

**On load (automatic):** Fetches the report by the ID in the URL, the tenant's report template (branding/toggles), and — per test — the resolved report layout for the actual entered values. If the URL has no ID the user is bounced back to the queue. While loading, an animated logo with "Loading report…" shows. If the report fetch fails: red toast **"Could not load report"** and the loading panel remains.

| ID | Control (label) | Type | What it does | Rules / validation | Result (success / failure) |
|---|---|---|---|---|---|
| RV-1 | Print | Header button (secondary) | Opens the **browser print dialog**. Print styling strips the app shell entirely — only the white report "paper" prints, paginating across pages. | Only visible once the report has loaded. On phones the header buttons collapse to icon-only squares. | Browser/OS print dialog; outcome up to the user. (This action does **not** change delivery status.) |
| RV-2 | Share with… | Header button (secondary) | Opens the "Share this report" colleague picker (RV-4…6). | **Only rendered when the Messages module is enabled** for the tenant. | Modal (bottom sheet on phones) opens. |
| RV-3 | Send WhatsApp | Header button (primary) | Same WhatsApp delivery as the queue row: archives the PDF in the background (when a QR token exists), opens WhatsApp pre-filled with patient phone + message + public link, records the delivery. | Lab name in the message comes from the report template; missing phone → WhatsApp contact picker. | Toast **"Opened WhatsApp with the report link"** (shown even if recording the delivery fails); the report's delivery status becomes Delivered server-side. |
| RV-4 | Share dialog — search | Text input (autofocused) | Filters the colleague list by name or email, live. | List excludes yourself and deactivated users. Directory fetched on first open; fetch failure → red toast "Could not load directory." | Matching rows only; none → "No colleagues match." |
| RV-5 | Share dialog — colleague row | Button per person (avatar, name, email) | Sends the report as a tap-to-open card into a chat with that person. | All rows disable (dimmed, progress cursor) while a send is in flight. | Success: toast **"Sent to <name>"**, dialog closes, app navigates to **Messages**. Failure: red toast with the error. |
| RV-6 | Share dialog — close (✕ / backdrop) | Button / backdrop click | Dismisses the picker without sending. | Also resets the sending state. | Dialog closes; nothing sent. |
| RV-7 | Status strip | Display | Chips: report **type** (violet), **delivery status** (amber/green/red), a red **CRITICAL** chip if any test on the report carries a critical flag; plus "Generated <date time> · #<8-char id>". | — | Display only. |
| RV-8 | Preliminary banner | Display | On partial reports only: amber "PRELIMINARY REPORT" banner stating the shown departments are final and listing the still-pending departments. | Cannot be dismissed — always printed/shown on partials. | Display only. |
| RV-9 | Report paper | Display | Masthead (template logo or default mark, lab name, tagline, NABL badge + number when accredited); patient/order meta grid; one continuous results table (**Investigation / Result / Reference Range / Unit / Specimen**) with panel headers, method/"Tested at: <referral lab>" sub-lines, note rows, abnormal values bold (H/L/C/A letter or ↑/↓ arrow, optional red/blue colouring — all per template settings); a separate **"Tests not under NABL scope"** table when the lab is NABL-accredited and some tests are out of scope; narrative/image/chart/microbiology tests as their own blocks after the table; footer with disclaimer + signature line and QR code captioned "Scan to verify online" (links to the public report page); "Powered by Prefrontal". | Every meta field, the signature, QR, critical flag styling, date/time formats and colours obey the admin report-template toggles. Tests with a critical flag show a red CRITICAL chip on their panel row. Missing data renders as "—". | Empty states: "No tests on this report." (nothing at all), "No values recorded." (a test without values). |

**Flows**
1. From the queue click **View** → report loads → status strip confirms type + delivery state; a critical result anywhere shows the CRITICAL chip both in the strip and on the affected panel.
2. Click **Print** → only the white paper appears in print preview (no app chrome) → print → delivery status does **not** change (record delivery via WhatsApp or the queue's Print action).
3. Click **Send WhatsApp** → WhatsApp opens with the patient's number and the public link → toast "Opened WhatsApp with the report link" → back on the queue the report now reads Delivered.
4. Click **Share with…** → type a colleague's name → click them → rows grey out → toast "Sent to <name>" → you are taken to Messages where the report card sits in that conversation. (Button absent entirely when the Messages module is off.)
5. Open a **partial** report → amber PRELIMINARY banner lists pending departments above the masthead — it must also appear on the print.

### 7.3 Public Report Viewer (patient-facing, tokenised link, no login)

**Purpose:** Lets a patient open their finished report from the WhatsApp/QR link after proving identity with DOB or phone; must never route through the staff login.
**Who sees it:** Anyone holding the tokenised link (token is opaque; nothing is revealed before verification).

| ID | Control (label) | Type | What it does | Rules / validation | Result (success / failure) |
|---|---|---|---|---|---|
| PUB-1 | Identity input | Text input, placeholder "DOB (YYYY-MM-DD) or phone" | Collects the verification secret. Pressing **Enter** submits. | Autocomplete off. Client-side only requires non-blank; the format check (DOB match or phone match) is server-side. | See PUB-2. |
| PUB-2 | Open report | Button (full-width) | Sends the secret + token to the server for verification. | **Disabled** while the input is blank or a check is running (label "Checking…"). Repeat attempts allowed. | Success: card replaced by the PDF viewer (PUB-3/4). Wrong secret / server rejection: inline red message from the server, or "Could not verify. Check the details and try again." Network error: "Could not verify. Try again in a moment." |
| PUB-3 | Inline PDF frame | Embedded viewer | Shows the report PDF full-height. Source priority: (1) the archived PDF from storage; (2) if none archived, the report is rendered **in the patient's browser** from the stored snapshot — same renderer as staff use; (3) if neither is possible: inline error "Your report is verified but is not available yet. Please contact the lab." Render failure: "Your report is verified but could not be displayed. Please contact the lab." | Full-bleed on phones; pinch-zoomable. | Report visible. |
| PUB-4 | Open in new tab ↗ | Link (viewer top bar, next to the lab's name) | Opens the same PDF in a new browser tab (for saving/printing). | Only present after verification. | New tab with the PDF. |

**Flows**
1. Patient taps the WhatsApp link → dark branded card "View your report" → enters DOB `1990-04-12` (or their registered phone) → **Open report** → PDF fills the screen with the lab's name in the top bar.
2. Wrong DOB → inline red error under the input; the button re-enables for another try.
3. Report verified but staff never rendered/archived a PDF and no snapshot exists → "…not available yet. Please contact the lab."

### 7.4 Result Tracking (patient-facing, tokenised link from the invoice QR, no login)

**Purpose:** Lets a patient scan the invoice QR to follow their order through the lab, pay any balance via UPI, and open the report once ready.
**Who sees it:** Anyone with the tokenised tracking link. All patient data is hidden until DOB/phone verification.

| ID | Control (label) | Type | What it does | Rules / validation | Result (success / failure) |
|---|---|---|---|---|---|
| TRK-1 | Identity input | Text input, placeholder "DOB (YYYY-MM-DD) or phone" | Verification secret; **Enter** submits. | Non-blank required client-side; match checked server-side. | See TRK-2. |
| TRK-2 | View status | Button (full-width) | Verifies and reveals the status view. | Disabled while blank or checking ("Checking…"). | Success: card switches to the status view (TRK-3…7). Failure: inline error (server message, or the same generic wordings as PUB-2). |
| TRK-3 | Status timeline | Display | Ordered list of workflow stages for the order; completed stages get a gradient ✓ dot and white text, pending stages stay dim. | Stage names come from the tenant's workflow. | Display only. |
| TRK-4 | Rejected-sample banner | Display | Red line "A sample was rejected — please contact the lab for a recollection." | Shown only when the order has a rejected sample. | Display only. |
| TRK-5 | Pay ₹<amount> via UPI | Link-button | Opens the patient's UPI app pre-filled (payee VPA, payee name, amount, invoice reference) via a UPI deep link. | The whole payment block (amount-due header, button, QR, note) appears **only when** there is a balance due > 0 **and** the lab has configured a UPI VPA. | UPI app opens ready to pay. Payment confirmation is manual: the note reads "After paying, show the confirmation at the front desk — your report is released once the payment is verified." |
| TRK-6 | UPI QR image | Display | QR of the same UPI payment link, captioned "or scan with Google Pay / PhonePe / any UPI app" — for paying from a different device. | Generated on the page; if generation fails the QR is simply absent (TRK-5 still works). | Display only. |
| TRK-7 | View report | Link-button | Opens the finished report in a new tab — either the archived PDF directly, or the public report page (which then asks the same DOB/phone verification). | Shown **only when** the report is ready **and** a PDF URL or report token exists. Otherwise the card shows "Your report isn't ready yet. Scan again later." | New tab with the report. |

**Flows**
1. Patient scans the invoice QR → "Track your report" card → enters DOB/phone → **View status** → lab name, "Status for <patient>", and the stage timeline appear with completed stages ticked.
2. Order has an unpaid balance and the lab accepts UPI → an "Amount due ₹X" block appears → tapping **Pay via UPI** opens GPay/PhonePe pre-filled; alternatively the patient scans the on-page QR from another phone → after paying, the report is still released only once front-desk verifies the payment.
3. All stages done and the report generated → **View report** appears → opens the archived PDF, or the public report page which asks for DOB/phone once more.
4. Report not yet ready → "Your report isn't ready yet. Scan again later." — the patient can re-scan the same QR any time; the token stays valid.

**Cross-screen QC notes (Reports)**
- The queue's **"Completed"** label and the viewer's status chip **"pending"** describe the same underlying state (generated, awaiting delivery); the raw word "pending" may still surface in the viewer's status chip.
- Delivery status only changes through the **WhatsApp** and (queue) **Print** actions — viewing, downloading, browser-printing from the viewer, and colleague-sharing never mark a report Delivered.
- The PDF a patient sees via the public link is the file archived at the moment staff clicked Download/WhatsApp; if staff never triggered one, the patient's browser renders it from the snapshot instead — both must match the on-screen viewer.

---

## 8. Billing

Currency everywhere is INR (₹), whole rupees. "Order" = a saved set of tests for a patient; a **bill is created (or re-fetched) automatically from the order** the moment a billing screen loads — there is no manual "add line item" UI; line items always mirror the order's tests. Editing a bill's items is done by editing the order (Modify flow), which recomputes the bill server-side. Billing screens require the branch's workflow to include a "billing" step; otherwise the route is blocked. Billing configuration (GST, discount caps, invoice numbering, UPI, letterhead) is specified in the Admin chapter (section 11.9, BCF). The order screen's billing surfaces (cart discount, inline payment) are in section 4.1 (ORD/PAY), and the frontdesk landing's billing surfaces (payments-due drawer, Create Bill, View invoice, Cancel order) are in section 3.1 (FDL).

### 8.1 Collect Payment (`/frontdesk/billing?orderId=…`, legacy `/reception/billing` redirects here)

**Purpose:** Show the invoice for one order and collect (or defer, or refund) payment.
**Who sees it:** Users with `create_bill` OR `collect_payment`, at branches whose workflow includes billing. The same component also renders **embedded inside the order screen** (no page header; Back/Cancel return to the order screen instead of navigating).

**On load:** the order is fetched; a bill is created/re-fetched for the order (previously recorded payments/discounts reflected); a public result-tracking token, the invoice letterhead template, the tenant discount caps, and the test catalogue (for the TAT estimate) are fetched. If the URL has no order id: error toast "No order id" and redirect to the frontdesk landing. While the bill loads, a "Generating bill…" spinner shows. If bill creation fails: error toast "Could not create bill". A `discount` query parameter (carried from the order screen's cart) pre-fills the discount as a flat ₹ amount and **wins over any saved draft**.

| ID | Control (label) | Type | What it does | Rules / validation | Result (success / failure) |
|---|---|---|---|---|---|
| BILL-1 | Front desk collects payment | Header checkbox toggle | Tenant-frontdesk setting: when ON, saving an order routes straight into this screen; when OFF, a billing request is raised for the separate counter instead. | Always enabled; persisted locally (survives reload). | Instant; affects future order saves only, no toast. |
| BILL-2 | Save draft | Header pill button | Saves the in-progress inputs (payment mode, cash typed, discount + unit, reference no.) locally, keyed to this order, so reception can leave and resume. | Disabled when the bill hasn't loaded or payment is already taken. If already paid, clicking shows info toast "Already paid — nothing to save". Draft expires after 7 days. | Success toast "Saved as draft"; a "Discard" button appears. Failure toast "Could not save draft (storage full?)". |
| BILL-3 | Discard | Header pill button (ghost) | Deletes the saved draft for this order. | Visible only while a draft exists. | Info toast "Draft discarded"; button disappears. |
| BILL-4 | Cancel | Header pill button (ghost) | Leaves without collecting payment (order stays saved, bill stays open). | Always enabled. | Navigates to the frontdesk landing (embedded: closes the panel). |
| BILL-5 | Back | Header back chevron / button | Returns to the previous screen (typically the order, to add/remove tests). | Always enabled. | Browser-history back; falls back to the frontdesk landing if deep-linked. |
| BILL-6 | Print invoice (printer icon, invoice header) | Icon button | Generates the A4 invoice PDF client-side (letterhead, doc title "TAX INVOICE" if the bill carries tax or the template forces it, else "BILL OF SUPPLY"; items table; tracking + order QRs; cashier name) and opens the print dialog. On the native mobile app it opens the OS share sheet (Print / Save to Files / AirDrop) instead. | If the bill is still loading: warning toast "Bill is still loading". If the tracking QR can't be produced: warning toast "Invoice ready, but the tracking QR could not be generated." | Print dialog / share sheet opens; on any generation failure, error toast "Could not generate invoice PDF". |
| BILL-7 | Invoice number | Read-only text | Shows the server-allocated invoice number (admin-configured prefix + running counter); legacy bills fall back to "INV-" + last 8 chars of the bill id. | — | — |
| BILL-8 | Due amount | Read-only amount | Outstanding amount = (invoice total after discount) − (already paid). Never negative. | Recomputes live as the discount changes. | — |
| BILL-9 | Invoice barcode | Read-only barcode (Code128) | Encodes the invoice number; a counter can scan it to find the order (see CNTR-4/6). | Always shown. | — |
| BILL-10 | Patient Portal QR | Read-only QR | Encodes the public result-tracking link for the patient's phone. | Hidden if the tracking token wasn't minted or the admin letterhead setting "Show result-tracking QR" is off. | — |
| BILL-11 | Line items list | Read-only list | One row per test on the order: test name (truncated with full name on hover), HSN/SAC code beneath it when present, and the line total (price + tax). | Items are never editable here — change them by editing the order. | On wide screens items flow in two columns. |
| BILL-12 | Subtotal / GST rows | Read-only totals | Subtotal = sum of pre-tax prices. A separate "GST" row shows the total tax **only when the bill carries tax > 0** (GST-disabled tenants and exempt bills show no GST row). | — | — |
| BILL-13 | Discount unit toggle (₹ / %) | Two-button segmented switch | Chooses whether BILL-14 is a flat rupee amount or a percentage of (subtotal + GST). | Switching units **clears the entered value** (prevents ₹500 being re-read as 500%). | Total recomputes. |
| BILL-14 | Discount input | Numeric input | Enters the reception discount. Label shows "(max N%)" when the user's cap is below 100%. | Digits only — minus, plus, `e`, decimal point/comma blocked at the keystroke. Flat mode: clamped to subtotal+GST. Percent mode: clamped 0–100. Empty = no discount. Percent mode shows the resolved "−₹X" beside the field. **Cap by role:** `override_discount` → admin Level-2 cap; else `give_discount` → Level-1 cap; neither → 0%. Exceeding the cap turns the field red, shows "Discount N% exceeds your M% limit — reduce it to confirm.", and disables Confirm (it does NOT silently clamp). | Total and Due recompute live. The discount is only sent to the server (reason "Reception discount") when Confirm is pressed; if that call fails, error toast "Could not apply discount" and no payment is recorded. |
| BILL-15 | Total row | Read-only amount | Invoice total = subtotal + GST − discount (floor 0). | — | — |
| BILL-16 | Already paid / Balance due / Refund due rows | Read-only amounts | Shown only when some payment exists on the bill (e.g. reopened after an advance, or after an order edit). Shows amount already collected, then either "Balance due" (still owed) or "Refund due" (overpaid). | — | — |
| BILL-17 | Refund mode chips (Cash / UPI / Card) | Chip group | Picks how the overpayment will be handed back. | Panel appears **only when the patient has overpaid** (already paid > new total, e.g. a test removed after payment). Default Cash. | Selected chip highlights. |
| BILL-18 | Refund ₹X | Button (amber) | Records a refund of the full overpaid amount in the chosen mode (reason recorded as an order-modification refund). | Disabled while a refund is in flight ("Refunding…"); does nothing if refund due is 0. | Success: bill updates (refund panel disappears), toast "Refunded X". Failure: server error message toast or "Refund failed". |
| BILL-19 | TAT line ("≈ Nh / N days to report") | Read-only text | Estimated report turnaround = the slowest test on the bill. | Hidden until the test catalogue loads or if no TAT is known. | — |
| BILL-20 | Payment mode tiles: UPI · Card · Cash · Wallet · Split | Tile group (one selected) | Switches the right-hand panel. Default UPI. ("Pay later" is reachable only via draft restore on this standalone screen; it is a first-class tile on the order screen's inline panel, PAY-1.) | Selecting Wallet lazily loads the vendor list (once per session) plus the tenant flag controlling balance visibility. | Panel below swaps. |
| BILL-21 | UPI panel | Display only | Shows the due amount and a live UPI QR encoding a payment deep link with payee, invoice number, and amount prefilled, plus a "Listening for payment…" badge. | The badge is cosmetic — no automatic payment detection; the cashier confirms manually with BILL-31. | — |
| BILL-22 | Card panel | Display only | Shows the due amount, a mock card graphic, and a "Waiting for card…" spinner. | Cosmetic; no terminal integration — confirm manually. | — |
| BILL-23 | Cash received display | Read-only amount | Shows what has been keyed on the numpad; greyed when 0. | — | — |
| BILL-24 | Quick cash chips: Exact / +100 / +500 / +2000 | Buttons | "Exact" sets cash received = amount due; "+N" adds that note to the running amount. | — | Change indicator (BILL-25) updates. |
| BILL-25 | Change indicator | Status strip | 0 entered → "Enter the amount received · due ₹X" (neutral). Over → green "Return to patient ₹X". Equal → green "Exact — no change due". Under → red "Short by ₹X". | — | — |
| BILL-26 | Cash numpad | On-screen keypad (0–9, backspace) | Types the cash tendered; whole rupees only (no decimal key). | — | — |
| BILL-27 | Wallet vendor search | Text input | Filters the vendor-wallet list by name or code (case-insensitive substring). | Only **active** vendors listed; max 25 rows. States: "Loading vendors…"; "No vendors match "q"."; "No active vendors. Add one in Admin → Vendor wallets." | — |
| BILL-28 | Wallet vendor row | Button row | Selects that vendor for the charge. | Shows name, code pill, and balance (green; red when balance < amount due). **The balance column is hidden entirely** when the admin flag "front desk can see wallet balance" is off (default on). | Row collapses into a selected-vendor card. |
| BILL-29 | Selected vendor card + Change | Card with button | Shows the chosen vendor, its balance (subject to the visibility flag), a red "Insufficient — short by ₹X" warning when the balance can't cover the due amount, and a "Change" button that clears the selection. | With balances visible, an insufficient balance disables Confirm; with balances hidden, the server still rejects the charge. | — |
| BILL-30 | Split panel: Reference no. | Text input (free text) | Optional UTR / transaction id stored with the payment. | Optional; no format validation. | Sent with the payment record. |
| BILL-31 | Confirm payment · ₹X | Full-width primary button | Applies the discount (if any) then records the payment for the bill in the selected mode. Label variants: "Confirm payment · ₹X"; after success "Payment received · ₹X"; pay-later mode "Mark as pay-later · ₹X" or "Collect advance · ₹X". | Disabled while saving, after payment is taken (**permanently — cannot double-charge**), when the discount is over the user's cap, when mode = Cash and cash entered < amount due, or when mode = Wallet and no vendor is selected / visible balance is insufficient. Wallet: the vendor's credit is charged FIRST; if that fails (insufficient/inactive) nothing is recorded and reception can pick another mode. | Success: bill updates to paid, success toast ("Payment collected", or Wallet: "Charged ₹X to <vendor>"), draft cleared, landing-page counters refresh, and the **Payment received dialog (BILL-33…36) opens**. Failure: error toast with the server message ("Payment failed" / "Wallet charge failed" / "Could not apply discount"); nothing locks, retry allowed. |
| BILL-32 | Pay later panel (draft-restored mode): Advance payment input + tender chips Cash/UPI/Card | Numeric input + chips | Optionally collects a partial amount now; the rest stays outstanding and is collectible any time before report delivery. | Advance clamped 0…amount due; digits only. Hint: "Collect ₹A now · ₹R stays outstanding" or "No advance — the full ₹X is due on the report." | Confirm with no advance: **no payment recorded**; warning toast "Marked as Pay later — outstanding balance recorded"; the landing's payments-due drawer pops open. With an advance: discount applied then the advance recorded in the chosen tender; toast "Advance collected — ₹R stays outstanding (Pay later)" or "Payment collected in full"; dialog opens. |
| BILL-33 | Payment received dialog | Modal (bottom sheet on phones; inline card when embedded) | Confirmation with invoice number + amount, and three follow-up actions. | Opens automatically on any successful Confirm (including pay-later). | — |
| BILL-34 | Print invoice (dialog) | Button | Same as BILL-6. | — | Print dialog / share sheet. |
| BILL-35 | Send on WhatsApp | Button | Opens WhatsApp with a prefilled message: greeting with patient name, invoice number, paid total, TAT line, thank-you. Deep-links to the patient's number when known; otherwise opens the compose/paste-number variant. | Requires nothing; opens a new tab/app. | WhatsApp opens; nothing recorded in-app. |
| BILL-36 | Done (dialog primary) | Button | Finishes billing. | — | Closes dialog and navigates to the frontdesk landing (embedded: hands control back to the order screen, which resets for the next patient). |
| BILL-37 | Dialog backdrop click | Backdrop | Alternate close. | Only the standalone (non-embedded) dialog has a backdrop. | Closes the dialog and navigates to the **Post-payment screen** (tube-label printing) rather than stranding the user on a paid billing page. |

**Flows**
1. Normal collection: land from order save with the cart discount pre-filled → pick mode → Confirm → success toast → dialog → Print and/or WhatsApp → Done → back at the frontdesk landing.
2. Typing a discount above your cap → red field + inline "exceeds your limit" message → Confirm greys out → reduce the value → Confirm re-enables.
3. Toggling ₹→% clears the typed discount; typing 10 in % mode shows "−₹X" resolved beside the field and the Total drops accordingly.
4. Cash: patient hands ₹2000 for a ₹1450 bill → tap +2000 → green "Return to patient ₹550" → Confirm enables (it is disabled while the cash entered is short).
5. Wallet with insufficient balance (balances visible): balance shows red with "Insufficient — short by ₹X" and Confirm stays disabled; choose another vendor or mode.
6. Pay later with ₹500 advance: Confirm label reads "Collect advance · ₹500"; on success the remainder appears in the landing's payments-due drawer and in the Billing counter's "Due" list; reopening billing later shows "Already paid ₹500 / Balance due ₹R" and Confirm collects only the balance shown.
7. Refund after an order edit: a test was removed from a paid order → this screen shows "Refund due ₹X" and the amber refund panel → pick Cash/UPI/Card → "Refund ₹X" → toast "Refunded X" → panel disappears, bill balanced.
8. Save draft mid-way, navigate away, return to the same order within 7 days → info toast "Draft restored" and mode/cash/discount/reference reappear; a discount carried from a fresh cart overrides the drafted discount.
9. After payment, clicking Confirm again is impossible (button disabled for the rest of the visit); closing the dialog via backdrop routes to label printing.

### 8.2 Billing Counter (`/billing-counter`)

**Purpose:** Workstation for branches where billing is a **separate counter**: find an order (search / code / QR scan) and hand off to Collect Payment; monitor balances due, refunds owed, and day-end totals.
**Who sees it:** Users with `create_bill` OR `collect_payment`, workflow includes billing.

Layout: KPI strip (CNTR-13) + header fixed on top; two panes ("Find & bill", "Money") side-by-side on tablet/desktop, one-at-a-time on phones via a segmented switch. Both outstanding balances and the day-end summary load on entry.

| ID | Control (label) | Type | What it does | Rules / validation | Result (success / failure) |
|---|---|---|---|---|---|
| CNTR-1 | Find & bill / Money | Phone-only segmented switch | Shows one pane at a time on phones; "Money" carries a count badge = due + refunds-owed rows. | Hidden from tablet width up. | Pane swaps. |
| CNTR-2 | Patient search | Search input | Live patient search on every keystroke (name, phone, MRN, order ID); spinner while searching. | Empty input clears results. | Results list "Patients · N"; no match (with text typed, not searching) → "No matching patient. Check the spelling, phone, or order ID." Search errors show an empty result, no toast. |
| CNTR-3 | Patient result row | Button row (avatar, name, sex · age · phone, chevron) | Selects the patient and loads their order history. | — | Shows "<name> · unbilled orders" section; loading spinner "Loading orders…"; failure toast "Could not load orders for this patient". |
| CNTR-4 | Invoice / order ID input | Text input | Direct lookup by invoice number or order id; **Enter key** triggers the lookup. | Blank input does nothing. | See CNTR-5. |
| CNTR-5 | Open | Primary button | Resolves the typed/scanned code to an order. | Disabled while resolving ("Finding…"). | Match → navigates to Collect Payment with that order. No match / error → toast "No order matches that code". |
| CNTR-6 | Scan | Ghost button | Opens a camera dialog to scan the invoice QR/barcode; a detected code is resolved exactly like CNTR-5. | If the browser lacks barcode detection: warning toast "Camera scan is not supported on this browser — type the invoice number instead" and no dialog. Camera denied/unavailable → error toast "Could not access the camera". | Dialog with live video + hint "Point the camera at the invoice QR code" + Cancel button; backdrop or Cancel stops the camera. |
| CNTR-7 | Unbilled order row + "Process payment →" | Button row | Lists the selected patient's orders still awaiting billing (only orders in created/pending status count as unbilled): short order id, test count, priority chip (STAT/Urgent red, High amber), created time, collection type. | If none: "All orders for this patient are billed already." | Clicking anywhere on the row (or the button) → Collect Payment for that order. |
| CNTR-8 | Resting empty state | Display | "Find an order to bill" + hint, shown when nothing is searched or selected. | — | — |
| CNTR-9 | Due list (Money pane) | Button rows | Each partially/unpaid bill: patient name, date, "paid ₹A of ₹B", amber due-amount pill. | Section header "Due · N". When both lists are empty: "No balances due and no refunds owed — everything is settled." Load failure → toast "Could not load outstanding balances". | Clicking a row opens Collect Payment for that order (to take the balance). |
| CNTR-10 | Refunds owed list | Button rows | Bills where the lab owes money back (overpaid): same layout, red refund-amount pill (absolute value). | Section header "Refunds owed · N". | Clicking opens Collect Payment, which shows the refund panel (BILL-17/18). |
| CNTR-11 | Business day date picker | Date input | Selects the day for the day-end summary; changing it reloads the table. | Ignores empty or unchanged values; defaults to today. | Spinner "Loading summary…"; failure → toast "Could not load the day-end summary" and inline "Could not load the summary for this day." |
| CNTR-12 | Day-end summary table | Read-only table | Per-mode payment rows (Mode / Count / Total), refund rows shown in red as "mode · refund" with negative totals, and footer rows Collected, Refunded, Net (bold). | Empty payments day → "No payments on this day" row. | — |
| CNTR-13 | KPI strip (renders at the very top of the page, above the header) | Read-only stat strip | Shows the KPI tiles an admin assigned to the **Billing counter** screen in KPI configuration (section 11.10 — candidate metrics include Unpaid bills, Paid today, Revenue today, Outstanding). Shared strip behavior (labels, value formats, 30 s auto-refresh, per-tile permission gating) is specified in 11.10. | Hidden entirely when no KPIs are assigned/enabled for this screen (the default for a fresh tenant) or the fetch fails. | Informational only. |

**Flows**
1. Patient walks up with a printed invoice → Scan → QR resolves → Collect Payment opens with the order preloaded → take payment.
2. Camera unsupported (desktop without detector) → warning toast → type the invoice number → Enter or Open → same hand-off.
3. Search "98765…" → pick the patient → one unbilled order listed → "Process payment →" → Collect Payment.
4. A pay-later patient returns days later → their bill sits in Due with "paid ₹500 of ₹2000" → tap the row → Collect Payment shows Balance due ₹1500 → confirm.
5. End of shift → set the date picker to today → verify Cash/UPI/Card counts and Net against the till.

**Cross-screen invariants QC should verify (Billing)**
- Line items are never edited on a billing screen — only via order Modify; after a modify, billing always resolves to Balance due (collect) or Refund due (refund panel).
- A bill can never be double-charged from Collect Payment: after one successful confirm, Confirm is dead until a fresh navigation.
- Discount caps are enforced identically on the order cart and the billing screen: over-cap is flagged and blocks, never silently clamped; users without either discount permission are capped at 0%.
- GST display: a GST row/preview appears only when the bill actually carries tax; the document title follows the admin Document-type setting (Auto = "Tax Invoice" if taxed, else "Bill of Supply").
- Wallet payments always charge the vendor's credit before the bill is marked paid; a failed charge leaves the bill unpaid.

---

## 9. Inventory

**Area-wide gating (applies before any screen renders):**
- Both routes are wrapped in a **tenant module guard for "inventory"** — if the tenant's plan/override has the Inventory module off, navigation to either route is blocked entirely (route guard, not just hidden nav).
- **Admin → Inventory** additionally requires `manage_inventory`.
- **Stores** requires ANY of: `inventory_receive`, `inventory_issue`, `inventory_count`, `manage_inventory`.
- The **Stores nav entry** (labelled "Inventory" in the primary nav) additionally only renders when the current **branch** has inventory enabled (per-branch master switch in Lab Settings). Note: this branch switch hides the nav entry only — a direct URL to Stores still passes the route guards. All stock figures shown everywhere are **for the active branch only**.
- All amounts/quantities display with up to 2 decimal places; batch consumption everywhere is **FEFO** (first-expiry-first-out).

### 9.1 Admin Inventory (`/admin/inventory`)

**Purpose:** Admin catalog screen — create/edit inventory items (SKUs), receive stock into lots, view/adjust batches, see low-stock and expiry alerts, and map per-test consumables that drive auto-deduction at sample collection.
**Who sees it:** Users with `manage_inventory`, tenant inventory module on. No further per-role differences inside the screen.

| ID | Control (label) | Type | What it does | Rules / validation | Result (success / failure) |
|---|---|---|---|---|---|
| AINV-1 | Back (chevron) | Icon button | Navigates back to the previous screen. | Only rendered when back-navigation context exists; absent on a fresh load. | Previous screen shown. |
| AINV-2 | New item | Button (header, violet) | Opens the item form panel above the table in "New item" mode. | Always enabled. Form defaults: Category = consumable, Unit = piece, Reorder level = 0, Near-expiry = 30 days, Active = checked, SKU/Name empty. | Form panel appears titled "New item". |
| AINV-3 | Low stock alert card | Read-only list | Lists items at/below reorder level as "name — onHand / reorderLevel". | The whole alerts row (AINV-3 + AINV-4) only renders when at least one of the two lists is non-empty. Rows are not clickable. | Empty text inside card: "All good." |
| AINV-4 | Expiring soon alert card | Read-only list | Lists batches nearing/past expiry as "item lot — Nd" (days left). Negative days shows the word "expired" in red. | Near-expiry window is the item's "Near-expiry (days)" value. Rows not clickable. | Empty text: "Nothing expiring." |
| AINV-5 | SKU * | Text input (item form) | Item stock code. | **Required** (non-blank after trimming). No format/length limit in UI. | Blank SKU keeps Save (AINV-12) disabled. |
| AINV-6 | Name * | Text input (item form) | Item display name. | **Required** (non-blank after trimming). | Blank name keeps Save disabled. |
| AINV-7 | Category | Dropdown (item form) | One of: consumable, reagent, kit, disposable. | No blank option; defaults to consumable for new items. | — |
| AINV-8 | Unit (UoM) | Text input (item form) | Free-text unit of measure (placeholder "piece"). | Optional, free text. | Shown next to on-hand quantities everywhere. |
| AINV-9 | Reorder level | Number input (item form) | Threshold below/at which the item counts as "low stock". | Numeric; no min/max enforced in UI (negative accepted). | Drives the "low" badge, low-stock alerts and Stores KPIs. |
| AINV-10 | Near-expiry (days) | Number input (item form) | Window used by the "Expiring soon" alert. | Numeric; default 30. | — |
| AINV-11 | Active | Checkbox (item form) | Marks the item active/inactive. | Default checked for new items. | — |
| AINV-12 | Save | Button (item form) | Submits the item (same call for create and edit — edit sends the id). | **Disabled until both SKU and Name are non-blank.** No other client validation. | Success: toast "Item saved", form closes, table and alerts reload. Failure: toast "Save failed", form stays open with values intact. |
| AINV-13 | Cancel | Button (item form) | Closes the form panel. | Always enabled. | Form closes; unsaved edits discarded silently (no confirm). |
| AINV-14 | Items table | Table | Columns: Item (bold name + mono SKU + amber "low" pill when low-stock), Category, On hand (qty + unit), Reorder, actions. One row per item, including inactive items. | Loading state shows "Loading…" text instead of the table. | Empty state row: "No items yet. Add your first SKU." |
| AINV-15 | Receive | Row button (accented) | Expands the row and shows the inline goods-receipt form (AINV-16..20), also loading the batch list underneath. | Resets the receipt form to blank/0 each time. Only one row can be expanded at a time. | Inline form appears within the expanded row. |
| AINV-16 | Lot # | Text input (receipt form) | Supplier lot number for the new batch. | Optional (empty sent as none). | Feeds AINV-20 (Add stock). |
| AINV-17 | Expiry | Date picker (receipt form) | Batch expiry date. | Optional. Sent as midnight UTC of the chosen date. | Feeds AINV-20 (Add stock). |
| AINV-18 | Unit cost | Number input (receipt form) | Cost per unit for the batch. | Optional, defaults 0. No min enforced. | Feeds AINV-20 (Add stock). |
| AINV-19 | Qty * | Number input (receipt form) | Quantity received. | **Must be > 0** to enable AINV-20. | Feeds AINV-20 (Add stock). |
| AINV-20 | Add stock | Button (green, receipt form) | Posts the goods receipt, creating a new batch. | **Disabled while Qty ≤ 0.** | Success: toast "Stock received", receipt form hides, batch list / items table / alerts all refresh, and if the server minted a lot barcode the label block (AINV-22..25) appears showing it. Failure: toast "Receive failed", form stays. |
| AINV-21 | Label | Row button | Expands the row and shows the printable label block for the **item's own code** (item barcode if set, else SKU, else internal id). | Also loads batches under it. | Label block appears. |
| AINV-22 | Both / Barcode / QR | Segmented toggle (label block) | Chooses label symbology rendered in the preview (both, barcode-only, QR-only). | Default "Both"; selection persists while on the screen. | Preview re-renders instantly. |
| AINV-23 | Label preview | Rendered barcode/QR on white card | Shows the code with its human-readable value. | — | — |
| AINV-24 | Print label | Button (label block) | Opens the browser print flow printing **only the label area** of the page. | — | System print dialog. |
| AINV-25 | Hide | Button (label block) | Dismisses the label block. | — | Label block removed. |
| AINV-26 | Batches | Row button | Toggles the expanded batch panel for the item (click again to collapse). Header reads "Batches (FEFO)". | Opening it closes any open receipt form. | List of batches: lot (or "—"), expiry date (or "—"), red "expired" tag when past expiry, on-hand qty. Empty state: "No batches yet — receive stock." |
| AINV-27 | − (minus) per batch | Icon button | Posts a manual stock adjustment of **−1** on that batch (reason "manual decrement"). | No confirmation dialog. No client-side floor — the server governs whether qty can go negative. | Success: batch list, items and alerts silently refresh. Failure: toast "Adjust failed". |
| AINV-28 | ＋ (plus) per batch | Icon button | Posts a manual adjustment of **+1** (reason "manual increment"). | Same as AINV-27. | Same as AINV-27. |
| AINV-29 | Edit | Row button | Opens the item form panel (AINV-5..13) pre-filled with that item, titled "Edit item". | Same validation as create. | Save behaves as AINV-12. |
| AINV-30 | Select a test… | Dropdown (Per-test consumables card) | Picks a test whose consumable mapping (BOM) to edit. | Placeholder "Select a test…"; choosing blank hides the line editor. Selecting a test clears then loads its existing lines. | Line editor (AINV-31..35) appears below. |
| AINV-31 | Item… | Dropdown (per BOM line) | Selects which inventory item this test consumes; options show "Name (unit)". | Placeholder "Item…". Lines with no item chosen are dropped on save. | — |
| AINV-32 | qty/test | Number input (per BOM line) | Quantity consumed per single test. | Min 0, step 0.001 (3-decimal fractional quantities allowed). Lines with qty ≤ 0 are dropped on save. | — |
| AINV-33 | ✕ (remove line) | Icon button (red) | Removes that BOM line from the editor. | Immediate, no confirm; not persisted until Save. | — |
| AINV-34 | + Add item | Text link | Appends a new blank BOM line (qty defaults to 1). | — | New row appears. |
| AINV-35 | Save consumables | Button | Persists the mapping (only lines with an item and qty > 0) — this drives FEFO auto-deduction at sample collection. | **Disabled while saving**; label changes to "Saving…". | Success: toast "Consumables saved". Failure: toast "Save failed". No navigation either way. |

**Flows**
1. **Create an item:** New item → form opens with defaults → Save stays disabled until SKU and Name are both filled → Save → "Item saved" toast, form closes, item appears in the table with On hand 0.
2. **Receive stock:** Receive on a row → inline Lot/Expiry/Cost/Qty form → Add stock enables once Qty > 0 → submit → "Stock received", the new batch appears in the FEFO list, on-hand increases, alerts recompute — and if the backend returns a lot barcode, the label block appears ready to print.
3. **Print an item label:** Label on a row → label block with Both/Barcode/QR toggle → Print label prints only the label; Hide dismisses.
4. **Adjust a batch:** Batches on a row → each batch shows −/＋ → each tap immediately posts a ±1 adjustment (no dialog) and refreshes qty, item on-hand and alerts.
5. **Map test consumables:** pick a test in the BOM card → existing lines load → add/edit/remove lines → Save consumables → "Consumables saved". Lines left without an item or with qty 0 are silently discarded on save.
6. **Alert visibility:** the two alert cards only exist when there is at least one low-stock item OR one expiring batch; with neither, no alert section renders at all.
7. **Edit an item:** Edit → same form pre-filled → Save posts the item (with id) and refreshes; Cancel abandons changes without warning.

### 9.2 Stores / Inventory Desk (`/stores`)

**Purpose:** Scan-first operator work area for day-to-day stock movements — an Overview dashboard (KPIs, searchable stock table, alerts) plus three scan-driven actions: Receive, Issue/Consume (FEFO), Stock count.
**Who sees it:** Anyone holding at least one of `inventory_receive`, `inventory_issue`, `inventory_count`, or `manage_inventory` (module on). **Per-role differences:** each action tab only renders for holders of its permission (`manage_inventory` grants all three). Overview is visible to everyone who can open the screen.

| ID | Control (label) | Type | What it does | Rules / validation | Result (success / failure) |
|---|---|---|---|---|---|
| STO-1 | Header "Stores · <branch>" / "Inventory desk" | Read-only | Shows the active branch name in the eyebrow. | — | — |
| STO-2 | "Listening for scanner" pill | Status indicator (pulsing green dot) | Signals that a hardware barcode gun will be captured. | **Only shown while any action tab (not Overview) is active.** | — |
| STO-3 | Overview | Tab | Switches to the dashboard view. | Clicking it clears any resolved item and **reloads items + alerts**. | Dashboard renders. |
| STO-4 | Receive | Tab | Enters scan mode with the Receive action. | Rendered only with `inventory_receive` (or manage). On first entry from Overview: scan term, resolved item and label are cleared; switching between action tabs keeps the resolved item. On page load the first permitted action is preselected. | Scan bar + (if an item is resolved) receive form shows; scan input auto-focuses. |
| STO-5 | Issue / Consume | Tab | Enters scan mode with the Issue action. | Rendered only with `inventory_issue` (or manage). Same keep-resolved behavior. | Issue form shows for the resolved item. |
| STO-6 | Stock count | Tab | Enters scan mode with the Count action. | Rendered only with `inventory_count` (or manage). Selecting it (re)loads batches for the resolved item. | Count batch list shows. |
| STO-7 | KPI strip (Items / In stock / Low stock / Out of stock / Expiring soon) | 5 read-only cards (Overview) | Live counts derived from the item list and alerts. Status logic per item: **Out** = on hand ≤ 0; **Low** = flagged low OR on hand ≤ reorder level; else **In stock**. | Not clickable (do not filter the table). | — |
| STO-8 | Search items by name or SKU | Text input (Overview toolbar) | Live case-insensitive substring filter over name + SKU of the stock table. | No debounce/min length. | Table narrows as you type. |
| STO-9 | All / In stock / Low / Out | Filter chips (Overview toolbar) | Filters the stock table by the status logic above; combines (AND) with STO-8. | Exactly one active at a time; default "All". | — |
| STO-10 | Stock table | Table (Overview) | Columns: Item (name + SKU), Category ("—" if none), On hand (qty + unit), Reorder, Status pill (green "In stock" / amber "Low" / red "Out"). | Rows are read-only, not clickable. | Empty states: with items but no matches — "No items match."; with zero items at all — "No inventory items yet — add them under Admin → Inventory." |
| STO-11 | Low stock card | Read-only list (Overview) | Same content as AINV-3, plus a count badge. | — | Empty: "All items above reorder level." |
| STO-12 | Expiring soon card | Read-only list (Overview) | Same content as AINV-4, plus a count badge; "expired" in red for past-date lots. | — | Empty: "Nothing expiring within the window." |
| STO-13 | Scan/search box | Text input (scan mode; mono font, auto-focused) | One box drives everything: pressing **Enter** resolves the text as a barcode; typing simultaneously live-filters the item picker (STO-16). Placeholder differs by action: Receive → "Scan supplier barcode, or type to search items"; others → "Scan item / lot barcode, or type to search items". Also backed by an **invisible HID-gun capture**: if a barcode gun fires while focus is NOT in a text field, rapid keystrokes (gaps < 400 ms) are buffered document-wide and the terminating Enter resolves them (active only in scan mode while the camera modal is closed; ignores modifier-key combos; requires ≥ 2 buffered characters) — a gun scan is never lost to focus drift. | Trimmed. Blank Enter does nothing. **1–2 characters** → warning toast "That scan looked incomplete — try again." | See resolve flows below. |
| STO-14 | Resolve | Button (primary) | Same as pressing Enter in STO-13. | Same rules. | Same. |
| STO-15 | Camera (icon) | Button (ghost) | Opens the full-screen camera scanner modal (STO-30). | — | On a successful camera decode the modal closes and the code is resolved as if scanned. |
| STO-16 | Item picker ("All items" / "Matching items") | Grid of buttons (scan mode, only while nothing is resolved) | Lists up to **12** items filtered by the scan-box text (name + SKU substring); each shows name, SKU and on-hand. Clicking one selects it as the resolved item without a scan. | Picking resets any parsed scan data; for Receive it resets the form with Qty = 1; for Count it loads the item's batches. | Empty: "No items match." |
| STO-17 | "Last read:" line | Read-only | Echoes the most recent scanned/entered code. | Shown after any resolve attempt (even a failed one). | — |
| STO-18 | Resolved item card | Read-only header | Shows item name, SKU, and a large on-hand figure with unit; the figure turns **amber when on hand ≤ reorder level**. | Persists across action-tab switches (scan once → Receive/Issue/Count the same item). | — |
| STO-19 | Lot # (Receive) | Text input | Batch lot; **pre-filled from the scanned GS1 barcode** when the scan carried a lot. | Optional. | Feeds STO-23 (Receive stock). |
| STO-20 | Expiry (Receive) | Date picker | Batch expiry; **pre-filled from GS1** when present. | Optional. | Feeds STO-23 (Receive stock). |
| STO-21 | Unit cost (Receive) | Number input | Cost per unit. | Optional, defaults 0. | Feeds STO-23 (Receive stock). |
| STO-22 | Qty * (Receive) | Number input | Quantity received; **pre-filled from GS1 qty, else 1** after a scan/pick. | Must be > 0 to enable STO-23. | Feeds STO-23 (Receive stock). |
| STO-23 | Receive stock | Button (green) | Posts the goods receipt for the resolved item. | **Disabled while a request is in flight or Qty ≤ 0.** | Success: toast "Received {qty} {unit} of {name}"; form resets to blank/0; item list refreshes; if a lot barcode is returned the label block (STO-24..26) appears. Item stays resolved for further actions. Failure: toast with the server's error message, or "Receive failed". |
| STO-24 | Both / Barcode / QR | Segmented toggle (label block) | Chooses symbology for the freshly minted lot label. | Default "Both". | Preview re-renders. |
| STO-25 | Label preview | Rendered barcode/QR on white | Shows the new lot barcode with value. | — | — |
| STO-26 | Print label | Text link | Prints only the label area. | — | System print dialog. |
| STO-27 | Qty to issue * (Issue) | Number input | Quantity to consume. | Must be > 0 to enable STO-28. | — |
| STO-28 | Issue (FEFO) | Button (primary) | Posts a FEFO consumption for the resolved item; helper text under it reads "FEFO — the earliest-expiring non-expired lot is consumed first." | **Disabled while busy or qty ≤ 0.** | Success: toast "Issued {qty} {unit} of {name}", qty resets to 0, the resolved item is **cleared**, item list refreshes and the scan box refocuses (ready for the next scan). Failure: toast with server message, or "Issue failed" / "Issue failed — out of stock?" |
| STO-29 | Count rows (per batch) | Row: lot + expiry + "system {qty}" label, **count** number input, **Save** link | Records a physical count for one batch; the server computes the variance and adjusts stock to the counted figure. | Save is disabled while busy. Empty or **negative** counted value → warning toast "Enter a counted quantity" (0 is a valid count). Each batch saves independently. | Success: toast "Count matches system" when variance is 0, else "Adjusted by +N / −N"; the batch list refreshes with new system quantities. Failure: toast "Count failed". Empty state: "No batches at this branch yet." |
| STO-30 | Camera scanner modal | Full-screen dialog | Live camera viewfinder continuously decoding barcodes/QR; title "Scan inventory barcode"; also accepts a HID gun while open. | Close via the X button or tapping the backdrop (cancels with no action). If the camera can't start, an error message plus the hint "You can still scan with a handheld gun…" is shown and gun input still works. | Decode: modal closes and the code goes through the same resolve flow as STO-13. |

**Flows**
1. **Scan-to-receive (happy path):** open Receive tab → scan a supplier GS1 barcode (gun or camera) → item resolves; Lot, Expiry and Qty pre-fill from the barcode → Receive stock → success toast naming qty/unit/item → label block appears with the new lot barcode → Print label.
2. **Unknown barcode on Receive:** scan resolves to no item → warning toast "No item for '<code>' — pick it below to link the barcode." → the item picker remains → picking an item selects it (the just-scanned code is remembered so receiving can link it). On Issue/Count the same miss reads "No item found for '<code>'."
3. **Partial scan guard:** a 1–2 character "scan" (dropped gun burst) is rejected with "That scan looked incomplete — try again." and the scan box refocuses; nothing else happens.
4. **Scan once, act thrice:** resolve an item on any action tab, then switch between Receive / Issue / Stock count — the resolved item is kept (Count reloads its batches; Receive re-prefills from the last parsed scan). Going back to Overview clears it.
5. **Issue drains and resets:** enter qty → Issue (FEFO) → success clears the whole result card and refocuses the scan box, so the operator can gun-scan the next item immediately without touching the screen.
6. **Cycle count:** on the Count tab, each batch row shows the system quantity; type the physical count (0 allowed) → Save → toast states either "Count matches system" or the signed adjustment applied; other batch rows are untouched.
7. **Gun scan with focus lost:** operator clicks a button, then pulls the trigger — the document-level burst capture still resolves the code; it never triggers while typing in a field.
8. **Overview filtering:** type in search and/or tap a status chip — the table applies both; "No items match." appears when the filters exclude everything; the KPI cards ignore filters and always show branch-wide counts.
9. **Permission shaping:** a user with only `inventory_count` sees exactly two tabs (Overview, Stock count); on load the first permitted action is preselected as the default scan action.

### 9.3 Test Editor → Consumables tab

The same per-test consumable (BOM) mapping as AINV-30..35 is editable in context inside the Test Editor — see **TED-42…TED-44** in the Admin chapter. The tab is only added for users holding `manage_inventory` (in addition to the test-editing permission); for an unsaved (new) test the panel is replaced by "Save the test first, then add the inventory items it consumes here."; with zero inventory items, "+ Add item" is disabled with a pointer to Admin → Inventory.

**Cross-screen behaviors QC should verify (Inventory)**
- Receiving stock in either Admin Inventory or Stores immediately raises on-hand shown on both screens (each reloads its own list after its own action; the *other* screen refreshes on next load/Overview click).
- Sample collection auto-deducts mapped consumables FEFO from the active branch's stock — visible afterwards as reduced on-hand and possibly new low-stock alerts on both screens.
- Turning the tenant Inventory module off removes both routes and both nav entries; turning the branch switch off removes only the Stores nav entry.

---

## 10. Referrals: Referral Labs & Outsourcing (Send-out / Receive Results)

**Scope note for QC:** "Outsourcing" is implemented as: (1) an admin master list of external referral labs, (2) a per-test "Outsource to" setting in the test editor, (3) automatic vial-splitting at order time so outsourced tests get their own physical vials per (referral lab + department), surfaced as indicators on the label-printing and sample-collection screens, and (4) a "Tested at: <lab>" line on the final report. There is **no dedicated dispatch-manifest / "mark as sent" screen and no dedicated referral-results import screen** — outsourced results are typed into the standard result-entry screens exactly like in-house results. Anything beyond what is listed below is unspecified. (The separate "Referring network" screen covers inbound referrers/doctors and is a different functional area, not covered here.)

### 10.1 Referral / Outsourced Labs (`/admin/referral-labs`)

**Purpose:** Admin master list where external labs the organisation subcontracts tests to (e.g. Apollo) are created, edited and de/re-activated.
**Who sees it:** Users with **manage_tests** (route blocked otherwise). Reached from the Admin "Manage" hub via the fuchsia **"Referral Labs"** tile (subtitle "Outsourced / external labs"); the Admin area itself requires at least one admin permission.

**Header:** eyebrow "Admin", title "Referral / outsourced labs", subtitle explaining that outsourced tests form their own vials per (lab + department).

| ID | Control (label) | Type | What it does | Rules / validation | Result (success / failure) |
|---|---|---|---|---|---|
| RLAB-1 | Add referral lab / Cancel | Primary button (plus icon) in header | Toggles the inline create/edit form open and closed. | Label reads **"Add referral lab"** when the form is closed, **"Cancel"** while open. | Opening shows an empty "New referral lab" form panel; closing clears all entered values **without any confirmation** (unsaved input silently lost). |
| RLAB-2 | Name * | Text input | Lab display name. | **Required** — the only validated field; must be non-blank after trimming. No max-length enforced. Placeholder "Apollo Diagnostics". | Blank name keeps RLAB-10 disabled. |
| RLAB-3 | Code | Text input | Short lab code shown as a pill on the card and in the test editor's lab picker ("Name (CODE)"). | Optional. **Auto-uppercased as the user types** (typing "apollo" shows "APOLLO"). Placeholder "APOLLO". Blank saved as empty. | Feeds RLAB-10 (Create / Save changes). |
| RLAB-4 | Contact name | Text input | Contact person at the lab. | Optional, free text, no validation. | Feeds RLAB-10 (Create / Save changes). |
| RLAB-5 | Contact phone | Phone-type input | Contact number. | Optional. **No format/length validation** — any text is accepted. | Feeds RLAB-10 (Create / Save changes). |
| RLAB-6 | Contact email | Email-type input | Contact email. | Optional. **No client-side email validation** (email keyboard on mobile only). | Feeds RLAB-10 (Create / Save changes). |
| RLAB-7 | Address | Text input (full-width) | Lab address, shown on the card. | Optional, free text. | Feeds RLAB-10 (Create / Save changes). |
| RLAB-8 | Departments handled | Multi-select chip row | Tap a department chip to toggle it on (filled/gradient) or off. Selected departments later **scope the "Department at vendor" picker** on outsourced tests. | Optional. Options are the tenant's departments, de-duplicated by uppercase code. Helper text: "Optional — scopes the department picker on outsourced tests." | If no departments are configured for the tenant, the row shows "No departments configured yet." instead of chips. |
| RLAB-9 | Cancel (in form footer) | Ghost button | Closes the form. | Always enabled. | Form closes and the draft is cleared, no confirmation. |
| RLAB-10 | Create referral lab / Save changes | Primary button | Saves the draft (creates a new lab, or updates when editing). | **Disabled while Name is blank** (whitespace-only counts as blank) **or while a save is in flight** (label "Saving…"). All text fields trimmed; blank optional fields stored as empty; the department selection is stored only if at least one chip is on. | **Success:** toast "Referral lab created" (new) or "Referral lab updated" (edit); form closes and clears; list reloads. **Failure:** error toast with the server message (fallback "Could not save referral lab"); the form stays open with values intact. |
| RLAB-11 | Edit (per lab card) | Ghost button | Opens the form pre-filled with that lab's values; heading changes to "Edit referral lab" and RLAB-10 reads "Save changes". | Always available, including on inactive labs. If the form was already open with other input, that input is **replaced without warning**. | — |
| RLAB-12 | Deactivate / Reactivate (per lab card) | Ghost button | Flips the lab's active flag immediately — **no confirmation dialog**. | Label is "Deactivate" on active labs, "Reactivate" on inactive ones. | **Success:** toast "Deactivated" / "Reactivated"; list reloads. Inactive labs stay visible here with a small rose **"inactive"** chip beside the name, but **disappear from the test editor's "Outsource to" picker** (that picker lists active labs only). **Failure:** error toast (fallback "Could not update referral lab"). |

**List display rules (read-only, QC-checkable):** while loading, a centered animation with "Loading referral labs…"; when there are no labs, an empty-state card "No referral labs yet. Add one to start outsourcing tests."; each lab card shows name, optional code pill, optional "inactive" chip, a contact line ("<contact name or —> · <phone or 'no phone'>", only when at least one of the two exists), the address (when set), and one small chip per handled department (chip shows the department's current display name; if the code no longer matches a department, the raw code itself is shown). If the initial list load fails, an error toast appears (fallback "Could not load referral labs") and the list area shows the empty state.

**Flows**
1. Add a lab: click "Add referral lab" → fill Name (button enables as soon as Name has any non-space character) → "Create referral lab" → success toast → form closes → new card appears in the list.
2. Edit a lab: card "Edit" → form opens pre-filled → change values → "Save changes" → toast "Referral lab updated" → card reflects changes.
3. Deactivate: card "Deactivate" → immediate toast "Deactivated" → card gains "inactive" chip → open any test in the test editor: this lab is no longer offered in "Outsource to" (tests already pointing at it keep their setting).
4. Abandon input: with a half-filled form, click either Cancel — the form closes and all input is discarded with no prompt; reopening shows a blank form.
5. Save failure (e.g. network/server error): error toast; form remains open and editable; the button returns from "Saving…" to its normal label.

### 10.2 Test Editor — Outsourcing section

The per-test outsourcing controls are part of the Test Editor and are specified as **TED-11 (Outsource to)** and **TED-12 (Department at vendor)** in the Admin chapter. The section is hidden entirely for package-type tests — only individual tests can be outsourced.

**Save behavior (part of the editor's main Save):** outsourcing values are persisted only when the test is an individual test *and* a lab is selected; switching a test's type to "package" or picking "In-house" on a previously outsourced test clears the outsourcing on save. After saving, the tests catalogue shows a small violet **"outsourced"** chip on that test's row — QC can use this chip to verify the setting took effect.

**Flows**
1. Outsource a test: open a non-package test → "Outsource to" → pick a lab → (optionally) pick "Department at vendor" → Save → the tests list row now carries the violet "outsourced" chip; new orders containing this test generate a separate vial for it.
2. Change lab: switching "Outsource to" from Lab A to Lab B blanks "Department at vendor" — the user must re-pick it if needed.
3. Bring back in-house: set "Outsource to" to "— In-house (not outsourced) —" → the department-at-vendor field disappears → Save → the chip disappears from the tests list and new orders no longer split this test into a vendor vial.
4. Lab-scoped departments: if the chosen lab has "Departments handled" = e.g. Biochemistry only, the "Department at vendor" dropdown offers only Biochemistry (plus the blank "same as test department" option).

### 10.3 Post-Payment / Label Printing — outsourced vial badges (`/frontdesk/post-payment`)

**Purpose:** After payment, one label card is shown per vial; outsourced vials are visually flagged so front-desk staff know which tubes leave the building. (Send-out identification point #1.)
**Who sees it:** Users with **collect_payment** or **create_bill**.

| ID | Control (label) | Type | What it does | Rules / validation | Result (success / failure) |
|---|---|---|---|---|---|
| LBL-1 | ⇗ <lab name> badge | Read-only badge on a label card | Marks the vial as destined for a referral lab, and names the lab. | Appears **only** on vials the system marked as outsourced (i.e. containing an outsourced test). Lab names are looked up including deactivated labs, so a deactivated lab's name still prints. | If the referral-lab name lookup fails, the badge falls back to the generic text **"⇗ OUTSOURCED"** — the badge never silently disappears. |

**Flow**
1. An order containing 2 in-house tests and 1 outsourced test produces (at least) two label cards; the outsourced test's card — and only that card — carries the "⇗ <lab>" badge next to the label number and department.

### 10.4 Sample Collection — outsourced vial indicators

Specified as **SCOL-19** in the Sample Collection chapter: an outsourced vial's chip carries a pink outline in addition to its tube colour, with tooltip "<tube label> · Outsourced". Outsourced vials are collected through exactly the same drawer/scan flow as in-house vials — there is no extra "send out" / dispatch action; the split into a separate tube per (referral lab + department at vendor) happens automatically at order creation.

### 10.5 Report Viewer — "Tested at" line (staff report viewer & printed/PDF report; also visible in the Report Template preview)

**Purpose:** Discloses on the final report which external lab performed an outsourced test. (This is the "receive results" surface — the referral lab's name travels onto the report.)
**Who sees it:** Anyone who can open the report (staff viewer, public report link, printed PDF).

| ID | Control (label) | Type | What it does | Rules / validation | Result (success / failure) |
|---|---|---|---|---|---|
| RPT-1 | "Tested at: <referral lab>" | Read-only text sub-row under a test panel's header | Names the referral lab for that panel. | Shown only when the panel has a referral lab; when the panel also has a method, the sub-row reads "Method: <method> · Tested at: <lab>" with a dot separator; blank/whitespace lab names are suppressed entirely. | — |

**Flows / receive-results behavior for QC**
1. Results arriving from the referral lab are entered by lab staff through the **standard** result-entry screens (per-test or per-tube) — those screens have **no referral-specific controls, statuses or validations**; validation/sign-off then follows the normal pathologist flow.
2. Once released, the report shows the outsourced panel with the "Tested at: <lab>" sub-row; in-house panels show no such line.
3. The Report Template settings preview includes a sample outsourced panel (e.g. Vitamin D — "Tested at: Reference Labs Pvt. Ltd., Mumbai") so admins can see the placement without a real order.

**Explicitly out of scope / not implemented (treat as unspecified if requested):**
- No screen to build a send-out manifest, record courier/dispatch, or mark an outsourced vial as "sent".
- No screen to log receipt of results back from the referral lab, attach their PDF, or import values.
- No per-referral-lab pricing, TAT, or billing reconciliation UI.
- Referral labs cannot be deleted from the UI — only deactivated/reactivated (RLAB-12).
- Packages cannot be outsourced (the Outsourcing section is absent for package-type tests).

---

## 11. Admin Area

General rules that apply to every screen below:
- Route access is enforced by a permission guard: the user must hold **any one** of the listed permissions; otherwise they are redirected to a **403 page** (not a toast).
- All success/failure feedback is via toast notifications (green = success, red = error, amber = warning, neutral = info).
- All screens sit inside the app shell. "Back" buttons navigate within the app; they never discard-confirm — unsaved edits are silently lost unless stated otherwise.

### 11.1 Lab Settings (`/admin/lab-settings`)

**Purpose:** Tenant/branch-level operational switches: patient/sample ID formats, no-scan override, inventory master switch, payment-before-report, validation policy, per-department auto-assignment, and a dev-only data wipe.
**Who sees it:** Users with `manage_lab_settings` OR `manage_branches`. The Danger-zone wipe tile additionally requires `manage_tenant` (hidden otherwise). The "Enable inventory" tile only renders if the tenant's plan includes the Inventory module.

Note: settings on this page save **immediately on toggle/change** (no global Save button), except Patient ID format which has its own Save button.

| ID | Control (label) | Type | What it does | Rules / validation | Result (success / failure) |
|---|---|---|---|---|---|
| LSET-1 | Counters & collection — Billing / Collection chips | Read-only badges | Show whether billing runs at a "Separate counter" vs "Front desk", and collection at a "Dedicated counter" vs "Front desk". Values derive from the active Workflow — not editable here. | n/a | Always reflect current workflow config. |
| LSET-2 | "Edit in Workflow →" | Text button | Navigates to the Process Workflow Builder. | Always enabled. | Navigation only. |
| LSET-3 | Patient ID format master toggle | Toggle | ON reveals the custom-format fields; OFF shows a note that the built-in format is used (e.g. DEL-2606-000042-7). | Toggling alone does NOT save — must press Save format (LSET-10). | UI-only until saved. |
| LSET-4 | Date prefix | Dropdown | Chooses the date portion of new patient IDs: YYMMDD, DDMMYY, MMDD, YYMM, MMYY, YY, DD, or None. | Only visible when LSET-3 ON. | Updates the live Preview line. |
| LSET-5 | Separator | Text input | Character(s) between date/prefix and the running number. Blank = no separator. | Max 3 characters. | Updates Preview. |
| LSET-6 | Number digits / Min number digits | Number input | Zero-padding width of the running number. Label switches to "Min number digits" in letters mode. | Min 1. Max 10 (plain numbers) or 6 (letters mode). | Updates Preview. |
| LSET-7 | Prefix (optional) | Text input | Fixed text prefix before the date (e.g. "LAB"). | Max 16 chars; trimmed; blank saved as empty. | Updates Preview. |
| LSET-8 | Include letters | Toggle | ON = alphanumeric "odometer" IDs (e.g. AA001 … AA999999, then AB001); OFF = plain zero-padded numbers. | Toggling reveals LSET-9. | Updates Preview. |
| LSET-9 | Letters | Dropdown | Fixed letter-block width: A (1) / AA (2) / AAA (3) / AAAA (4). Uppercase; number rolls to 6 digits max before letters advance. | Only visible in letters mode. | Updates Preview. |
| LSET-10 | Save format | Button | Persists the entire Patient ID configuration (enabled flag + all fields). Running number is continuous and never resets; existing patient IDs are never rewritten. | Disabled while saving ("Saving…"). No client-side field validation beyond the input limits above. | Success: toast "Patient ID format saved". Failure: toast "Could not save patient ID format". |
| LSET-11 | Sample ID — Number width | Number input | Width of the running-number part of the short sample barcode (format: 2-digit dept code + 2-digit year + N digits). **Saves on blur** (leaving the field). | Clamped to 1–9 (values outside are snapped back). Non-numeric → treated as 1. No save if the value did not change. | Success: toast "Sample number width saved" + live Preview updates. Failure: toast "Could not save sample number width". |
| LSET-12 | Allow no-scan claim (supervisor override) | Toggle | Tenant-wide: when ON a supervisor can claim a test without scanning the vial (broken/smudged barcode). Overrides are audit-logged. Saves immediately. | None. | Success: silent (state updates). Failure: error toast with server message or "Could not save". Note: on failure the toggle is NOT visually reverted until reload — QC should flag if state and server disagree. |
| LSET-13 | Enable inventory | Toggle | Branch-level: ON auto-deducts consumables at collection and blocks ordering tests whose kit is out of stock; OFF ignores inventory entirely. Also shows/hides the Stores nav entry immediately. Saves immediately. | Tile only rendered if tenant plan includes the Inventory module. | Success: toast "Inventory enabled for this branch" / "Inventory disabled". Failure: toggle reverts + toast "Could not update setting". |
| LSET-14 | Require payment before sharing report | Toggle | ON: an order must be fully paid before its report can be generated/shared; collection never blocked. OFF (default): billing and reporting independent. Saves immediately. | None. | Success: toast "Payment now required before collection" / "Payment no longer required before collection". Failure: toggle reverts + "Could not update setting". |
| LSET-15 | Require validation for all results | Toggle | ON: every result needs pathologist validation, even "direct flow" tests. OFF: direct-flow tests auto-validate. Saves immediately. | None. | Success: toast "All results now require validation" / "Direct-flow tests auto-validate again". Failure: revert + error toast. |
| LSET-16 | Enable auto-assign for this branch | Toggle | Per-branch master switch. OFF: all received tests go to the shared queue; the per-department grid below dims and its selects disable. Saves immediately. | None. | Success: toast "Auto-assign on for this branch" / "Auto-assign off — tests go to the queue". Failure: revert + "Could not update setting". |
| LSET-17 | Per-department "People" | Multi-select dropdown (one per department card) | Picks specific active users who receive that department's tests on sample receipt. Saves immediately on change. | Disabled when LSET-16 OFF. Only active users listed. Departments listed are the **active branch's** only. | Success: silent (selection persists). Failure: error toast with server message or "Could not save". |
| LSET-18 | Per-department "Roles (least-loaded member gets it)" | Multi-select dropdown | Picks roles; the least-loaded member of the role gets each test. Saves immediately. | Same disable rule as LSET-17. | Same as LSET-17. |
| LSET-19 | Department empty warning | Inline warning text | "No one set — this department's tests go to the shared queue" shows when auto-assign is ON but a department has no people AND no roles. | Automatic. | Informational. |
| LSET-20 | 🗑 Wipe Patient Data | Danger button | Opens a confirm dialog; on confirm, deletes every patient, order, sample, bill, payment, report, appointment. Keeps tenant config, branches, departments, users, roles, test catalog, workflows. | Tile hidden without `manage_tenant`. Button disabled while wiping ("Wiping…"). Confirm dialog: title "Wipe all patient data?", buttons "🗑 Yes, wipe everything" / "Cancel". | Success: toast "Cleared N patients · N orders · N bills · N reports" and the same counts appear on the tile ("Last wipe: …"). Failure: error toast. Cancel: nothing happens. |

**Empty states:** If the branch has no departments, the auto-assign grid is replaced by "No departments yet — add them from Branches first."

**Flows**
1. Turn Patient ID toggle ON → fill date prefix/separator/digits/prefix → watch Preview update live → "Save format" → green toast.
2. Enable "Include letters" → the digits label changes to "Min number digits" and max drops to 6; a Letters dropdown appears; Preview shows e.g. "AA001".
3. Type "12" in Sample ID width → nothing happens until you click elsewhere (blur) → value snaps to 9 → toast confirms save.
4. Toggle auto-assign master OFF → the whole department grid dims and every People/Roles select becomes inoperable.
5. Click Wipe Patient Data → confirm dialog → confirm → button shows "Wiping…" → toast + "Last wipe" summary line appears under the warning copy.

### 11.2 Tests Catalog (`/admin/tests`)

**Purpose:** Master catalog of individual tests and packages, browsed by department, plus an embedded Pricing tab for bulk price edits.
**Who sees it:** Users with `manage_tests`.

| ID | Control (label) | Type | What it does | Rules / validation | Result (success / failure) |
|---|---|---|---|---|---|
| TST-1 | Create test / Create package | Primary button (header) | Navigates to the Test Editor in create mode. Label matches the current tab ("Create package" on Packages tab). Passes the tab as the pre-selected type. | Hidden on the Pricing tab. | Navigation. |
| TST-2 | Tab strip: Individual tests / Packages / Pricing | Segmented control | Switches the list view. Switching tabs clears the search box and any department drill-in. | n/a | View change only. |
| TST-3 | Search box | Text input | Live filter by test name (case-insensitive, substring). On the Individual tab, searching switches from the department grid to a flat result list and shows each result's department. Placeholder changes per tab ("Search packages…" / "Search all tests…"). | n/a | List updates as you type. |
| TST-4 | Count line | Read-only text | Shows "N departments · N tests" (grid mode) or "N tests/packages" (list mode). | Automatic. | Informational. |
| TST-5 | Department card | Clickable card | (Individual tab, no search) Drills into that department's test list. Cards show department name, test count, and department code chip. Departments are derived from the tests themselves, de-duplicated by name; tests without a department group under "Unassigned". Sorted alphabetically. | Only departments that actually contain tests appear. | Drill-in view. |
| TST-6 | "All departments" breadcrumb | Text button | Returns from a drilled-in department back to the department grid. Only shows while drilled in and not searching. | n/a | View change. |
| TST-7 | Test row (Individual list) | Read-only row | Shows name; chips: "direct" (green) or "approval" (amber) flow, "inactive" (grey, when disabled), "outsourced" (violet, when subcontracted); subtitle: department (only while searching), sample type or "no sample", TAT in hours; price in ₹. | n/a | Informational. |
| TST-8 | Package card (Packages tab) | Read-only card | Shows package name, "inactive" chip if applicable, member test count, price. | Member count parsed from the package definition; unreadable data shows 0. | Informational. |
| TST-9 | Edit | Button (per row/card) | Opens the Test Editor for that test/package. | n/a | Navigation. |

**Empty states:** "No tests yet." (no data on individual tab), "No tests match." (filter/drill-in produced nothing).

**Flows**
1. Individual tab → click a department card → breadcrumb "All departments / <dept>" appears with that department's tests → click "All departments" to go back.
2. Type in search while drilled in → drill-in is bypassed; a flat all-department result list appears with the department shown per row; clearing the search returns to the drill-in view.
3. Switch tab → search text and drill-in reset.

#### Pricing tab (embedded on the same screen)

| ID | Control (label) | Type | What it does | Rules / validation | Result (success / failure) |
|---|---|---|---|---|---|
| PRC-1 | Department filter | Dropdown | Filters the price list to one department (or "All departments"). Departments de-duplicated by code. | n/a | List updates; also changes what bulk apply targets. |
| PRC-2 | Search test name | Text input | Live substring filter. | n/a | List + count update. |
| PRC-3 | Bulk change % | Number input | Percentage to apply to every currently filtered row. Negative % reduces prices. | Defaults to 10. Non-numeric or 0 → Apply does nothing. | Local edit only. |
| PRC-4 | Apply to N filtered | Button | Multiplies every filtered row's current (possibly already edited) price by (1 + %/100); results rounded to 2 decimals, floored at 0. Edits are staged, not saved. | Disabled when the list is empty or % is empty/0. | Info toast "+X% applied to N tests — review and Save." Edited rows get a violet "dirty" highlight. |
| PRC-5 | Per-row price input | Number input | Inline edit of one test's price. Staged, not saved. | Min 0 (negative → clamped to 0); non-numeric → 0. Rounded to 2 dp for dirty comparison. | Row highlights when different from the saved value. |
| PRC-6 | Save changes | Primary button (sticky bar) | Saves all dirty prices in one bulk request. Sticky bar only appears when ≥1 unsaved change; it shows "N unsaved changes". | Disabled while saving. | Success: toast "Updated N prices"; highlights clear; bar disappears. Failure: toast "Failed to save prices"; edits remain staged. |
| PRC-7 | Discard | Ghost button (sticky bar) | Reverts every staged edit back to the saved prices. | Disabled while saving. | Bar disappears; no toast. |

**Empty/loading:** loading spinner with "Loading prices…"; "No tests match this filter." when empty; "Failed to load tests" toast on load error.

**Flows**
1. Filter to Biochemistry → enter −5 in % → "Apply to 12 filtered" → all 12 rows highlight → Save changes → toast "Updated 12 prices".
2. Edit one price manually, then Apply bulk % — the bulk multiplies the already-edited value, not the original.

### 11.3 Test Editor (`/admin/tests/new` and `/admin/tests/{id}/edit`)

**Purpose:** Create or edit a single test (name, flow, department, price/tax/TAT, outsourcing, result-entry parameters with reference ranges and validation) or a package (bundle of member tests).
**Who sees it:** Users with `manage_tests`. The Consumables tab additionally requires `manage_inventory` (tab hidden otherwise).

Create mode opens with type pre-selected from the list page ("Create package" passes package). Edit mode loads the existing test; a load failure shows toast "Could not load test" over an empty form.

**Header controls**

| ID | Control (label) | Type | What it does | Rules / validation | Result (success / failure) |
|---|---|---|---|---|---|
| TED-1 | Back | Ghost button | Returns to the tests catalog. No unsaved-change warning. | Always enabled. | Navigation; unsaved edits lost. |
| TED-2 | Save | Primary button | Creates (new) or updates (edit) the test with everything on the page. For packages, the member list is saved; department/sample type are dropped. Clearing an outsource vendor on an existing test detaches the outsourcing. | **Name is required** — empty/whitespace name shows warning toast "Name is required" and blocks save. Disabled while saving ("Saving…"). | Success: toast "Created" or "Updated", then navigates back to the catalog. Failure: error toast with server message or "Save failed"; stays on page. |

**General & Pricing tiles (always visible)**

| ID | Control (label) | Type | What it does | Rules / validation | Result |
|---|---|---|---|---|---|
| TED-3 | Name | Text input | Test/package display name. | Required at save. | Staged. |
| TED-4 | Type | Dropdown | Individual / Package. Switching to Package swaps the lower half of the page to the member picker; switching back restores the Parameters/Layout tabs. | n/a | Staged; changes page body. |
| TED-5 | Flow | Dropdown | Direct ("Result goes straight to reports") vs Approval ("Needs pathologist validation"). | n/a | Staged. |
| TED-6 | Department | Dropdown | Assigns the department. Options are department NAMES de-duplicated across branches, plus "— None —". Picking maps back to a canonical department id. | Not sent at save for packages. | Staged. |
| TED-7 | Sample type | Text input | Free-text sample type (e.g. serum). | Not sent for packages; blank omitted. | Staged. |
| TED-8 | Price | Number stepper (₹) | Test price. | Min 0, step 50; empty → 0. | Staged. |
| TED-9 | Tax slab | Number stepper (%) | GST slab for this test. | Min 0, max 50, step 0.5; empty → 0. | Staged. |
| TED-10 | TAT | Number stepper (hrs) | Turnaround time in hours. | Min 1, step 1; empty → 1. | Staged. |
| TED-11 | Outsource to | Dropdown | (Individual tests only — tile hidden for packages.) Subcontracts the test to a referral lab. First option **"— In-house (not outsourced) —"** (the default); remaining options are the **active** referral labs, labelled "Name (CODE)" when a code exists, otherwise just the name. | **Changing the lab always resets TED-12 back to blank.** | Staged; picking a vendor reveals TED-12. Selecting "In-house" hides TED-12 and, on save of a previously-outsourced test, detaches the outsourcing entirely. |
| TED-12 | Department at vendor | Dropdown | Groups the outsourced sample into its own vial at the vendor. First option **"— Same as test department —"** (default); remaining options are the tenant's departments **filtered to the codes the chosen lab declared as "Departments handled"** (RLAB-8); if the lab declared none, all departments are offered. Duplicate department names de-duplicated (case-insensitive). Helper text: "Used to group the outsourced sample into its own vial. Leave blank to use the test's department above." | Only visible when a vendor is chosen. | Staged; used only for vial grouping. |

**Tab strip (individual tests only):** Parameters / Report layout / Consumables (Consumables only with `manage_inventory`). On an unsaved new test, the Layout and Consumables tabs show a placeholder "Save the test first…" instead of their editors.

**Parameters tab**

| ID | Control (label) | Type | What it does | Rules / validation | Result |
|---|---|---|---|---|---|
| TED-13 | Add parameter | Ghost button | Appends a new parameter, defaulting to label "New parameter N", type Number, one empty reference range. Count in the "Parameters (N)" heading updates. | n/a | Staged (parameters persist only on TED-2 Save). |
| TED-14 | Parameter row header | Collapsible row | One-line summary: label (or "Untitled parameter"), type pill, compact summary (first range "min – max unit", or first 3 options, or unit), "REQ" pill if required, "IF" pill if conditional. Click anywhere toggles expand/collapse. **Only one row open at a time** — expanding one collapses the previous. | n/a | UI only. |
| TED-15 | Remove parameter (×) | Icon button on row header | Deletes the parameter immediately, no confirm. | n/a | Staged. |
| TED-16 | Label | Text input | Parameter display label. Typing also auto-derives the internal machine name (lowercased, underscores) unless a custom name already exists. | n/a | Staged; header summary updates. |
| TED-17 | Type | Field-type picker | Chooses the field type from the registry: inputs (Text, Number, Text area, Voice→text, Phone, Email, Date, Time, Date+time, Duration variants, Time of day), choices (Dropdown, Multi-select, Checkbox, Radio, Button select, Image select, Yes/No, Yes/No/N-A, Toggle), layout (Section header, Info text), media/advanced (Image gallery, Scribble pad, Image with markers, Multi-textbox, Signature, File upload, Size, Measure slider, Table/grid, Recursive group/pages). | Changing type shows/hides the range editor (Number only), the Options editor (option-bearing types only) and enables/disables Unit. | Staged. |
| TED-18 | Unit | Text input | Measurement unit shown next to results. | **Disabled unless type = Number.** | Staged. |
| TED-19 | + Add range | Text button | (Number type only.) Adds another reference-range band. | n/a | Staged. |
| TED-20 | Range: Sex | Dropdown per band | Any / Male / Female — which patients the band applies to. "Any" is stored as no constraint. | n/a | Staged. |
| TED-21 | Range: Min age / Max age | Number inputs | Age window for the band; blank = unbounded. | Step 1; may be left empty. | Staged. |
| TED-22 | Range: Age unit | Dropdown | Years / Months / Days. | n/a | Staged. |
| TED-23 | Range: Normal min / Normal max | Number inputs | The normal range used to flag results. Blank = open-ended. | Step 0.1; empty allowed. | Staged. |
| TED-24 | Remove range (×) | Icon button | Deletes that band. | **Only shown when there are 2+ bands** (the last band can't be removed). | Staged. |
| TED-25 | Critical low / Critical high | Number inputs | Per-parameter critical thresholds (panic values). Blank = none. | Step 0.1; empty allowed. | Staged. |
| TED-26 | Plausible low / Plausible high | Number inputs | Sanity band: a result outside it is rejected at result submission as a likely typo. Blank = skip check. | Step 0.1; empty allowed. | Staged. |
| TED-27 | Options (comma-separated) | Text input | (Option-bearing types only.) Comma-separated option labels; a live count badge and read-only chips show the parsed options. Trailing commas while typing are tolerated (raw text preserved; empty segments dropped on parse). | Blank segments ignored. | Staged. |
| TED-28 | Validation | Collapsible editor (per parameter) | Trigger button shows a compact rule summary badge. Expanded: **Required** checkbox; **Value min/max** (numeric types only); **Min/Max length** (length-capable types only); **Pattern (regex)** (pattern-capable types only); **Error message (optional)** override; **Clear all validation** button (only when at least one rule is set). | Field visibility depends on type — e.g. a checkbox never shows a max-length. | Staged; "REQ" pill appears on the row header when Required. |
| TED-29 | Conditional visibility | Collapsible editor (per parameter) | Initially a "Conditional visibility" link. Clicking creates a ruleset: Show when / Hide when × All (AND) / Any (OR), then one row per rule: peer-field dropdown, operator (equals, not equals, contains, not contains, greater/less than, >=, <=, is empty, is not empty), and a value box (hidden for the two "empty" operators). "+ Add rule" adds rows; "×" removes a rule; "Remove" deletes the whole ruleset. | **Disabled with hint "add another parameter first" when the test has no other parameters.** | Staged; "IF" pill on the row header while a ruleset exists. |

**Package body (type = Package; replaces the tab strip)**

| ID | Control (label) | Type | What it does | Rules / validation | Result |
|---|---|---|---|---|---|
| TED-30 | Member count chip / Member total chip | Read-only chips | "N tests" ticked and "Member total: ₹X" (sum of ticked tests' prices) so admin can set a package price below the à-la-carte total. | Live. | Informational. |
| TED-31 | Search tests | Text input | Filters the picker by test name OR department name. | n/a | Grouped list updates. |
| TED-32 | Member checkbox rows | Checkbox cards | All individual tests, grouped by department (alphabetical), each showing name, TAT, price. Ticking adds/removes the test from the package. Selected cards highlight. | n/a | Staged (saved with TED-2). |

**Empty states:** "No individual tests configured yet — create a few tests first, then build the package." / "No tests match \"query\"." / Parameters tab: "No parameters yet. Add one to let lab staff enter results."

**Report layout tab** (only after the test is saved)

| ID | Control (label) | Type | What it does | Rules / validation | Result |
|---|---|---|---|---|---|
| TED-33 | Version pill (vN) | Read-only | Shows the layout version once configured; increments on every save. | n/a | Informational. |
| TED-34 | Preview / Hide preview | Button | Opens a live preview drawer: it first pushes the current draft to the server, then renders the report with editable **sample value** inputs (one per parameter — typing re-renders). Also has Refresh and × close. | Disabled with no sections or unsaved test. | Failure: toast "Preview failed". |
| TED-35 | Save layout | Primary button | Persists the sections. | Disabled while saving or when the test isn't saved. | Success: toast "Layout saved" + version bumps; open preview refreshes. Failure: error toast. |
| TED-36 | Section tabs + "+ Add section" | Tab strip + menu | One tab per section (type badge + label), rendered top-to-bottom in the final report. Add menu offers: **Grid (results table)**, **Paragraph (interpretation)**, **Chart (gauge/bar)**, **Image (attachments)**. | n/a | Staged. |
| TED-37 | Section label / move up / move down / delete | Input + icon buttons | Rename the section (placeholder = default label), reorder, or delete it. | n/a | Staged. |
| TED-38 | Grid: spreadsheet | Table editor | Column headers come from the test's department column configuration (a tip links to configure them when missing; defaults apply meanwhile). Rows: **+ Parameter row** (pick a parameter, type cell values/templates; a ▾ per cell inserts result/unit/range placeholders), **+ Merged row** (full-width note text supporting {{placeholders}}, with an optional "Show when" rule — parameter + operator + value; picking "— always —" removes the rule), **+ Conditional note** (a merged row pre-wired with an IF + ELSE pair). Per-row "⋯" menu: add IF / ELSE condition branches (each with parameter, operator, value predicate and a "then" action — replace note text, set cell values, or set a colour), move up/down, delete row. Cell-level "locks" (fixed cell values per parameter/column) save automatically as edited. | An IF branch with no parameter picked shows the warning "Pick a parameter → this branch will never match". | Staged except locks (locks save immediately: "Locks saved for X" / "Locks cleared for X" / error toast). |
| TED-39 | Paragraph: Template | Textarea + conditions | Free text supporting {{parameter}}, {{param.unit}} and {{param.range}} placeholders. "Show this section when…" block: + IF adds a predicate branch, + ELSE adds the fallback (only one ELSE allowed); each branch removable. Default = always shown. | n/a | Staged. |
| TED-40 | Chart: Parameter / Min / Max / Zones | Dropdown + numbers + zone rows | Pick the driving parameter and the axis min/max. "+ Add zone" adds coloured bands, each with a label (low/normal/high), numeric bounds, a colour swatch picker, and × remove; a live bar shows the bands proportionally. | n/a | Staged. |
| TED-41 | Image: Caption | Text input | Caption over the section that renders any tech/pathologist-attached images; hidden on the printed report when no images exist. | n/a | Staged. |

**Consumables tab** (saved tests + `manage_inventory` only)

| ID | Control (label) | Type | What it does | Rules / validation | Result |
|---|---|---|---|---|---|
| TED-42 | Item dropdown + qty/test + ✕ (per line) | Select + number + remove | Maps an inventory item (shown with its unit of measure) and the quantity consumed per test. Drives auto-deduction at collection and the out-of-stock ordering block. | Qty min 0, step 0.001. Lines with no item or qty ≤ 0 are dropped at save. Remove has no confirm; not persisted until save. | Staged until TED-44. |
| TED-43 | + Add item | Text button | Adds a blank line (qty defaults to 1). | Disabled when no inventory items exist ("No inventory items yet — add them under Admin → Inventory first."). | Staged. |
| TED-44 | Save consumables | Button | Persists the mapping (separate from the main test Save). | Disabled while saving ("Saving…"). | Success: toast "Consumables saved". Failure: toast "Save failed". |

**Flows**
1. Create test → fill Name → Add parameter → set Label "Hemoglobin", type stays Number → fill Normal min 13 / max 17, unit g/dL → Save → toast "Created" → back at list.
2. Add a second reference range with Sex = Female and its own bounds → female patients are flagged against that band, others against the "Any" band.
3. Attempt Save with a blank name → amber toast "Name is required", nothing saved.
4. Switch Type to Package → the parameter editor disappears and the member picker appears; tick tests and watch "Member total" grow; Save stores the bundle.
5. New test → open "Report layout" tab → message says save the test first; after saving and re-entering the editor the tab shows the section designer.
6. In a parameter, click "Conditional visibility" with only one parameter defined → the link is disabled with "add another parameter first".
7. Pick an outsource vendor → a "Department at vendor" picker appears; switching vendor resets it.

### 11.4 Users & Access (`/admin/users`)

**Purpose:** List/search users, deactivate them, call them; list roles and jump to permission editing.
**Who sees it:** Users with `manage_users`.

| ID | Control (label) | Type | What it does | Rules / validation | Result (success / failure) |
|---|---|---|---|---|---|
| USR-1 | Invite / Create role | Primary button (header) | On the Users tab: navigates to the Invite user page. On the Roles tab the button becomes "Create role" and navigates to the new-role editor. | n/a | Navigation. |
| USR-2 | Tab strip: Users / Roles & Permissions | Segmented control | Switches list. | n/a | View change. |
| USR-3 | Search name or email | Text input (Users tab) | Live filter on display name or email (substring, case-insensitive). | n/a | List updates. |
| USR-4 | User row | Read-only row | Avatar, display name, "Active" (green) or "Inactive" (grey) chip, email · phone (or "no phone"). | n/a | Informational. |
| USR-5 | Call | Ghost button (per active user) | Places an internal voice call to the user. Shown only when: the Messages module is in the tenant plan, the user is active, is not yourself, and has a linked auth account. **Disabled when the user is offline** (tooltip "<name> is offline"). | Presence-driven enable/disable. | Success: info toast "Ringing <name>…". Offline click: info toast "<name> is offline." Failure: error toast with reason or "Could not place call." |
| USR-6 | Deactivate | Ghost button (per active user) | Opens confirm dialog "Deactivate <name>? They lose access immediately. Their history and assignments are kept." (danger tone, Deactivate/cancel). On confirm, deactivates the user. Inactive users show no action buttons at all (no reactivate in this UI). | Confirm required. | Success: toast "User deactivated"; the row's chip flips to Inactive and its buttons disappear. Failure: error toast. Cancel: nothing. |
| USR-7 | Roles count line | Read-only text (Roles tab) | "N roles configured". | n/a | Informational. |
| USR-8 | Role row | Read-only row | Role name, chip "Pre-seeded" (violet, system roles) or "Custom" (green), and "Scope: …". Pre-seeded rows have a violet tile tone. | n/a | Informational. |
| USR-9 | Manage permissions | Button (per role) | Opens the Role Editor for that role. | n/a | Navigation. |

**Empty state:** "No users found." (empty search result or no users).

**Flows**
1. Search "priya" → list narrows live; clearing restores all.
2. Click Deactivate → confirm dialog → confirm → chip flips to Inactive immediately, Call/Deactivate buttons vanish for that row.
3. Call an online colleague → "Ringing …" toast and the in-app call UI takes over; clicking Call on someone offline does nothing except the offline info toast (the button is normally disabled anyway).

### 11.5 Invite User (`/admin/users/invite`)

**Purpose:** Create a new user with a role and branch scope, either via an email invite or an admin-set password.
**Who sees it:** Users with `manage_users`.

| ID | Control (label) | Type | What it does | Rules / validation | Result (success / failure) |
|---|---|---|---|---|---|
| INV-1 | Back | Ghost button | Returns to Users & Access; discards the form silently. | n/a | Navigation. |
| INV-2 | Send invite | Primary button | Submits the invitation. | **Disabled until valid**: First name non-blank AND Father's name non-blank AND Email non-blank AND a Role picked; additionally, in "Set password" mode the password must be ≥ 6 characters. Disabled while sending ("Sending…"). | Success (email mode): toast "Invite sent to <email>", navigate back. Success (password mode): toast "<name> created. Share the password with them securely.", navigate back. Failure: error toast with server message or "Failed to invite"; stays on page. |
| INV-3 | First name | Text input | Required. | Blank blocks INV-2. | Staged. |
| INV-4 | Father's name | Text input | Required (used in the display name convention). | Blank blocks INV-2. | Staged. |
| INV-5 | Email | Email input | Sign-in identity / invite address. Required. | Blank blocks INV-2 (no client-side format validation — the server may reject). | Staged. |
| INV-6 | Phone | Tel input | Optional contact number. | Optional; omitted when blank. | Staged. |
| INV-7 | Role | Dropdown | Required; single role assigned at creation. | No selection blocks INV-2. | Staged. |
| INV-8 | Scope | Dropdown | Branch scoping: "All branches" (default), any branch, or any sub-branch (indented with "→"). Picking a sub-branch scopes the user to that lab only; its parent branch is resolved automatically. | Optional. | Staged. |
| INV-9 | Access method | Radio pair | "Send invite email (user sets their own password)" (default) vs "Set password now (I'll share it with them)". Switching to email clears any typed password. | n/a | Selecting "Set password" reveals INV-10. |
| INV-10 | Password | Text input (visible, not masked) | The temporary password the admin will share. Helper text: "Copy this before submitting — it won't be shown again." | Minimum 6 characters, else INV-2 stays disabled. | Sent only in password mode. |

**Flows**
1. Fill first/father's name + email + role → "Send invite" enables → submit → toast → back at Users list.
2. Choose "Set password now" → password box appears → typing 5 characters keeps Send disabled; the 6th character enables it.
3. Pick a sub-branch in Scope (indented entry) → user will be confined to that lab; picking the plain branch scopes to the whole branch; "All branches" leaves them unscoped.

### 11.6 Role Editor (`/admin/roles/new` and `/admin/roles/{id}/edit`)

**Purpose:** Create a custom role or edit the permission grants of an existing role (including pre-seeded system roles).
**Who sees it:** Users with `manage_users`.

| ID | Control (label) | Type | What it does | Rules / validation | Result (success / failure) |
|---|---|---|---|---|---|
| ROL-1 | Back | Ghost button | Returns to Users & Access (Users tab). Discards unsaved toggles silently. | n/a | Navigation. |
| ROL-2 | Save | Primary button | Create mode: creates the role (tenant scope) with the ticked permissions. Edit mode: replaces the role's permission set. Changes take effect immediately on save. | Create mode: **role name required** — blank shows warning toast "Role name required" and blocks. Disabled while saving. | Success: toast "Role <name> created" or "Permissions updated", then navigates back. Failure: error toast ("Save failed" or server message); stays. |
| ROL-3 | Role name | Text input | (Create mode only.) Name of the new role, e.g. "Billing Supervisor". | Trimmed; required at save. | Staged. |
| ROL-4 | Pre-seeded banner | Read-only tile | (Editing a system role.) "System role — name is locked, but you can edit the permissions." No name field is shown. | n/a | Informational. |
| ROL-5 | Granted counter | Read-only text | "N of M granted" — live count of ticked permissions vs all available. | Automatic. | Informational. |
| ROL-6 | Permission checkboxes | Checkbox grid, grouped by module | One row per permission showing its human name and machine code. Ticking stages a grant; unticking stages a revoke. Groups are module headings (uppercase). | All staged until Save. | Counter updates instantly. |

**Flows**
1. From Users → Roles tab → "Create role" → type name → tick permissions across module groups → Save → toast → back on the Users screen.
2. Open a pre-seeded role → banner explains the locked name → toggle permissions → Save → "Permissions updated".
3. Click Save on a new role with no name → amber toast, nothing created.

### 11.7 Branches & Departments (`/admin/branches`)

**Purpose:** Manage the branch tree: branches, their sub-branches (labs / collection centers / satellites), lab departments, department↔sub-branch assignment, per-department sample-barcode codes, and activation lifecycle.
**Who sees it:** Users with `manage_branches`.

| ID | Control (label) | Type | What it does | Rules / validation | Result (success / failure) |
|---|---|---|---|---|---|
| BRN-1 | Add branch / Cancel | Primary button (header) | Toggles the new-branch form open/closed. Label flips to "Cancel" while open; toggling always clears the form. | n/a | UI. |
| BRN-2 | New branch: Name / Code / City / State | Text inputs | Branch fields. Code auto-uppercases as typed. | Name and Code required at create; City/State optional. | Staged. |
| BRN-3 | New branch: Create | Button | Creates the branch. | Blank name or code → warning toast "Name and code required". | Success: branch appears in the list, toast "Branch added", form closes and resets. Failure: silent (no error handler) — QC note: a failed create gives no feedback. |
| BRN-4 | New branch: Cancel | Ghost button | Closes and clears the form. | n/a | UI. |
| BRN-5 | Branch header row | Expandable row | Shows 2-letter code badge, name, "city · code", optional "PF Box" chip, "N sub · N depts" counts, chevron. Clicking anywhere toggles the branch open/closed (multiple can be open). | n/a | Expand/collapse. |
| BRN-6 | Add sub-branch | Ghost button (inside open branch) | Opens the inline sub-branch form for this branch (name, CODE auto-uppercased, type dropdown: Lab (in-house) / Collection center / Satellite, city). | n/a | Form appears. |
| BRN-7 | Sub-branch form: Save | Button | Creates the sub-branch under this branch. | Name and Code required → warning toast "Name and code required". | Success: toast "Sub-branch added", card appears, form closes. Failure: silent — no error feedback. |
| BRN-8 | Sub-branch form: Cancel | Ghost button | Closes the form. | n/a | UI. |
| BRN-9 | Sub-branch card | Read-only card | "→ name", "code · type", green dot when active or "Inactive" chip, plus its Departments strip. | n/a | Informational. |
| BRN-10 | Deactivate (sub-branch) | Ghost button | Soft-deactivates the sub-branch. On an already-inactive sub-branch the button renders as "—" and clicking does nothing. **No confirm dialog.** No reactivate control exists for sub-branches. | Only acts when active. | Success: toast "Sub-branch deactivated", chip flips. Failure: silent. |
| BRN-11 | Department pill (assigned to sub-branch) | Pill with embedded controls | Shows the department name (+"Inactive" chip when deactivated; pill goes dashed/dimmed). | n/a | Informational. |
| BRN-12 | Sample # (in pill and in branch-level rows) | Number input, saves on change/blur | The 2-digit code (01–99) prefixing the short sample barcode (DD+YY+running number). Empty clears the code. | Clamped to 1–99; whole numbers only; non-numeric input is ignored (no save); unchanged value = no request. | Success: toast "Sample code set to NN" (zero-padded) or "Sample code cleared". Failure: toast "Could not save sample code". |
| BRN-13 | Power icon (in pill) / Deactivate–Reactivate (in rows) | Icon button / ghost button | Toggles the department active/inactive. Deactivating hides it from pickers system-wide but keeps historical orders/samples. Inactive rows stay operable so they can be reactivated. **No confirm.** | n/a | Success: toast "<name> deactivated" / "<name> reactivated"; styling updates. Failure: toast "Could not update department". |
| BRN-14 | × (unassign, in pill) | Icon button | Removes the department from the sub-branch, returning it to the branch-level "unassigned" list. | n/a | Success: toast "Department unassigned"; pill moves lists. Failure: silent. |
| BRN-15 | "+ Assign dept" (in sub-branch strip) | Dropdown | Assigns one of the branch's unassigned departments to this sub-branch. Only rendered when unassigned departments exist. | Selecting a blank value does nothing. | Success: toast "Department assigned"; department moves into the pill strip. Failure: silent. |
| BRN-16 | Branch departments (unassigned) — Add | Ghost button | Opens the inline add-department row (name + CODE auto-uppercase). | n/a | Form appears. |
| BRN-17 | Add-department: Save / Cancel | Buttons | Creates the department under this branch (unassigned). | Name and Code required → warning "Name and code required". | Success: toast "Department added", row appears, form closes. Failure: silent. |
| BRN-18 | "Assign →" (per unassigned dept row) | Dropdown | Assigns the department to one of the branch's sub-branches. Only shows when the branch has sub-branches. | n/a | Same as BRN-15. |

**Empty states:** "No branches yet." / "No sub-branches." / "All departments are assigned to sub-branches."

**Flows**
1. Add branch → header button flips to Cancel → fill Name+Code → Create → new branch row appears collapsed → click it to expand.
2. Inside a branch: Add sub-branch → save → new card; then "+ Assign dept" on the card moves a department in; it appears as a pill with a Sample # box, power button, and ×.
3. Type "5" in a Sample # box and tab away → saved as "05" with toast; type "200" → clamps to 99; clear the box → "Sample code cleared".
4. Deactivate a department → pill/row dims and dashes, "Inactive" chip appears, but the power/reactivate control still works; catalog pickers elsewhere stop offering it.
5. QC caution: several failure paths on this screen (create branch/sub-branch/department, assign/unassign) show **no error toast**; verify against network behaviour.

### 11.8 Process Workflow Builder (`/admin/process`)

**Purpose:** Drag-and-drop builder for the operational workflow: place actions (Register Patient, Billing, Sample Collection, Lab Intake, Validate, Results, etc.) into named "work-areas" that become the app's navigation, assign roles to each area, and manage multiple saved workflows per branch scope.
**Who sees it:** Users with `manage_workflows`.

Key model rules the UI enforces:
- **Locked actions** (Register Patient, Appointments, New Order → Frontdesk; Result Entry, Lab Intake → Lab; Validate → Validate; Results → Results) cannot be dragged out of their home area or removed; they show a padlock instead of a drag grip.
- **Mandatory action**: Register Patient can never be switched off (its toggle is disabled).
- **Coupled pair**: Dispatch ↔ Lab Intake always share the same on/off state.
- **Prerequisites**: Billing requires Register Patient; Dispatch requires Sample Collection; Validate requires Result Entry; Results requires Validate. Enabling an action auto-enables its prerequisites; disabling/removing one cascades its dependents off.
- **Repeatable action**: Sample Collection stays in the palette even after placement so it can live in several work-areas; removing one copy only cascades once the last enabled copy is gone.

| ID | Control (label) | Type | What it does | Rules / validation | Result (success / failure) |
|---|---|---|---|---|---|
| PWB-1 | Branch scope select | Dropdown (toolbar) | "⌂ All branches (default)" or a specific branch. Switching loads that scope's active (or first) workflow; if the scope has none, a **draft** is cloned from the tenant default, named "<branch> workflow", and marked unsaved. Only rendered when branches exist. | n/a | Board reloads; "Configuring <scope>" line updates. |
| PWB-2 | Workflow select | Dropdown | Switches between saved workflows in the current scope; the active one is suffixed "● active". Shows "— new draft —" when the scope has none. | n/a | Board loads the chosen workflow. |
| PWB-3 | + New | Button | Immediately creates and saves a new workflow named "New workflow" in the current scope, seeded from the tenant default (so mandatory/locked actions are present). | Always enabled. | Success: toast "Workflow created", board switches to it. |
| PWB-4 | Duplicate | Button | Copies the currently selected workflow. | **Disabled when no workflow selected** (unsaved draft). | Success: toast "Duplicated", board switches to the copy. |
| PWB-5 | Set active | Button | Makes the selected workflow the live one — it immediately drives the whole app's navigation for its scope. | Disabled when nothing is selected **or it is already active**. | Success: toast "Workflow activated — navigation updated". |
| PWB-6 | Save | Primary button | Persists name + lanes + actions. Updates the existing record, or creates a new one when working on a draft. If the saved workflow is the active one, live navigation refreshes. | Disabled while saving. Blank name saves as "Workflow". | Success: toast "Saved"; "Unsaved changes" badge clears. Failure: toast "Save failed". |
| PWB-7 | Workflow name | Text input | Renames the workflow. | Any edit sets the amber "Unsaved changes" badge. | Staged. |
| PWB-8 | "● Active" / "Unsaved changes" badges | Read-only pills | Green pill when the loaded workflow is the live one; amber pill whenever there are unsaved edits. | Automatic. | Informational. |
| PWB-9 | Palette ("Available actions") | Drag source list | Every not-yet-placed action (plus always Sample Collection). Drag a chip into a lane to place it; shows "All actions placed." when empty. Dragging a lane action back to the palette **removes** it from the flow. | Locked actions can't be dropped back (info toast "<action> can't be removed"). Removing the last enabled copy of an action cascades its dependents off. | Placement enables the action and auto-enables prerequisites; if a prerequisite isn't placed anywhere, info toast "Also needs <X> — add it to a work-area". |
| PWB-10 | Work-area lane | Drop list / card | One card per work-area: coloured top border, icon, editable name, role strip, action list. Its name becomes a navigation menu entry. Dragging within a lane reorders; between lanes moves the action. | Locked actions refuse to land outside their home area (info toast "<action> is locked to its area"); the drop is rejected. | Any change sets "Unsaved changes". |
| PWB-11 | Lane icon button | Icon + popover picker | Click the lane's leading icon to open an icon grid (Folder, Clipboard, Reception, Calendar, Billing, Test tube, Blood drop, Dispatch, Flask, Microscope, Validate, Report, Inbox, Home, Team, Messages, Pharmacy, Shield, Grid). Picking sets the work-area's nav icon and closes the menu. | n/a | Staged. |
| PWB-12 | Lane name | Inline text input | Renames the work-area (and therefore the nav label). | n/a | Staged. |
| PWB-13 | ‹ / › (move left/right) | Mini icon buttons | Reorders lanes; order = nav order. | ‹ disabled on the first lane; › disabled on the last. | Staged. |
| PWB-14 | × (delete work-area) | Mini icon button | Deletes the lane; its actions return to the palette. | **Blocked if the lane is home to any locked action**: info toast "This work-area holds locked actions and can't be deleted". No confirm otherwise. | Staged. |
| PWB-15 | "Who" role strip + "＋ roles" | Pills + edit mode | Shows which roles can enter this work-area; empty = "Anyone with access". Clicking "＋ roles" switches to edit mode where every role (fetched live; falls back to the seeded eight) becomes a toggle pill; "done" exits edit mode. | n/a | Staged. |
| PWB-16 | Per-action toggle | Mini switch on each action | Enables (green) or hides an action within its area. Toggling cascades per the coupling/prerequisite rules (e.g. turning off Sample Collection turns off Dispatch and Lab Intake). | **Disabled for mandatory actions** (Register Patient — tooltip "Required — always on"). Dimmed rows = action off. | Staged; possible info toast about missing prerequisites. |
| PWB-17 | ＋ Add work-area | Dashed button (end of board) | Appends a new empty lane named "New area" with the next palette colour and folder icon. | n/a | Staged. |
| PWB-18 | Navigation preview | Read-only strip (bottom) | One chip per work-area that has ≥1 enabled action, with its colour dot and enabled-action count — a live mock of the nav that Set active would produce. | Automatic. | Informational. |
| PWB-19 | Expand/collapse chevron per lane | Icon button | Phone-only accordion: exactly one lane expanded at a time; collapsed lanes show name + count and still accept drops. Invisible on desktop/tablet. | ≤640 px screens only. | UI. |

**Flows**
1. Drag "Billing" from the palette into a lane → it lands enabled; because Billing requires Register Patient (mandatory, always on) nothing else changes; the palette loses the Billing chip; "Unsaved changes" appears.
2. Toggle "Sample Collection" off → "Dispatch" and "Lab Intake" switch off in the same click (cascade); toggling Dispatch back on re-enables Lab Intake (coupled) and Sample Collection (prerequisite).
3. Try to drag "Validate" out of the Validate area → drop refused with toast "Validate is locked to its area".
4. Delete a custom lane → its actions reappear in the palette; try deleting the Frontdesk lane → blocked with a toast because it houses locked actions.
5. Switch scope to a branch with no workflow → a pre-filled draft named "<branch> workflow" appears with the "Unsaved changes" badge and no selection in the workflow dropdown; Save creates it; Set active then points that branch's users at it.
6. Edit anything, then Save on the active workflow → live navigation for affected users updates without a reload.

### 11.9 Billing Config (`/admin/billing`)

**Purpose:** Tenant billing rules: GST on/off + scope + per-branch GSTINs, discount tiers, invoice numbering, UPI payment details, and the invoice letterhead/PDF template with live preview.
**Who sees it:** Users with `manage_tenant` OR `manage_branches`.

| ID | Control (label) | Type | What it does | Rules / validation | Result (success / failure) |
|---|---|---|---|---|---|
| BCF-1 | Save (header) | Primary button | Saves the main config: GST enabled/scope/filing frequency, all three discount percentages + allow-discounts flag, invoice prefix/start number, UPI VPA + payee name (trimmed; blank stored as empty). Works from any tab. **Does NOT save per-branch GSTINs (BCF-6) or the letterhead (BCF-13…21)** — those have their own Save buttons. | Always enabled. | Success: toast "Billing config saved". Failure: silent — QC note: no error toast on this save. |
| BCF-2 | Tab strip: GST Setup / Discounts / Invoice | Segmented control | Switches panels. Opening the Invoice tab triggers the first live preview render. | n/a | View change. |
| BCF-3 | Enable GST | Toggle | OFF: bills carry no tax and invoices print as "Bill of Supply". ON: each test's tax slab applies. Staged until BCF-1. | When OFF, the entire GST detail tile below (scope, filing frequency, GSTIN rows) dims to 50% and becomes **completely non-interactive**. | Staged. |
| BCF-4 | GST scope | 3 selectable cards | Per branch ("Each branch files separately") / Per region ("Branches grouped by region") / Per tenant ("One consolidated filing"). Selected card highlights. | Inert while GST off; one selected at a time. | Staged. |
| BCF-5 | Filing frequency | Dropdown | Monthly / Quarterly. | Inert while GST off. | Staged. |
| BCF-6 | GSTIN per branch: GSTIN + State code + Save | Text inputs + button per branch row | Records each branch's GSTIN and state code. Each row has its own Save. | **Row Save disabled until BOTH GSTIN and state code are non-empty for that row.** No format validation client-side. "No branches configured yet." when there are no branches. | Success: toast "GSTIN saved". Failure: silent. Note: previously saved values are NOT loaded back into the inputs on page load — fields start blank; QC should verify persisted values via the invoice preview or server. |
| BCF-7 | Allow discounts | Toggle | OFF blocks all discounts system-wide (billing/order screens hide/zero the discount field) and **disables** the three percentage fields below. Staged until BCF-1. | n/a | Staged. |
| BCF-8 | Level 1 · give_discount max % | Number stepper | Cap for users holding only the basic discount permission. | 0–100, step 1; empty → 0; disabled when discounts off. | Enforced on the billing and order screens (over-cap blocks Confirm). |
| BCF-9 | Level 2 · override max % | Number stepper | Cap for the override-discount permission. | Same bounds. | Same enforcement. |
| BCF-10 | Approval threshold % | Number stepper | Discounts above this need a second approver (per helper text). | 0–100; disabled when discounts off. | Staged. |
| BCF-11 | Invoice prefix | Text input | Prefix of invoice numbers. Live "Next invoice" preview shows `PREFIX/<current year>/<start number>`. | Free text. | Staged; preview updates live. |
| BCF-12 | Starting number | Number stepper | First invoice sequence number. | Min 1, step 1; empty → 1. | Staged; preview updates. |
| BCF-13 | UPI address (VPA) / Payee name | Text inputs | Powers the "Pay via UPI" link + QR on the public patient status page; a blank VPA hides the pay option there. Saved by BCF-1. | Trimmed; blank → cleared. VPA input suppresses auto-capitalise/spellcheck; no format validation. | Staged. |
| BCF-14 | Template style | Chip selector | Classic / Modern / Letterhead / Cash Bill — the invoice PDF layout style. | One active. | Staged (letterhead group); live preview re-renders ~300 ms after any letterhead change. |
| BCF-15 | Letterhead identity fields | Text inputs | Lab name, GSTIN, Address, Phone, Email — printed on the invoice header. | All optional; placeholders show examples. | Staged; preview updates. |
| BCF-16 | Document type | Dropdown | Auto (by tax) / Tax Invoice / Bill of Supply — the printed document title logic. | n/a | Staged; preview updates. Affects BILL-6 and all invoice PDFs. |
| BCF-17 | Accent colour | Colour picker | Accent colour of the PDF (default deep blue). | n/a | Staged; preview updates. |
| BCF-18 | Signatory label / Jurisdiction / Bank details / Declaration / Footer-terms | Text inputs | Footer content of the invoice. | Optional. | Staged; preview updates. |
| BCF-19 | Logo | Image upload + URL input | Upload a logo or paste an image URL; both write the same value. | Optional. | Staged; preview updates. |
| BCF-20 | Show logo / Show GSTIN / Show result-tracking QR | Checkboxes | Include/exclude those elements on the printed invoice (tracking-QR also hides the on-screen Patient Portal QR, BILL-10). All default ON. | n/a | Staged; preview updates. |
| BCF-21 | Save letterhead | Button | Persists the whole letterhead/template group (separate from BCF-1). | Disabled while saving ("Saving…"). | Success: toast "Letterhead saved". Failure: toast "Could not save letterhead". |
| BCF-22 | Live preview pane | Embedded PDF + mode chips | Renders a sample two-test invoice (CBC + Lipid Profile, sample patient/doctor, QR codes) with the current letterhead. Chips switch between **Bill of Supply** (no tax) and **Tax Invoice** (18% split CGST/SGST) sample data. Shows "Rendering preview…" while generating. Re-renders automatically (debounced) on any letterhead/mode change while the Invoice tab is open. | Best-effort — silent on render failure. | Visual only. |

**Flows**
1. Toggle Enable GST OFF → scope cards, filing frequency and all GSTIN rows grey out and ignore clicks → header Save → "Billing config saved"; new bills carry no tax; billing screens stop showing a GST row and invoices print "BILL OF SUPPLY".
2. Type a GSTIN but leave State code blank → that row's Save stays disabled; fill state code → Save enables → "GSTIN saved".
3. Change prefix to "PFX" and start number to 5000 → "Next invoice" preview instantly shows "PFX/2026/5000"; header Save persists it.
4. On the Invoice tab, change the accent colour → after ~a third of a second the PDF preview re-renders in the new colour; switch the preview chip to Tax Invoice to see GST columns appear.
5. Set Level-1 cap to 10% → Save → a receptionist with only `give_discount` who types 15% on the billing screen sees the over-cap error and cannot confirm.
6. Remember the three separate saves: header **Save** (config), per-row **Save** (GSTIN), **Save letterhead** (template) — saving one does not save the others.

### 11.10 KPI Configuration (`/admin/kpis`)

**Purpose:** Admin surface that decides which KPI tiles appear on each operational screen's stat strip (the `pf-kpi-strip` referenced by SCOL-1, PV-3, RQ-1, CNTR-13, and the Frontdesk landing / Lab My Work / Receive samples / TAT board / Admin dashboard strips). Tiles are chosen from a fixed catalog, ordered, and scoped either tenant-wide or per-branch.
**Who sees it:** Reached from the Admin area; the route requires any admin permission and the catalog/assignment APIs require `manage_tenant` OR `manage_branches`.

**The catalog is fixed (not user-authored).** Each catalog KPI has a code, a category, a value type (count / currency / percent / duration_minutes) and an optional required-permission list. The seeded catalog, grouped by category:
- **Operational:** Today's appointments, Walk-ins today, New patients today, STAT orders today, Samples awaiting collection, Collected today, Dispatched today, Received today, Pending result, Resulted today, Pending validation, Validated today, Ready to deliver, Delivered today.
- **Financial:** Unpaid bills, Bills paid today, Revenue collected today, Billed today, Outstanding receivables.
- **Quality:** Rejected today.
- **TAT & SLA:** TAT breaches today, Avg TAT (24h).

**Configurable screens** (the tab strip): Admin dashboard, Frontdesk landing, Lab — My Work, Sample collection, Receive samples, Pathologist, Report queue, Billing counter, TAT board.

**Default state:** nothing is assigned out of the box — a fresh tenant has empty strips on every screen until an admin assigns KPIs here. This is why SCOL-1 / PV-3 / RQ-1 / CNTR-13 render nothing by default.

| ID | Control (label) | Type | What it does | Rules / validation | Result (success / failure) |
|---|---|---|---|---|---|
| KPI-1 | Back (chevron) | Icon button | Navigates back to the previous screen. | Only rendered when back-navigation context exists. | Previous screen shown. |
| KPI-2 | "Configure for" scope | Dropdown | Chooses the scope being edited: **All branches (tenant-wide)** or a specific branch. Tenant-wide + branch layers stack at render time. | Switching scope with unsaved edits prompts a native "Discard unsaved changes?" confirm. Branch list loads on entry. | Reloads the assignment list for the chosen scope. |
| KPI-3 | Screen tabs | Tablist | One tab per configurable screen (see list above); selecting a tab loads that screen's assignments for the current scope. A count badge shows how many KPIs are assigned on each screen. | Switching screens with unsaved edits prompts the same discard confirm. | Assigned column re-loads for the selected screen. |
| KPI-4 | "Filter…" catalog search | Search input | Filters the catalog by name, code, or description (case-insensitive). | — | Catalog narrows; no matches → "No KPIs match "…"". |
| KPI-5 | Catalog KPI row (＋ Add) | Button | Adds that KPI to the current screen's assigned list (appended at the end, enabled). | **Disabled** once the KPI is already assigned (shows an "added" pill instead). | Row moves into the assigned column as a new tile; state becomes dirty. |
| KPI-6 | Assigned tile | List row | One per assigned KPI: position number, KPI label, and "category · value type" meta. | Reorderable and removable (KPI-7…9). | — |
| KPI-7 | Tile enable/disable toggle | Checkbox switch | Turns a tile on/off for this screen without removing it. | — | Tile enabled/disabled; state dirty. |
| KPI-8 | Tile remove (×) | Icon button | Removes the KPI from this screen. | — | Tile leaves the list; remaining tiles renumber; state dirty. |
| KPI-9 | Drag handle (⋮⋮) | Drag affordance | Drag-and-drop to reorder tiles; order drives left-to-right placement on the rendered strip. | — | Order updates; state dirty. |
| KPI-10 | Discard | Ghost button | Reverts the draft to the last saved assignments for this (screen, scope). | **Disabled unless there are unsaved edits.** Prompts the discard confirm when dirty. | List returns to the saved state. |
| KPI-11 | Save changes | Primary button ("Saving…") | Persists this screen+scope's tile list, enabled flags, and order. | **Disabled unless dirty; disabled while saving.** | Success: toast "KPI layout saved" and the saved rows replace the draft. Failure: toast "Could not save — check permissions"; draft kept. |

**Rendered strip behavior (shared by every `pf-kpi-strip`, i.e. SCOL-1 / PV-3 / RQ-1 / CNTR-13 and the other screen strips):**
- Fetches the current user's resolved tiles for that screen and **polls every 30 s** (skips the fetch while the browser tab is hidden).
- **Per-tile permission gate:** a tile whose catalog KPI declares required permissions is dropped for a user who holds none of them (e.g. financial tiles need `view_bill`; validation tiles need `validate_result`), so two users on the same screen can see different tiles.
- **Value formatting:** count → integer (≥1000 shown as "k"); currency → ₹ with k / L / Cr suffixes; percent → "N%"; duration_minutes → m / h / d.
- **Empty / error = silent:** if no tiles are assigned/enabled (the default) or the fetch fails, the strip renders **nothing at all** — never a placeholder or error state. Its label and colour come from the catalog defaults.

**Flows**
1. Assign tiles: open `/admin/kpis` → pick scope "All branches" → select the **Sample collection** tab → add "Awaiting collection" and "Collected today" from the catalog → drag to order them → **Save changes** → toast "KPI layout saved"; the SCOL-1 strip now shows those two tiles on the next load/poll.
2. Per-branch override: switch scope to a branch → its own list loads → add a branch-specific KPI → Save; that branch's strip stacks the tenant-wide and branch tiles.
3. Permission-filtered view: a KPI requiring `view_bill` is assigned to Billing counter → a cashier without `view_bill` simply doesn't see that tile while a manager does.
4. Discard: add a tile, then **Discard** (or switch tab/scope and accept the confirm) → the draft reverts to the last saved layout.

**Cross-cutting QC notes (Admin)**
- Route guards use ANY-of semantics; a user with only `manage_tests` can reach Tests but gets a 403 page on the Users screen.
- No admin screen warns about unsaved changes on navigation (Back buttons, nav links, browser back) — data loss on navigate-away is expected behavior, not a bug, except where a screen saves instantly (Lab Settings toggles, Branches sample codes; the workflow builder tracks "Unsaved changes" visually only).
- Known silent-failure paths (no error toast): branch/sub-branch/department creation and assignment on Branches; header Save and GSTIN save on Billing Config; the Allow-no-scan toggle does not revert visually on failure.

---

## 12. Comms (Messages, Calls, Notifications)

General facts that apply everywhere in this area:
- **Access:** The Messages page requires sign-in and the "Messages" work area enabled in the tenant's active workflow (otherwise the route is blocked). There is **no role/permission gate** — any staff role can use chat and calls. If the tenant's plan does not include the Messages **module**, the page renders a locked "upgrade" screen instead (12.1) and never connects to chat/call servers.
- The call overlay is mounted globally — incoming calls ring on **any** screen of the app, not just Messages.
- All failures surface as toasts (auto-dismiss after ~4 seconds; levels: success/error/info/warning).
- Calls are **audio-only**, maximum 5 participants, and hard-capped in length: **10 minutes** for a 1:1 call, **30 minutes** for any call that ever had 3+ participants (dropping back to 2 people does not shrink the cap).
- Only one call at a time: attempting to start a second call fails with an "Already in a call." error toast.

### 12.1 Messages — locked screen (`/messages`, module OFF)

**Purpose:** Tells tenants whose plan excludes the Messages module that chat/calls are unavailable.
**Who sees it:** Any signed-in user of a tenant where the Messages module is switched off (plan default or per-tenant override).

| ID | Control (label) | Type | What it does | Rules / validation | Result (success / failure) |
|---|---|---|---|---|---|
| MSGL-1 | "Back to app" | Link button | Navigates to the app root (which lands the user on their role's home page). | Always enabled. | User leaves the locked screen. |

**Flow:** User with module off navigates directly to /messages → sees lock icon, title "Messages isn't in your plan", body text, and the Back button. No chat data loads, presence is not joined, and incoming calls do not ring for this tenant.

### 12.2 Messages — left rail, Chats tab (`/messages`)

**Purpose:** Lists every conversation the user belongs to (newest activity first) and is the entry point to start new chats/groups.
**Who sees it:** Any signed-in user with the Messages work area enabled.

| ID | Control (label) | Type | What it does | Rules / validation | Result (success / failure) |
|---|---|---|---|---|---|
| RAIL-1 | Reconnecting banner | Status banner | Appears at top of the page when the chat connection **or** the call-signaling connection drops. | Automatic; not clickable. | Disappears silently once both connections are re-established (no toast). |
| RAIL-2 | Mute-sounds bell | Icon toggle | Mutes/unmutes ALL app sounds: message ping, incoming-call ringtone, outgoing ringback. | State persists across reloads (saved on the device). Muting stops any tone currently playing. Visual notifications are NOT affected. | Icon switches between bell and bell-with-slash; tooltip "Mute sounds"/"Unmute sounds". |
| RAIL-3 | "New" (+) | Button | Opens the New chat / New group modal (NEWC). | Only visible while the Chats tab is active. | Modal opens with empty selection. |
| RAIL-4 | "Chats" tab | Tab | Shows the conversation list. | Badge pill shows total unread message count across all conversations when > 0. | List renders. |
| RAIL-5 | "Calls" tab | Tab | Shows the call log (CLOG). | Red badge pill shows count of missed calls when > 0. | Switching to Calls refreshes the call log from the server. |
| RAIL-6 | "Search conversations" | Text input | Live-filters the conversation list. | Case-insensitive match against the conversation's display name (group name, or the other person's name). Does NOT search message contents. | Non-matching rows hidden immediately; no empty-state change. |
| RAIL-7 | "Notes to self" | Pinned shortcut row | Opens (creating on first use) the user's private notes conversation. | Always pinned above the list; subtitle "Quick scratchpad · just you". | Notes thread opens in the right pane; on failure, error toast "Could not open Notes." |
| RAIL-8 | Conversation row | Button (one per conversation) | Opens that thread in the right pane. | Row shows: avatar initials (group = first 2 letters of group name; person = first+last initial); presence dot on 1:1 rows only (green = online/available, red = busy/in-a-call, amber = rounds, dark red with white dash = surgery/DND, hollow = away, grey = offline); name; time of last message; preview of last message ("You: " prefix if mine, truncated at 60 characters, or "No messages yet"); violet unread-count badge when > 0. | Thread opens, unread badge clears to 0, cursor moves into the composer. On phone, the thread takes over the full screen and the bottom navigation hides. Failure: error toast "Could not open chat." |
| RAIL-9 | "Start one" (empty state) | Link button | Same as RAIL-3. | Shown only when the user has zero conversations ("No conversations yet."). | New chat modal opens. |

**Flows**
1. A message arrives in another conversation → that conversation jumps to the top of the list, preview/time update, unread badge increments, a soft ping sounds (unless muted or the conversation is muted).
2. Opening a conversation marks it read on the server → its badge clears here and on every other device/tab.
3. On a phone, opening a thread and swiping back (or hardware back) returns to this list instead of leaving /messages.

### 12.3 Messages — Calls tab

**Purpose:** Personal call history (most recent 80 calls) with call-back and open-chat shortcuts.
**Who sees it:** Same as the rail.

| ID | Control (label) | Type | What it does | Rules / validation | Result (success / failure) |
|---|---|---|---|---|---|
| CLOG-1 | "All" sub-tab | Tab | Shows every logged call. | Default. | Full list. |
| CLOG-2 | "Missed" sub-tab | Tab | Filters to missed calls only. | "Missed" = an incoming call that was never answered (rang out or the caller cancelled). Red count pill when > 0. | Filtered list; empty state "No missed calls." |
| CLOG-3 | Call row | Read-only row | Displays one call: initials avatar, peer name, start time, direction icon (incoming arrow, outgoing arrow, red missed arrow), status text, and date. | Status text rules: "Missed call" (incoming, rang out) / "Cancelled" (incoming, caller hung up before answer) / "Declined" (my outgoing call was rejected) / "Rejected" (I rejected an incoming) / "Incoming · M:SS" or "Outgoing · M:SS" with duration for answered calls / "Connected" if answered but duration unknown. | Row itself is not clickable; actions are CLOG-4/5. |
| CLOG-4 | Open chat (speech-bubble icon) | Icon button | Opens/creates the 1:1 conversation with that person and switches to the Chats tab. | **Disabled** for group-call rows (no single peer). | Thread opens; failure: error toast "Could not open chat." |
| CLOG-5 | Call back (phone icon) | Icon button | Places a new 1:1 call to that person. | **Disabled** for group-call rows. Fails if already in a call. | Info toast "Ringing <name>…" and the outgoing-call card appears; failure: error toast (e.g. "Already in a call."). |

**Empty/loading states:** "Loading call history…" while fetching with nothing cached; "No call history yet." when empty; "No missed calls." under the Missed filter.

**Flows**
1. Switching to the Calls tab always refetches the log; a call just completed appears at the top.
2. Tapping Call back on a group-call row does nothing (button disabled) — group calls are re-started from the group's thread.

### 12.4 Messages — thread (right pane)

**Purpose:** Read and act on the messages of the selected conversation.
**Who sees it:** Any member of the conversation. Before a conversation is selected the pane shows a placeholder: "Select a conversation" with a "start a new one" link (opens NEWC).

| ID | Control (label) | Type | What it does | Rules / validation | Result (success / failure) |
|---|---|---|---|---|---|
| THR-1 | Back (chevron) | Icon button | Closes the thread and returns to the list. | On phone also restores the bottom nav and dismisses the keyboard. | Right pane returns to placeholder. |
| THR-2 | Header identity | Read-only | Avatar (with presence dot for 1:1), conversation name, subline. | Subline: groups show "N members"; 1:1 shows presence text ("Online", "On a call", "Offline", or a custom status like "In surgery"). | — |
| THR-3 | Context chip | Link chip | For conversations anchored to a clinical record: shows record type + label; clicking opens the record. | Only when the conversation has a patient/order/report anchor. Targets: patient → patient profile; order → lab My Work; report → report viewer. Those pages have their own permission gates — a user without the permission is bounced to the 403 page. | Navigation away from /messages. |
| THR-4 | Search-in-conversation (magnifier) | Icon toggle | Opens/closes the in-thread search bar (THR-9). | Toggling off clears the query and results. | Bar appears below the header. |
| THR-5 | Mute conversation (bell) | Icon toggle | Mutes/unmutes notifications for THIS conversation only. | Muted conversations produce no ping/browser notification — **except** messages that @mention me, which always notify. Mute state syncs to my other devices. | Icon flips to bell-with-slash; failure: error toast "Could not update mute." |
| THR-6 | Voice call (phone) | Icon button | Starts a call with the conversation. | 1:1: if the other person is offline, nothing starts — info toast "<name> is offline." Group: rings every online member simultaneously; offline members simply don't ring. | Info toast "Ringing <name/group>…" + outgoing card appears; failure: error toast (mic denied, already in a call, etc.). |
| THR-7 | Group members (people icon) | Icon button | Opens the Group members modal (MEM). | Groups only (hidden on 1:1). | Modal opens. |
| THR-8 | Pinned strip | Banner | Shows "N pinned" + preview of the first pinned message, with a hide (×) button. | Appears only when the conversation has pinned messages. Hiding collapses the strip; it stays collapsed until the page is reloaded (not per-conversation). | — |
| THR-9 | Search bar input | Text input | Server-side substring search within this conversation, debounced ~200 ms. | Shows "N match(es)" count. Results list appears above the composer. | Clicking a result **closes the search bar only** — it does not scroll to or highlight the message (known limitation; QC should not expect jump-to-message). |
| THR-10 | Message scroller | Scroll area | Displays messages chronologically with day separators ("Today", "Yesterday", weekday within a week, else "Mmm d, yyyy"). | Scrolling within 80 px of the top loads the next 50 older messages, preserving scroll position; "— Start of conversation —" marks the beginning. Empty thread: "No messages yet. Say hello!" Loading indicator while fetching. Files can be **drag-dropped** anywhere onto the scroller to attach/send. | Auto-scrolls to bottom on new messages and when opening a thread. |
| THR-11 | System/call rows | Read-only | Centered grey rows for system events and call records (e.g. call started/ended) with a timestamp. | Not interactive; never trigger notifications or unread counts. | — |
| THR-12 | Message bubble | Content | Consecutive messages from the same author within 5 minutes group together (author label and timestamp only on the run's edges). My bubbles align right. Special renders: image-only bubble (image fills bubble, opens full-size in a new tab on click), audio bubble (inline player for voice messages), file card (name + size, opens in new tab), shared-record card (THR-13), reply-quote chip, 1–3-emoji-only messages render extra large. Deleted messages show a "message deleted" placeholder. Bubble meta line shows: pin icon (if pinned), time, "(edited)" tag, and for my messages a pending (⏳) or sent (✓) tick. | @mentions render as highlighted "@Name" chips; a mention of me gets an extra highlight. | — |
| THR-13 | Shared-record card | Link card | Patient / Order / Lab-report card inside a bubble; clicking opens the record. | Same navigation targets and permission caveat as THR-3. | — |
| THR-14 | Reaction pills | Buttons under a bubble | Each shows emoji + count; clicking toggles MY reaction with that emoji. | Pill is highlighted if I already reacted; tooltip shows "N reacted with <emoji>". | Count updates live for everyone; failure: error toast "Could not react." |
| THR-15 | Hover/tap action bar | Popover per bubble | Desktop: appears on hover. Touch: appears on tapping the bubble (tap again to hide). Contains, in order: 6 quick-reaction emoji (👍 ❤️ 😂 🎉 😢 🙏), Reply, Forward, Pin/Unpin. | Not shown on deleted messages. **Edit** and **Delete** appear only on my own, already-delivered messages. | Reply/Forward/Pin actions below. |
| THR-16 | Reply | Action | Puts a "Replying to <name>" banner above the composer, quoting up to 140 characters. | Cancels any in-progress edit. Esc or the banner's × cancels. | Sent message carries the quote chip. |
| THR-17 | Forward | Action | Opens the Forward modal (FWD). | Any message incl. attachments. | See FWD. |
| THR-18 | Pin / Unpin | Action | Toggles the message's pinned state for the whole conversation. | Anyone in the conversation may pin/unpin. | Pinned strip updates for all members; failure: error toast "Could not pin/unpin." |
| THR-19 | Edit (own messages) | Action | Loads the message text into the composer with an "Editing message" banner. | Only my own non-pending messages. While editing, attach/share/mic/"+" controls are disabled. Esc or × cancels. | On send, the message body updates for everyone with an "(edited)" tag. |
| THR-20 | Delete (own messages) | Action | Deletes my message for everyone. | No confirmation dialog — deletion is immediate. | Bubble becomes "message deleted"; the rail preview becomes "(message deleted)"; failure: error toast "Could not delete message." |
| THR-21 | "Seen" line | Read-only | Under my most recent message that another member has read: "Seen" (1:1) or "Seen by X", "Seen by X and Y", "Seen by X +N" (groups). | Only rendered on one message (the latest seen one). | — |
| THR-22 | Typing indicator | Read-only | "<name> typing…" with animated dots at the bottom of the scroller. | Clears automatically ~3 s after the other person stops typing. | — |

**Flows**
1. Another member deletes a message you're looking at → the bubble flips to "message deleted" in place, live.
2. You send a message while briefly offline → the bubble stays with a ⏳ tick and gets " (failed)" appended, your draft is restored to the composer, and an error toast shows.
3. Drag a PDF from the desktop onto the message area → drop cursor shows "copy"; on drop, the file enters the attachment pipeline (composer flows below).
4. Open a group thread → header shows member count; tap the phone icon → every online member's device rings at once.

### 12.5 Messages — composer (bottom of the thread)

**Purpose:** Author text, emoji, attachments, voice messages, shared patients, replies and edits.
**Who sees it:** Anyone with an open thread.

| ID | Control (label) | Type | What it does | Rules / validation | Result (success / failure) |
|---|---|---|---|---|---|
| CMP-1 | Reply banner | Banner + × | Shows "Replying to <name>" + quote; × or Esc cancels. | Mutually exclusive with the edit banner. | — |
| CMP-2 | Edit banner | Banner + × | Shows "Editing message · Press Esc or × to cancel". | Cancel restores an empty composer. | — |
| CMP-3 | Pending-attachment chip | Chip + × | Shows the staged file (image thumbnail or file icon), name, size, "ready to send"; × removes it. | One staged attachment at a time. | Removing clears it without sending. |
| CMP-4 | "+" button (phone) | Popover menu | Opens a 3-item menu: Attach a file / Share a patient / Emoji (replaces the three inline icons on small screens). | Disabled while editing a message. Attach item disabled while an upload is in progress. | Menu closes after choosing. |
| CMP-5 | Attach (paperclip) | Icon button → file picker | Opens the OS file picker. | Accepts PNG, JPEG, WEBP, GIF, PDF; multiple selection allowed. Disabled while uploading (animated dots) or while editing. **Per-file limit 15 MB** — an oversized file is skipped with error toast "<name> is larger than 15 MB." Images over 300 KB (except GIFs) are automatically downscaled to max 1600 px JPEG before upload. | **One file:** uploaded and staged as CMP-3 so a caption can be typed; send happens on CMP-10. **Multiple files:** each is uploaded and sent immediately as its own message; the first message carries whatever text was in the composer as its caption, the rest are caption-less. Upload failure: error toast "Upload failed." |
| CMP-6 | Share a patient (person icon) | Icon button → popover | Opens the "Share a patient" picker: search box ("Search patient by name / MRN / phone", debounced ~200 ms, 12 results; empty query shows 12 recent patients) with rows showing name + MRN (or phone). | Disabled while editing. On phone the picker is a bottom sheet with a backdrop. | Clicking a patient immediately sends a patient card into the conversation, closes the picker, info toast "Shared <patient name>". States: "Searching…", "No patients found."; failure: error toast "Could not share patient." |
| CMP-7 | Emoji (smiley) | Icon button → popover | Opens a fixed grid of ~50 emoji; clicking one inserts it at the caret and keeps focus. | On phone it is a dismissible bottom sheet. | — |
| CMP-8 | Message box | Auto-growing text area | Type the message. Placeholder changes with state: "Type a message" / "Add a caption…" (attachment staged) / "Edit message" (editing). | **Enter sends; Shift+Enter inserts a newline; Esc cancels edit, then reply.** Grows up to ~5 lines then scrolls internally. Pasting an image from the clipboard routes it into the attachment pipeline (CMP-5 rules). Typing broadcasts a throttled "typing" signal to the other members (at most every 2 s; stops 3 s after the last keystroke). | — |
| CMP-9 | @mention popover | Autocomplete list | Typing "@" (at start or after a space) opens a list of up to 8 other conversation members, filtered live by name/email as you keep typing. | Selection is by **click/tap only** (arrow keys/Enter are not wired to the list — Enter will send the message as typed). Choosing a person inserts a mention token that renders as "@Name" for everyone. | Mentioned users are notified even if they muted the conversation. |
| CMP-10 | Send (paper plane) | Button | Sends the draft and/or staged attachment; if editing, saves the edit instead. | Visible only when there is non-blank text OR a staged attachment. Blank-only drafts cannot be sent. | Message appears instantly with a ⏳ tick, replaced by ✓ when the server confirms. On failure the draft, reply/edit state, and attachment are restored and an error toast shows. |
| CMP-11 | Microphone | Button | Starts a voice-message recording. | Shown instead of Send when the composer is empty and nothing is staged. Disabled while editing. First use triggers the browser mic-permission prompt — denial: error toast "Microphone permission denied."; unsupported browser: "Voice messages aren't supported on this browser." | Composer collapses into the recording row (CMP-12). |
| CMP-12 | Recording row | Composite | While recording: × cancel button (discards), blinking red dot, elapsed time M:SS, hint "Recording — release to send", and a send button that stops and sends. | **Hard cap 60 seconds** — recording auto-stops and sends at 1:00. | The clip uploads and sends automatically as an audio message (playable inline); failure: error toast "Voice upload failed." |

**Flows**
1. Type text → mic button becomes a Send button; press Enter → optimistic bubble with ⏳ → ✓ on server echo.
2. Pick one photo → it is compressed (if large), uploaded, and staged with an "Add a caption…" placeholder → type a caption → Send → single message with image + caption.
3. Pick three PDFs at once → three separate messages send immediately in order; any file over 15 MB is skipped with its own error toast.
4. Tap mic → allow permission → speak 10 s → tap send → audio bubble appears for both parties.
5. Type "@an" in a group → member list filters to matching names → tap one → "@Name " inserted; the mentioned user gets a ping/notification even if they muted the group.

### 12.6 Messages — New chat / New group modal

**Purpose:** Start a 1:1 chat or create a named group from the tenant directory.
**Who sees it:** Anyone (opened via RAIL-3, RAIL-9, or the thread placeholder link).

| ID | Control (label) | Type | What it does | Rules / validation | Result (success / failure) |
|---|---|---|---|---|---|
| NEWC-1 | Title | Read-only | "New chat" with 0–1 people selected; "New group" with 2+. | Automatic. | — |
| NEWC-2 | Close (×) / backdrop / Cancel | Buttons | Dismisses the modal without creating anything. | — | Selection discarded. |
| NEWC-3 | "Group name" | Text input | Names the group. | **Appears only when 2+ people are selected. Required (blank/whitespace not accepted) for group creation.** Placeholder "e.g. Cardiology Team". | — |
| NEWC-4 | "Search people" | Text input | Live-filters the directory list by name or email. | Case-insensitive. | — |
| NEWC-5 | Person row | Checkbox row | Toggles the person in/out of the selection. | List = all **active** users in the tenant, excluding the current user. Directory load failure: error toast "Could not load directory."; empty search: "No users found." | Footer count updates. |
| NEWC-6 | Footer count | Read-only | "Pick at least one person" / "1 person selected — direct chat" / "N people selected — group chat". | Automatic. | — |
| NEWC-7 | Primary button ("Open chat" / "Create group") | Button | 1 selected: opens (creating if needed) the 1:1 conversation. 2+: creates the group with the given name and all selected members. | **Disabled** when: nothing selected, or 2+ selected and the group name is blank. | Modal closes and the new/existing thread opens as the active conversation. Failure: error toast "Failed to create chat." |

**Flows**
1. Select one colleague → "Open chat" → if a 1:1 already existed, the existing thread opens (no duplicate created).
2. Select two colleagues → title flips to "New group", a required Group name field appears, button label becomes "Create group" and stays disabled until a name is typed.
3. Creating a group notifies the other members' apps, and the group appears in everyone's conversation list.

### 12.7 Messages — Group members modal (+ Add-member sub-modal)

**Purpose:** View members, add/remove members, or leave the group.
**Who sees it:** Any member of a group (via THR-7). **Add member and Remove are only shown to the group's creator (owner). Leave group is available to everyone.**

| ID | Control (label) | Type | What it does | Rules / validation | Result (success / failure) |
|---|---|---|---|---|---|
| MEM-1 | Title | Read-only | "<Group name> · N members". | — | — |
| MEM-2 | Close (×) / backdrop | Buttons | Dismisses the modal (also closes the add-member sub-modal). | — | — |
| MEM-3 | Member row | Read-only row | Avatar, name (with "you" tag on myself, "owner" tag on the creator), email. | — | — |
| MEM-4 | Remove (trash icon) | Icon button per row | Removes that member from the group. | Only visible to the **owner**, and never on the owner's own row. | Info toast "Member removed."; the member list refreshes; failure: error toast "Could not remove member." No confirmation dialog. |
| MEM-5 | "Leave group" | Button | Removes ME from the group. | Available to every member incl. the owner. | Info toast "You left the group."; the conversation disappears from my list and the thread closes; failure: error toast "Could not leave group." No confirmation dialog. |
| MEM-6 | "+ Add member" | Button | Opens the Add-member sub-modal. | Owner only. | — |
| ADDM-1 | "Search people" (sub-modal) | Text input | Filters candidates by name/email. | Candidates = active tenant users **not already in the group**. | Empty state: "Everyone in your org is already a member." |
| ADDM-2 | Person row (sub-modal) | Button | Adds that person to the group immediately. | Rows disabled while an add is in flight. | Info toast "Member added."; sub-modal closes; member count updates. Failure: error toast "Could not add member." |
| ADDM-3 | Close (×) / backdrop (sub-modal) | Buttons | Dismisses without adding. | — | — |

### 12.8 Messages — Forward modal

**Purpose:** Re-send an existing message (text and/or attachment) into another conversation.
**Who sees it:** Anyone, via a bubble's Forward action.

| ID | Control (label) | Type | What it does | Rules / validation | Result (success / failure) |
|---|---|---|---|---|---|
| FWD-1 | Preview | Read-only | "FORWARDING" label + the message body (or the attachment name if there's no text). | — | — |
| FWD-2 | "Search a conversation" | Text input | Filters the destination list by conversation display name. | The **current** conversation is excluded from the list. Empty state: "No conversations match." | — |
| FWD-3 | Destination row | Button | Sends a fresh copy of the message (body + attachment; reactions, edits, and reply-quotes are NOT carried over) into that conversation. | One click = sent (no extra confirm). | Info toast "Forwarded to <name>"; modal closes. Failure: error toast "Could not forward." |
| FWD-4 | Close (×) / backdrop | Buttons | Cancels. | — | — |

### 12.9 Call UI — incoming-call ringer (global overlay, any screen)

**Purpose:** Alert the user to an incoming 1:1 or group call and let them answer or decline.
**Who sees it:** Any signed-in user being called (Messages module must be on for their tenant). Full-screen sheet on phones, centered card on desktop.

| ID | Control (label) | Type | What it does | Rules / validation | Result (success / failure) |
|---|---|---|---|---|---|
| RING-1 | Card identity | Read-only | Eyebrow "Incoming call" / "Incoming group call"; pulsing avatar with initials; caller name (group calls show the group name with subline "<caller> is calling…"); 1:1 subline shows the call's origin ("Pathologist consult", "Frontdesk", "Internal") or "Incoming call…". | The incoming **ringtone** (soft two-note chime) loops while ringing, unless sounds are muted (RAIL-2). | — |
| RING-2 | Decline (red phone) | Button | Rejects the call. | — | Card closes; the caller's ringer closes; the call logs as "Rejected" for me / "Declined" for the caller. Failure: error toast "Could not decline call." |
| RING-3 | Accept (green phone, breathing animation) | Button | Answers the call. | First-ever call triggers the browser microphone permission prompt. Mic denial: the call fails with an error banner "Microphone permission denied or unavailable." and error toast. | Ringer closes; the active-call screen opens full-screen showing "Connecting…" then "On call". |

**Automatic behaviors (QC must verify):**
1. An unanswered incoming ring **auto-dismisses after 90 seconds** and logs as Missed.
2. If the same user answers/declines on **another device**, this device's ringer dismisses silently.
3. If the caller hangs up before answer, the ringer dismisses and the call logs as "Cancelled" (counts as missed).
4. If the user is already in a call, a new incoming call is ignored (no second ringer).

### 12.10 Call UI — outgoing-call ringer

**Purpose:** Shows the caller that the callee is being rung, with the only action being Cancel.
**Who sees it:** Only the user who placed the call (Messages module must be on for their tenant), from the moment they start it until it is answered, declined, cancelled, or times out. Full-screen sheet on phones, centered card on desktop.

| ID | Control (label) | Type | What it does | Rules / validation | Result (success / failure) |
|---|---|---|---|---|---|
| ORING-1 | Card identity | Read-only | Eyebrow "Calling", pulsing avatar, callee/group name, "Ringing…". | A soft **ringback** tone loops for the caller (unless muted). | — |
| ORING-2 | Cancel (red phone) | Button | Cancels the un-answered call. | — | Card closes; the callee's ringer dismisses; logs as Cancelled. |

**Automatic behaviors:**
1. No answer within **60 seconds** → the call auto-cancels ("No answer.") and the card closes.
2. Callee declines → the card closes immediately (no toast).
3. Callee accepts → card is replaced by the active-call screen.

### 12.11 Call UI — active-call screen (expanded, default view)

**Purpose:** Full-screen in-call surface: participants, timer, connection quality, chat, and controls.
**Who sees it:** Every participant once the call connects (it opens expanded automatically for each new call).

| ID | Control (label) | Type | What it does | Rules / validation | Result (success / failure) |
|---|---|---|---|---|---|
| CALL-1 | Minimise (chevron) | Icon button | Collapses the screen to the floating mini-pill (PILL). | Also closes the invite popover. | Call continues; pill appears bottom-right. |
| CALL-2 | Status pill | Read-only | "Connecting…" (pulsing) until audio flows, then "ON CALL" with a green live dot. | — | — |
| CALL-3 | Timer | Read-only | Elapsed call time MM:SS, ticking every second. | Starts at the moment audio connects. | — |
| CALL-4 | Connection chip | Read-only | "Direct" (green dot) = peer-to-peer; "Relay" (red dot) = routed via relay server. Tooltip explains. | Only shown while the call is active. | — |
| CALL-5 | Remaining-time chip | Read-only | "MM:SS left" countdown to the call cap. | **Appears only in the last 2 minutes** of the cap; turns red and pulses in the last 60 s. At 60 s an info toast fires: "Call ends in 60 seconds (10-minute 1:1 cap)" or "(30-minute group cap)". At 0 the call ends automatically with toast "Time is up — ending call." | — |
| CALL-6 | In-call chat toggle (speech bubble, header) | Icon toggle | Opens/closes the chat side panel (CALL-10). | See CALL-10 rules. | — |
| CALL-7 | End (× in header) | Icon button | Leaves the call. | Same as CALL-13. | Screen closes; call logs with duration. |
| CALL-8 | Error banner | Read-only | Red banner for call errors (e.g. mic denied). | Only when an error exists. | — |
| CALL-9 | Participant tiles | Read-only grid | One card per participant: avatar initials, name, and state label ("You" for self, "Muted", or "Connected"). My card is tinted; muted participants get a red mic-slash badge and dimmed card; unmuted ones show a pulsing green ring. | Names resolve from the staff directory; a just-joining unknown participant shows "Joining…". | Tiles appear/disappear live as people join/leave. |
| CALL-10 | In-call chat panel | Side panel | Text chat during the call: message list + input + send button (send disabled when input is blank; Enter sends). | The panel binds to: the group's conversation (group call), the 1:1 conversation with the other person (1:1 call — created if needed), or for a group call I started, the best-matching group conversation. If no match: info toast "In-call chat is not available for this call." and the panel closes. On phone, opening chat replaces the participant grid. | Messages are real chat messages — they persist in the conversation after the call. Failure: error toast "Could not send." |
| CALL-11 | Mute / Unmute | Round control + label | Toggles my microphone. | Label and icon flip; the button turns red while muted. Other participants see my "Muted" badge within a moment. | — |
| CALL-12 | Add | Round control + label | Opens the "Invite to call" popover: header shows "N online"; list of **online** tenant users not already in the call. | States: "Loading…", "No one else is online right now.". Clicking a person rings them into this call. | Info toast "Ringing <name>…"; when they accept, their tile appears (max 5 participants total, enforced by the server). Failure: error toast "Could not invite" / "Could not load people list". |
| CALL-13 | End (red disc) | Round control + label | Hangs up and leaves the call. | — | For the others the call continues; when the last remote participant leaves, the call ends automatically for everyone remaining. |

**Flows**
1. 1:1 call passes 8:00 → "02:00 left" chip appears → at 9:00 an info toast warns → at 10:00 the call ends itself with a toast.
2. A third person is invited and accepts → everyone's cap silently extends to 30 minutes; the group cap remains even if that person later leaves.
3. Screen minimised → mini-pill shows; expanding restores the full screen with the same state.
4. The other party hangs up on a 1:1 → the screen closes automatically (call over).

### 12.12 Call UI — minimized call pill (floating, bottom-right)

**Purpose:** Keep call controls reachable while the user works elsewhere in the app.
**Who sees it:** A participant who minimised the call screen. Sits above the phone bottom-nav.

| ID | Control (label) | Type | What it does | Rules / validation | Result (success / failure) |
|---|---|---|---|---|---|
| PILL-1 | Avatar + title + time | Read-only | Peer name (1:1), "Group call · N", or "Connecting…"; below it the live timer (or "Connecting…"). A green pulsing ring surrounds the avatar while live. | — | — |
| PILL-2 | Remaining chip | Read-only | Same countdown behavior as CALL-5 (last 2 min only, red final minute). | Tooltip explains the cap. | — |
| PILL-3 | Route badge | Read-only | "● DIRECT" (green) or "● RELAY" (amber), tooltip explains. | Hidden on very narrow phones. | — |
| PILL-4 | Expand | Icon button | Restores the full call screen. | — | — |
| PILL-5 | Mute / Unmute | Icon toggle | Same as CALL-11. | Red while muted. | — |
| PILL-6 | Add participant | Icon button | Opens the same invite popover, anchored to the pill. | Hidden on very narrow phones. | Same as CALL-12. |
| PILL-7 | End (red) | Icon button | Hangs up. | — | Pill disappears. |

### 12.13 People drawer (top strip, any screen)

**Purpose:** Quick roster of all tenant staff with live presence, one-tap 1:1 chat, and one-tap calling — without leaving the current page.
**Who sees it:** Anyone whose workflow has the Messages area enabled (the People button is hidden otherwise). Opens as a right-edge slide-out.

| ID | Control (label) | Type | What it does | Rules / validation | Result (success / failure) |
|---|---|---|---|---|---|
| PPL-1 | People button (top strip) | Icon button | Toggles the drawer. | Shows a badge with total unread chat count ("9+" above 9). | Opening refreshes users, conversations, and presence. |
| PPL-2 | Header count | Read-only | "N · M online" (total active users · currently online). | — | — |
| PPL-3 | "Search people…" | Text input | Filters the roster by name or email. | Empty result: "No matches." | — |
| PPL-4 | Person row | Button | Opens an embedded 1:1 chat with that person inside the drawer. | Roster groups by presence: "On a call" / "Online now" / "Away" / "Offline", alphabetical within groups. Row shows presence dot, last message preview (or presence label), and a violet unread badge. | Chat mode opens; failure: error toast "Could not open chat." |
| PPL-5 | Back (chevron, chat mode) | Icon button | Returns to the roster. | Closes the embedded thread. | — |
| PPL-6 | Call button (chat mode header) | Icon button | Voice-calls the open person. | **Disabled** when the person is offline (tooltip "User is offline") or when I'm already in a call (tooltip "You are already in a call"). | Info toast "Ringing <name>…"; failure: error toast. |
| PPL-7 | Message list (chat mode) | Read-only | Simple bubbles with time and ⏳/✓ tick on mine; typing dots when the other person types. | No reactions/attachments/actions here — full features live on /messages. | — |
| PPL-8 | Composer (chat mode) | Text input + send | Sends a text message; Enter sends; send button disabled when blank; input capped at 4000 characters. | If the recipient is offline, the message still sends, with info toast "<name> is offline — they'll see it when they're back." | Failure: draft restored + error toast "Message failed to send." |
| PPL-9 | Close (×) / backdrop | Buttons | Closes the drawer. | Closing also closes any embedded thread and resets to roster mode. | — |

### 12.14 Notification surfaces (cross-cutting)

**Purpose:** Everything that alerts a user to comms activity. **Who sees it:** all signed-in users (chat items require the Messages module/work-area).

| ID | Control (label) | Type | What it does | Rules / validation | Result (success / failure) |
|---|---|---|---|---|---|
| NTF-1 | Message ping (sound) | Audio cue | Soft single chime when a chat message arrives. | Fires ONLY when: the message is from someone else, it's a real user message (not system/call rows), it's NOT the conversation currently open, and the conversation isn't muted (an @mention of me overrides mute). Silenced entirely by the sounds-mute toggle (RAIL-2). | — |
| NTF-2 | Browser (OS) notification | System notification | Title = sender name (groups: "Sender · Group name"); body = message text truncated at 140 chars; silent (the ping handles audio); repeated messages from one conversation collapse into one. | Only when the tab/app is **hidden**. Requires permission — the prompt is requested once, the first time the user lands on /messages. Same mute rules as NTF-1. | Clicking the notification focuses the app and navigates to /messages. |
| NTF-3 | Tab-title flash | Browser tab title | Alternates every 1.5 s between the normal title and "(N) New message · <title>", N = messages since last focus. | Runs even when the tab is visible-but-unfocused. Stops and resets the moment the tab regains focus. | — |
| NTF-4 | Unread badges | Count badges | (a) Chats tab pill = total unread; (b) per-conversation badge in the rail; (c) People button badge in the top strip (caps at "9+"); (d) per-person badge in the People drawer. | All clear for a conversation the moment it's opened (synced across devices). | — |
| NTF-5 | Missed-call badge | Count badge | Red pill on the Calls tab and its Missed sub-tab = number of missed incoming calls in the loaded log. | — | — |
| NTF-6 | Toasts | Transient banners | Success / error / info / warning messages listed throughout this spec. | Auto-dismiss after ~4 seconds; multiple can stack. | — |
| NTF-7 | Notification bell (top strip) | Icon button + panel | Lab operational alerts (not chat): critical value, sample rejected, report ready, TAT breach, result rejected. Bell shakes while unread exist; badge caps at "99+". | Panel loads fresh on open; closes on outside click or Esc. | Clicking a row marks it read (unread dot clears); "Mark all read" clears every unread at once. Empty state: "You're all caught up". |
| NTF-8 | Reconnecting banner | Status banner | See RAIL-1 — shown on /messages whenever chat or call connectivity is down. | Automatic. | — |

**Flows across surfaces**
1. Colleague messages me while I'm on the Lab screen with the tab focused → ping sounds, tab title starts flashing, People button badge increments; no OS notification (tab visible).
2. Same message with the app minimised → ping + OS notification; clicking it brings the app up on /messages.
3. I mute a busy group → no more pings/notifications from it, but its unread badge still counts up, and an @mention of me still pings and notifies.
4. I toggle the rail's mute-sounds bell → message pings AND call ringtone/ringback go silent everywhere; badges, banners, OS notifications, and toasts are unaffected; the setting survives reload on that device.

---

## Appendix — Control index

Every control ID in this document, with its screen and label, for unambiguous reference in bug reports.

| ID | Screen | Label |
|---|---|---|
| LGN-1 | Sign in | Organization |
| LGN-2 | Sign in | Username |
| LGN-3 | Sign in | Password (+ eye toggle) |
| LGN-4 | Sign in | Sign in |
| LGN-5 | Sign in | Error banner |
| LGN-6 | Sign in | "Locked out?" hint |
| LGN-7 | Sign in | API host strip (native) |
| SPW-1 | Choose a new password | New password |
| SPW-2 | Choose a new password | Confirm password |
| SPW-3 | Choose a new password | Set password & continue |
| SPW-4 | Choose a new password | Sign in as a different user |
| SPW-5 | Choose a new password | Error banner |
| TOP-1 | Desktop top bar | Prefrontal brand lockup |
| TOP-2 | Desktop top bar | Tenant/client brand pill |
| TOP-3 | Desktop top bar | Primary nav |
| TOP-4 | Desktop top bar | Branch pill |
| TOP-5 | Desktop top bar | Branch switcher popover |
| TOP-6 | Desktop top bar | Scan order QR |
| TOP-7 | Desktop top bar | Admin (gear) |
| TOP-8 | Desktop top bar | People |
| TOP-9 | Desktop top bar | Notifications bell |
| TOP-10 | Desktop top bar | Notifications panel |
| TOP-11 | Desktop top bar | Profile avatar |
| TOP-12 | Desktop top bar | Profile header |
| TOP-13 | Desktop top bar | Status row |
| TOP-14 | Desktop top bar | Status presets list |
| TOP-15 | Desktop top bar | Tenant branding |
| TOP-16 | Desktop top bar | Switch to light / dark |
| TOP-17 | Desktop top bar | Sign out |
| NAV-1 | Mobile & tablet nav | Workflow tabs |
| NAV-2 | Mobile & tablet nav | Drag-to-switch gesture |
| NAV-3 | Mobile & tablet nav | Admin tab |
| NAV-4 | Mobile & tablet nav | Rail brand mark |
| NAV-5 | Mobile & tablet nav | Notifications (rail/menu) |
| NAV-6 | Mobile & tablet nav | People (rail/menu) |
| NAV-7 | Mobile & tablet nav | Account button |
| NAV-8 | Mobile & tablet nav | Status row + presets |
| NAV-9 | Mobile & tablet nav | Notifications / People rows (phone) |
| NAV-10 | Mobile & tablet nav | Theme |
| NAV-11 | Mobile & tablet nav | Branch |
| NAV-12 | Mobile & tablet nav | Sign out |
| NAV-13 | Mobile & tablet nav | Auto-minimize |
| NAV-14 | Mobile & tablet nav | Keyboard/chat hiding |
| NAV-15 | Mobile & tablet nav | Edge swipe back |
| SHL-1 | Shell-global | Offline banner |
| SHL-2 | Shell-global | Toasts |
| SHL-3 | Shell-global | Barcode scanner modal |
| SHL-4 | Shell-global | Dialog host |
| SHL-5 | Shell-global | Call overlay & People drawer |
| SHL-6 | Shell-global | Patient profile modal |
| SHL-7 | Shell-global | Route-level access handling |
| SHL-8 | Shell-global | Stale-permission refresh |
| FDL-1 | Frontdesk landing & board | Patient search |
| FDL-2 | Frontdesk landing & board | Clear (×) in search |
| FDL-3 | Frontdesk landing & board | ↑/↓/Enter/Esc in search |
| FDL-4 | Frontdesk landing & board | Advanced-search icon (⌘K) |
| FDL-5 | Frontdesk landing & board | Scan QR |
| FDL-6 | Frontdesk landing & board | Book appointment |
| FDL-7 | Frontdesk landing & board | Create order |
| FDL-8 | Frontdesk landing & board | New patient (+) |
| FDL-9 | Frontdesk landing & board | New patient (empty-state CTA) |
| FDL-10 | Frontdesk landing & board | "N ready" alert chip |
| FDL-11 | Frontdesk landing & board | "N payments" alert chip |
| FDL-12 | Frontdesk landing & board | "N need follow-up" alert chip |
| FDL-13 | Frontdesk landing & board | STAT pinned row |
| FDL-14 | Frontdesk landing & board | In progress / Completed tabs |
| FDL-15 | Frontdesk landing & board | Date-range pills |
| FDL-16 | Frontdesk landing & board | Order card |
| FDL-17 | Frontdesk landing & board | Select checkbox |
| FDL-18 | Frontdesk landing & board | Card quick actions (Bill/Collect/Dispatch/Reprint Labels) |
| FDL-19 | Frontdesk landing & board | Bulk dispatch bar |
| FDL-20 | Frontdesk landing & board | Bulk comms bar |
| FDL-21 | Frontdesk landing & board | Order detail drawer |
| FDL-22 | Frontdesk landing & board | Drawer — Profile |
| FDL-23 | Frontdesk landing & board | Drawer — Repeat |
| FDL-24 | Frontdesk landing & board | Drawer — Invoice |
| FDL-25 | Frontdesk landing & board | Invoice preview modal |
| FDL-26 | Frontdesk landing & board | Drawer — Modify |
| FDL-27 | Frontdesk landing & board | Drawer — Report |
| FDL-28 | Frontdesk landing & board | Drawer — Labels |
| FDL-29 | Frontdesk landing & board | Drawer — Cancel |
| FDL-30 | Frontdesk landing & board | Cancel order dialog |
| FDL-31 | Frontdesk landing & board | Dispatch package modal |
| FDL-32 | Frontdesk landing & board | Ready-for-pickup drawer |
| FDL-33 | Frontdesk landing & board | Payments-due drawer |
| FDL-34 | Frontdesk landing & board | Collect (payments-due row) |
| FDL-35 | Frontdesk landing & board | Create Bill (order card) |
| FDL-36 | Frontdesk landing & board | Completed-tab Download |
| FDL-37 | Frontdesk landing & board | Appointment Check-in |
| APS-1 | Advanced patient search | Mobile number |
| APS-2 | Advanced patient search | Patient name |
| APS-3 | Advanced patient search | MRN |
| APS-4 | Advanced patient search | Age |
| APS-5 | Advanced patient search | Sex pills |
| APS-6 | Advanced patient search | Branch |
| APS-7 | Advanced patient search | Tests multiselect |
| APS-8 | Advanced patient search | Visit date pills |
| APS-9 | Advanced patient search | From date picker |
| APS-10 | Advanced patient search | To date picker |
| APS-11 | Advanced patient search | Clear |
| APS-12 | Advanced patient search | Search |
| APS-13 | Advanced patient search | Results row — patient name |
| APS-14 | Advanced patient search | View (row action) |
| APS-15 | Advanced patient search | Order (row action) |
| APS-16 | Advanced patient search | Book (row action) |
| APS-17 | Advanced patient search | Load N more |
| APS-18 | Advanced patient search | Close (×) / Esc / backdrop |
| REG-1 | Register patient | Back |
| REG-2 | Register patient | Step indicator |
| REG-3 | Register patient | Workflow fields |
| REG-4 | Register patient | ← Back (step footer) |
| REG-5 | Register patient | Next → |
| REG-6 | Register patient | Register patient |
| REG-7 | Register patient | Create Order |
| REG-8 | Register patient | Create Appointment |
| PPF-1 | Patient profile | Back chevron |
| PPF-2 | Patient profile | MRN badge |
| PPF-3 | Patient profile | MINOR badge |
| PPF-4 | Patient profile | Edit |
| PPF-5 | Patient profile | Phone value (tel link) |
| PPF-6 | Patient profile | Email value (mailto link) |
| PPF-7 | Patient profile | Guardian details block |
| PPF-8 | Patient profile | New Lab Order |
| PPF-9 | Patient profile | Book Appointment |
| PPF-10 | Patient profile | Send to Chat |
| PPF-11 | Patient profile | Merge Duplicate Into This Patient |
| PPF-12 | Patient profile | Print ID card |
| PPF-13 | Patient profile | Tab bar |
| PPF-14 | Patient profile | Overview KPI cards |
| PPF-15 | Patient profile | Vitals & BMI / Allergies (empty states) |
| PPF-16 | Patient profile | Fall Risk / Pediatric / Isolation rows |
| PPF-17 | Patient profile | ABHA Health Card + status pill |
| PPF-18 | Patient profile | Verify & Link ABHA Card |
| PPF-19 | Patient profile | Recent Lab Orders mini-list |
| PPF-20 | Patient profile | Active Medications mini-list |
| PPF-21 | Patient profile | Timeline event card |
| PPF-22 | Patient profile | Lab Orders tab — order card |
| PPF-23 | Patient profile | Repeat (per order card) |
| PPF-24 | Patient profile | OPD / IPD / Pharmacy tabs |
| PPF-25 | Patient profile | Documents tab (panel) |
| PPF-26 | Patient profile | Send-to-chat: search |
| PPF-27 | Patient profile | Send-to-chat: colleague row |
| PPF-28 | Patient profile | Send-to-chat: close (×) |
| PPF-29 | Patient profile | Send-to-chat: header |
| PPF-30 | Patient profile | Edit modal: First name |
| PPF-31 | Patient profile | Edit modal: Father's name |
| PPF-32 | Patient profile | Edit modal: Phone |
| PPF-33 | Patient profile | Edit modal: Email |
| PPF-34 | Patient profile | Edit modal: Sex |
| PPF-35 | Patient profile | Edit modal: Date of birth |
| PPF-36 | Patient profile | Edit modal: Age |
| PPF-37 | Patient profile | Edit modal: Blood group |
| PPF-38 | Patient profile | Edit modal: Cancel / × / backdrop |
| PPF-39 | Patient profile | Edit modal: Save changes |
| PPF-40 | Patient profile | Merge sheet: search |
| PPF-41 | Patient profile | Merge sheet: duplicate row |
| PPF-42 | Patient profile | Merge confirm dialog |
| PPF-43 | Patient profile | Merge execution |
| PPF-44 | Patient profile | Merge sheet: close (×) / backdrop |
| DOC-1 | Patient profile — Documents | Type |
| DOC-2 | Patient profile — Documents | Note (optional) |
| DOC-3 | Patient profile — Documents | Upload file |
| DOC-4 | Patient profile — Documents | Document tile |
| DOC-5 | Patient profile — Documents | Delete (trash) |
| DOC-6 | Patient profile — Documents | Empty state |
| QRP-1 | Patient QR open | Auto-redirect |
| ORD-1 | Build an order | Patient search |
| ORD-2 | Build an order | Attached patient tile |
| ORD-3 | Build an order | Change patient (pencil) |
| ORD-4 | Build an order | Cancel change (×) |
| ORD-5 | Build an order | Referring hospital |
| ORD-6 | Build an order | Clear hospital (×) |
| ORD-7 | Build an order | Referring doctor |
| ORD-8 | Build an order | Clear doctor (×) |
| ORD-9 | Build an order | Test search |
| ORD-10 | Build an order | Clear search (×) |
| ORD-11 | Build an order | Priority toggle |
| ORD-12 | Build an order | Category tabs |
| ORD-13 | Build an order | Test card |
| ORD-14 | Build an order | Star (☆/★) |
| ORD-15 | Build an order | Package card |
| ORD-16 | Build an order | A–Z index strip |
| ORD-17 | Build an order | Cart floating button |
| ORD-18 | Build an order | Clear (cart header) |
| ORD-19 | Build an order | Remove item (×) |
| ORD-20 | Build an order | "Save with a package" — Apply |
| ORD-21 | Build an order | Discount unit toggle (₹/%) |
| ORD-22 | Build an order | Discount amount |
| ORD-23 | Build an order | Totals block |
| ORD-24 | Build an order | TAT line |
| ORD-25 | Build an order | Proceed to billing / Update order & reconcile |
| ORD-26 | Build an order | Inline payment pane |
| ORD-27 | Build an order | Save as draft |
| ORD-28 | Build an order | Discard draft |
| ORD-29 | Build an order | Urgent badge |
| ORD-30 | Build an order | Invoice preview modal |
| PAY-1 | Build an order — payment pane | Payment mode tiles |
| PAY-2 | Build an order — payment pane | UPI mode |
| PAY-3 | Build an order — payment pane | Card mode — Reference no. |
| PAY-4 | Build an order — payment pane | Cash mode — num-pad + quick chips |
| PAY-5 | Build an order — payment pane | Wallet mode — vendor search + list |
| PAY-6 | Build an order — payment pane | Split mode — two rows |
| PAY-7 | Build an order — payment pane | Pay later — advance + tender chips |
| PAY-8 | Build an order — payment pane | Confirm button |
| PAY-9 | Build an order — payment pane | (behavior of Confirm) |
| PAY-10 | Build an order — payment pane | Paid state — Print invoice |
| PAY-11 | Build an order — payment pane | Paid state — Share on WhatsApp |
| PAY-12 | Build an order — payment pane | Paid state — Collect sample |
| PAY-13 | Build an order — payment pane | Paid state — New order |
| OQR-1 | Order QR router | Auto-redirect |
| SCOL-1 | Sample collection worklist | KPI strip |
| SCOL-2 | Sample collection worklist | Refresh |
| SCOL-3 | Sample collection worklist | Camera icon |
| SCOL-4 | Sample collection worklist | "Find patient or scan" |
| SCOL-5 | Sample collection worklist | Scan |
| SCOL-6 | Sample collection worklist | Find |
| SCOL-7 | Sample collection worklist | Pending-collection heading |
| SCOL-8 | Sample collection worklist | Patient card |
| SCOL-9 | Sample collection worklist | Empty state |
| SCOL-10 | Collect drawer | Backdrop / ✕ close |
| SCOL-11 | Collect drawer | Progress "n/m vials drawn" |
| SCOL-12 | Collect drawer | Vial tile |
| SCOL-13 | Collect drawer | Can't collect |
| SCOL-14 | Collect drawer | Print labels |
| SCOL-15 | Collect drawer | Status stamp |
| SCOL-16 | Collect drawer | Dispatch |
| SCOL-17 | Collect drawer | Undo dispatch |
| SCOL-18 | Collect drawer | Done / "Collect all to finish" |
| SCOL-19 | Sample collection worklist | Outsourced vial indicator |
| REJ-1 | Reject-with-reason dialog | Reason chips |
| REJ-2 | Reject-with-reason dialog | Notes |
| REJ-3 | Reject-with-reason dialog | Cancel |
| REJ-4 | Reject-with-reason dialog | Reject N tube(s) |
| SCAN-1 | Barcode scanner modal | Live status |
| SCAN-2 | Barcode scanner modal | Camera viewfinder |
| SCAN-3 | Barcode scanner modal | HID scanner buffer |
| SCAN-4 | Barcode scanner modal | Enter manually / Use camera |
| SCAN-5 | Barcode scanner modal | Scan match rule |
| SCAN-6 | Barcode scanner modal | Manual 5-digit sequence |
| SCAN-7 | Barcode scanner modal | Confirm |
| SCAN-8 | Barcode scanner modal | Cancel / ✕ / backdrop |
| QUE-1 | Collection queue | "N waiting · ~Xm avg" |
| QUE-2 | Collection queue | Refresh |
| QUE-3 | Collection queue | + Walk-in / Close |
| QUE-4 | Collection queue | Walk-in patient search |
| QUE-5 | Collection queue | Section headers |
| QUE-6 | Collection queue | Queue row |
| QUE-7 | Collection queue | Priority score chip |
| QUE-8 | Collection queue | Check in |
| QUE-9 | Collection queue | No-show |
| QUE-10 | Collection queue | Call |
| QUE-11 | Collection queue | Urgent |
| QUE-12 | Collection queue | Skip |
| QUE-13 | Collection queue | Complete |
| HCA-1 | Unassigned home collections | Refresh |
| HCA-2 | Unassigned home collections | No-agents banner |
| HCA-3 | Unassigned home collections | Request card |
| HCA-4 | Unassigned home collections | Choose agent |
| HCA-5 | Unassigned home collections | Assign |
| HCA-6 | Unassigned home collections | Empty state |
| HCV-1 | My visits | Refresh |
| HCV-2 | My visits | Visit card |
| HCV-3 | My visits | Phone number (tap-to-call) |
| HCV-4 | My visits | Directions ↗ |
| HCV-5 | My visits | Check in & collect |
| HCV-6 | My visits | Collect samples |
| HCV-7 | My visits | Complete visit |
| HCV-8 | My visits | Empty state |
| AGT-1 | Home-collection agents | + Add agent / Cancel |
| AGT-2 | Home-collection agents | Agent (staff member) |
| AGT-3 | Home-collection agents | Coverage |
| AGT-4 | Home-collection agents | Pincodes |
| AGT-5 | Home-collection agents | Centre latitude |
| AGT-6 | Home-collection agents | Centre longitude |
| AGT-7 | Home-collection agents | Radius (km) |
| AGT-8 | Home-collection agents | Weight |
| AGT-9 | Home-collection agents | Cancel (form footer) |
| AGT-10 | Home-collection agents | Save agent |
| AGT-11 | Home-collection agents | Agent card |
| AGT-12 | Home-collection agents | Edit |
| AGT-13 | Home-collection agents | Remove |
| AGT-14 | Home-collection agents | Empty state |
| MW-1 | Lab — My Work | Stats (phone) |
| MW-2 | Lab — My Work | Refresh |
| MW-3 | Lab — My Work | Counter pills |
| MW-4 | Lab — My Work | Scan barcode / type sample ID |
| MW-5 | Lab — My Work | Manual entry / Close manual |
| MW-6 | Lab — My Work | Open (arrow) |
| MW-7 | Lab — My Work | Camera (scan) |
| MW-8 | Lab — My Work | Manual: Department |
| MW-9 | Lab — My Work | Manual: sequence number |
| MW-10 | Lab — My Work | Manual numpad |
| MW-11 | Lab — My Work | Manual: Open |
| MW-12 | Lab — My Work | Preview code |
| MW-13 | Lab — My Work | Lab Intake — inline scan bar |
| MW-14 | Lab — My Work | Intake search magnifier (phone) |
| MW-15 | Lab — My Work | Intake / My Work / Queue (phone tabs) |
| MW-16 | Lab — My Work | My Work / Queue (desktop tabs) |
| MW-17 | Lab — My Work | Show claimed |
| MW-18 | Lab — My Work | Splitter handle |
| MW-19 | Lab — My Work | Patient group card |
| MW-20 | Lab — My Work | Open tube / Re-enter tube |
| MW-21 | Lab — My Work | Delegate (My Work) |
| MW-22 | Lab — My Work | Pick · view tests (Queue) |
| MW-23 | Lab — My Work | Delegate (Queue) |
| MW-24 | Lab — My Work | Rejection banner |
| MW-25 | Lab — My Work | Claim popup — claim button |
| MW-26 | Lab — My Work | Claim popup — close |
| MW-27 | Lab — My Work | Claim scan gate |
| MW-28 | Lab — My Work | Legacy flat grid (hidden) |
| SRE-1 | Sample-level result entry | Back |
| SRE-2 | Sample-level result entry | Grid / Form view toggle |
| SRE-3 | Sample-level result entry | Save draft |
| SRE-4 | Sample-level result entry | Submit all results |
| SRE-5 | Sample-level result entry | Undo submit & edit |
| SRE-6 | Sample-level result entry | Reject banner |
| SRE-7 | Sample-level result entry | + Note / Notes (N) |
| SRE-8 | Sample-level result entry | Numeric result field |
| SRE-9 | Sample-level result entry | Text result field |
| SRE-10 | Sample-level result entry | Dropdown result field |
| SRE-11 | Sample-level result entry | Textarea result field |
| SRE-12 | Sample-level result entry | Checkbox result field |
| SRE-13 | Sample-level result entry | Date result field |
| SRE-14 | Sample-level result entry | Reference-range / normal hint |
| SRE-15 | Sample-level result entry | Parameter flag + red border |
| SRE-16 | Sample-level result entry | Per-parameter comment thread |
| SRE-17 | Sample-level result entry | "No parameter schema" notice |
| SRE-18 | Sample-level result entry | Culture entry (embedded) |
| SRE-19 | Sample-level result entry | Flags list (post-submit) |
| RE-1 | Per-test result entry | Back |
| RE-2 | Per-test result entry | Autosave indicator |
| RE-3 | Per-test result entry | Reject |
| RE-4 | Per-test result entry | Save draft |
| RE-5 | Per-test result entry | Submit / Submit · notify |
| RE-6 | Per-test result entry | Progress header |
| RE-7 | Per-test result entry | Grid / Cards view toggle |
| RE-8 | Per-test result entry | Reject/sent-back banner |
| RE-9 | Per-test result entry | Numeric field |
| RE-10 | Per-test result entry | Dropdown / radio / yes-no |
| RE-11 | Per-test result entry | Chips-multi |
| RE-12 | Per-test result entry | Button-select |
| RE-13 | Per-test result entry | Toggle / checkbox |
| RE-14 | Per-test result entry | Date / time / datetime |
| RE-15 | Per-test result entry | Phone / email |
| RE-16 | Per-test result entry | Duration |
| RE-17 | Per-test result entry | Size |
| RE-18 | Per-test result entry | Measure (slider) |
| RE-19 | Per-test result entry | Image-select |
| RE-20 | Per-test result entry | Voice-text |
| RE-21 | Per-test result entry | File upload |
| RE-22 | Per-test result entry | Image gallery |
| RE-23 | Per-test result entry | Canvas (signature/scribble) |
| RE-24 | Per-test result entry | Stub (Tier-3 widgets) |
| RE-25 | Per-test result entry | Inline validation error |
| RE-26 | Per-test result entry | Notes |
| RE-27 | Per-test result entry | Right-rail helper |
| RE-28 | Per-test result entry | Next empty |
| RE-29 | Per-test result entry | Clear (rail) |
| RE-30 | Per-test result entry | Mobile rail FAB |
| RE-31 | Per-test result entry | Patient + TAT strip |
| CUL-1 | Culture & sensitivity | Specimen |
| CUL-2 | Culture & sensitivity | Colony count |
| CUL-3 | Culture & sensitivity | No growth |
| CUL-4 | Culture & sensitivity | Gram stain |
| CUL-5 | Culture & sensitivity | + Add organism |
| CUL-6 | Culture & sensitivity | Organism name |
| CUL-7 | Culture & sensitivity | + Add antibiotic |
| CUL-8 | Culture & sensitivity | Measure (camera plate) |
| CUL-9 | Culture & sensitivity | Remove organism |
| CUL-10 | Culture & sensitivity | Antibiotic name |
| CUL-11 | Culture & sensitivity | Zone (mm) |
| CUL-12 | Culture & sensitivity | S / I / R buttons |
| CUL-13 | Culture & sensitivity | "auto" tag |
| CUL-14 | Culture & sensitivity | Remove antibiotic (×) |
| CUL-15 | Culture & sensitivity | Resistance / notes textareas |
| CUL-16 | Culture & sensitivity | Plate photo thumbnail |
| PLM-1 | Plate measure dialog | Full screen toggle |
| PLM-2 | Plate measure dialog | Close (×) / backdrop |
| PLM-3 | Plate measure dialog | Capture / Take photo |
| PLM-4 | Plate measure dialog | Choose file / gallery |
| PLM-5 | Plate measure dialog | Pan / Zoom / Fit |
| PLM-6 | Plate measure dialog | Undo / Redo |
| PLM-7 | Plate measure dialog | Clear all |
| PLM-8 | Plate measure dialog | Got it (hint) |
| PLM-9 | Plate measure dialog | Search antibiotics |
| PLM-10 | Plate measure dialog | Unassign (×) |
| PLM-11 | Plate measure dialog | Dish diameter (mm) |
| PLM-12 | Plate measure dialog | Re-tap rim |
| PLM-13 | Plate measure dialog | Measure → |
| PLM-14 | Plate measure dialog | Auto-detect dish + zones |
| PLM-15 | Plate measure dialog | Recalibrate |
| PLM-16 | Plate measure dialog | Retake |
| PLM-17 | Plate measure dialog | Re-detect |
| PLM-18 | Plate measure dialog | Smart-fill |
| PLM-19 | Plate measure dialog | Apply N zones |
| DEL-1 | Delegate modal | Search by name or email |
| DEL-2 | Delegate modal | User row |
| DEL-3 | Delegate modal | Close (×) / backdrop |
| DEL-4 | Delegate modal | Empty / loading state |
| CMT-1 | Comment thread | + Add Observation / Correction |
| CMT-2 | Comment thread | Composer textarea |
| CMT-3 | Comment thread | Post observation / correction |
| CMT-4 | Comment thread | Cancel |
| CMT-5 | Comment thread | Reply |
| CMT-6 | Comment thread | Send reply |
| CMT-7 | Comment thread | "Awaiting your reply" banner |
| CMT-8 | Comment thread | Type / role / resolved pills |
| PV-1 | Pending validation queue | My queue / All pathologists |
| PV-2 | Pending validation queue | Refresh |
| PV-3 | Pending validation queue | KPI strip |
| PV-4 | Pending validation queue | Urgency buckets |
| PV-5 | Pending validation queue | Patient/order card |
| PV-6 | Pending validation queue | Empty state |
| VR-1 | Validate result | Back |
| VR-2 | Validate result | Patient/context strip |
| VR-3 | Validate result | Sent-back banner |
| VR-4 | Validate result | Overall conversation |
| VR-5 | Validate result | Culture review (read-only) |
| VR-6 | Validate result | Summary strip |
| VR-7 | Validate result | Cards / Table view toggle |
| VR-8 | Validate result | Parameter card |
| VR-9 | Validate result | Parameter row |
| VR-10 | Validate result | Range bar + pin |
| VR-11 | Validate result | Per-parameter comment thread |
| VR-12 | Validate result | Detail drawer |
| VR-13 | Validate result | Clinical comment |
| VR-14 | Validate result | Edit values |
| VR-15 | Validate result | Cancel (edit mode) |
| VR-16 | Validate result | Save changes (edit mode) |
| VR-17 | Validate result | Reject |
| VR-18 | Validate result | Reassign |
| VR-19 | Validate result | Validate / Validate · notify |
| RQ-1 | Report queue | KPI strip |
| RQ-2 | Report queue | Refresh |
| RQ-3 | Report queue | Queue stats icon (phone) |
| RQ-4 | Report queue | Generate |
| RQ-5 | Report queue | Stats bar (desktop) |
| RQ-6 | Report queue | Search box |
| RQ-7 | Report queue | Clear search (×) |
| RQ-8 | Report queue | Status filter |
| RQ-9 | Report queue | Filter icons (phone) |
| RQ-10 | Report queue | Partial order card header |
| RQ-11 | Report queue | Result rows in partial card |
| RQ-12 | Report queue | "Still pending" line |
| RQ-13 | Report queue | Generate partial PDF |
| RQ-14 | Report queue | Report row |
| RQ-15 | Report queue | Download |
| RQ-16 | Report queue | View |
| RQ-17 | Report queue | WhatsApp |
| RQ-18 | Report queue | Print |
| RV-1 | Report viewer | Print |
| RV-2 | Report viewer | Share with… |
| RV-3 | Report viewer | Send WhatsApp |
| RV-4 | Report viewer | Share dialog — search |
| RV-5 | Report viewer | Share dialog — colleague row |
| RV-6 | Report viewer | Share dialog — close |
| RV-7 | Report viewer | Status strip |
| RV-8 | Report viewer | Preliminary banner |
| RV-9 | Report viewer | Report paper |
| PUB-1 | Public report viewer | Identity input |
| PUB-2 | Public report viewer | Open report |
| PUB-3 | Public report viewer | Inline PDF frame |
| PUB-4 | Public report viewer | Open in new tab ↗ |
| TRK-1 | Result tracking | Identity input |
| TRK-2 | Result tracking | View status |
| TRK-3 | Result tracking | Status timeline |
| TRK-4 | Result tracking | Rejected-sample banner |
| TRK-5 | Result tracking | Pay ₹ via UPI |
| TRK-6 | Result tracking | UPI QR image |
| TRK-7 | Result tracking | View report |
| BILL-1 | Collect payment | Front desk collects payment |
| BILL-2 | Collect payment | Save draft |
| BILL-3 | Collect payment | Discard |
| BILL-4 | Collect payment | Cancel |
| BILL-5 | Collect payment | Back |
| BILL-6 | Collect payment | Print invoice |
| BILL-7 | Collect payment | Invoice number |
| BILL-8 | Collect payment | Due amount |
| BILL-9 | Collect payment | Invoice barcode |
| BILL-10 | Collect payment | Patient Portal QR |
| BILL-11 | Collect payment | Line items list |
| BILL-12 | Collect payment | Subtotal / GST rows |
| BILL-13 | Collect payment | Discount unit toggle (₹/%) |
| BILL-14 | Collect payment | Discount input |
| BILL-15 | Collect payment | Total row |
| BILL-16 | Collect payment | Already paid / Balance due / Refund due |
| BILL-17 | Collect payment | Refund mode chips |
| BILL-18 | Collect payment | Refund ₹X |
| BILL-19 | Collect payment | TAT line |
| BILL-20 | Collect payment | Payment mode tiles |
| BILL-21 | Collect payment | UPI panel |
| BILL-22 | Collect payment | Card panel |
| BILL-23 | Collect payment | Cash received display |
| BILL-24 | Collect payment | Quick cash chips |
| BILL-25 | Collect payment | Change indicator |
| BILL-26 | Collect payment | Cash numpad |
| BILL-27 | Collect payment | Wallet vendor search |
| BILL-28 | Collect payment | Wallet vendor row |
| BILL-29 | Collect payment | Selected vendor card + Change |
| BILL-30 | Collect payment | Split panel: Reference no. |
| BILL-31 | Collect payment | Confirm payment · ₹X |
| BILL-32 | Collect payment | Pay later panel |
| BILL-33 | Collect payment | Payment received dialog |
| BILL-34 | Collect payment | Print invoice (dialog) |
| BILL-35 | Collect payment | Send on WhatsApp |
| BILL-36 | Collect payment | Done (dialog) |
| BILL-37 | Collect payment | Dialog backdrop click |
| CNTR-1 | Billing counter | Find & bill / Money switch |
| CNTR-2 | Billing counter | Patient search |
| CNTR-3 | Billing counter | Patient result row |
| CNTR-4 | Billing counter | Invoice / order ID input |
| CNTR-5 | Billing counter | Open |
| CNTR-6 | Billing counter | Scan |
| CNTR-7 | Billing counter | Unbilled order row + Process payment |
| CNTR-8 | Billing counter | Resting empty state |
| CNTR-9 | Billing counter | Due list |
| CNTR-10 | Billing counter | Refunds owed list |
| CNTR-11 | Billing counter | Business day date picker |
| CNTR-12 | Billing counter | Day-end summary table |
| CNTR-13 | Billing counter | KPI strip |
| AINV-1 | Admin inventory | Back (chevron) |
| AINV-2 | Admin inventory | New item |
| AINV-3 | Admin inventory | Low stock alert card |
| AINV-4 | Admin inventory | Expiring soon alert card |
| AINV-5 | Admin inventory | SKU * |
| AINV-6 | Admin inventory | Name * |
| AINV-7 | Admin inventory | Category |
| AINV-8 | Admin inventory | Unit (UoM) |
| AINV-9 | Admin inventory | Reorder level |
| AINV-10 | Admin inventory | Near-expiry (days) |
| AINV-11 | Admin inventory | Active |
| AINV-12 | Admin inventory | Save (item form) |
| AINV-13 | Admin inventory | Cancel (item form) |
| AINV-14 | Admin inventory | Items table |
| AINV-15 | Admin inventory | Receive (row) |
| AINV-16 | Admin inventory | Lot # |
| AINV-17 | Admin inventory | Expiry |
| AINV-18 | Admin inventory | Unit cost |
| AINV-19 | Admin inventory | Qty * |
| AINV-20 | Admin inventory | Add stock |
| AINV-21 | Admin inventory | Label (row) |
| AINV-22 | Admin inventory | Both / Barcode / QR |
| AINV-23 | Admin inventory | Label preview |
| AINV-24 | Admin inventory | Print label |
| AINV-25 | Admin inventory | Hide (label block) |
| AINV-26 | Admin inventory | Batches (row) |
| AINV-27 | Admin inventory | − (minus) per batch |
| AINV-28 | Admin inventory | ＋ (plus) per batch |
| AINV-29 | Admin inventory | Edit (row) |
| AINV-30 | Admin inventory | Select a test… (BOM) |
| AINV-31 | Admin inventory | Item… (BOM line) |
| AINV-32 | Admin inventory | qty/test (BOM line) |
| AINV-33 | Admin inventory | ✕ (remove BOM line) |
| AINV-34 | Admin inventory | + Add item (BOM) |
| AINV-35 | Admin inventory | Save consumables |
| STO-1 | Stores / inventory desk | Header "Stores · branch" |
| STO-2 | Stores / inventory desk | "Listening for scanner" pill |
| STO-3 | Stores / inventory desk | Overview tab |
| STO-4 | Stores / inventory desk | Receive tab |
| STO-5 | Stores / inventory desk | Issue / Consume tab |
| STO-6 | Stores / inventory desk | Stock count tab |
| STO-7 | Stores / inventory desk | KPI strip |
| STO-8 | Stores / inventory desk | Search items by name or SKU |
| STO-9 | Stores / inventory desk | All / In stock / Low / Out chips |
| STO-10 | Stores / inventory desk | Stock table |
| STO-11 | Stores / inventory desk | Low stock card |
| STO-12 | Stores / inventory desk | Expiring soon card |
| STO-13 | Stores / inventory desk | Scan/search box (+ HID capture) |
| STO-14 | Stores / inventory desk | Resolve |
| STO-15 | Stores / inventory desk | Camera (icon) |
| STO-16 | Stores / inventory desk | Item picker |
| STO-17 | Stores / inventory desk | "Last read:" line |
| STO-18 | Stores / inventory desk | Resolved item card |
| STO-19 | Stores / inventory desk | Lot # (Receive) |
| STO-20 | Stores / inventory desk | Expiry (Receive) |
| STO-21 | Stores / inventory desk | Unit cost (Receive) |
| STO-22 | Stores / inventory desk | Qty * (Receive) |
| STO-23 | Stores / inventory desk | Receive stock |
| STO-24 | Stores / inventory desk | Both / Barcode / QR (label) |
| STO-25 | Stores / inventory desk | Label preview |
| STO-26 | Stores / inventory desk | Print label |
| STO-27 | Stores / inventory desk | Qty to issue * |
| STO-28 | Stores / inventory desk | Issue (FEFO) |
| STO-29 | Stores / inventory desk | Count rows (per batch) |
| STO-30 | Stores / inventory desk | Camera scanner modal |
| RLAB-1 | Referral labs | Add referral lab / Cancel |
| RLAB-2 | Referral labs | Name * |
| RLAB-3 | Referral labs | Code |
| RLAB-4 | Referral labs | Contact name |
| RLAB-5 | Referral labs | Contact phone |
| RLAB-6 | Referral labs | Contact email |
| RLAB-7 | Referral labs | Address |
| RLAB-8 | Referral labs | Departments handled |
| RLAB-9 | Referral labs | Cancel (form footer) |
| RLAB-10 | Referral labs | Create referral lab / Save changes |
| RLAB-11 | Referral labs | Edit (per card) |
| RLAB-12 | Referral labs | Deactivate / Reactivate |
| LBL-1 | Post-payment label printing | ⇗ <lab name> badge |
| RPT-1 | Report paper (viewer/PDF) | "Tested at: <referral lab>" |
| LSET-1 | Lab settings | Billing / Collection chips |
| LSET-2 | Lab settings | "Edit in Workflow →" |
| LSET-3 | Lab settings | Patient ID format master toggle |
| LSET-4 | Lab settings | Date prefix |
| LSET-5 | Lab settings | Separator |
| LSET-6 | Lab settings | Number digits / Min number digits |
| LSET-7 | Lab settings | Prefix (optional) |
| LSET-8 | Lab settings | Include letters |
| LSET-9 | Lab settings | Letters |
| LSET-10 | Lab settings | Save format |
| LSET-11 | Lab settings | Sample ID — Number width |
| LSET-12 | Lab settings | Allow no-scan claim |
| LSET-13 | Lab settings | Enable inventory |
| LSET-14 | Lab settings | Require payment before sharing report |
| LSET-15 | Lab settings | Require validation for all results |
| LSET-16 | Lab settings | Enable auto-assign for this branch |
| LSET-17 | Lab settings | Per-department "People" |
| LSET-18 | Lab settings | Per-department "Roles" |
| LSET-19 | Lab settings | Department empty warning |
| LSET-20 | Lab settings | Wipe Patient Data |
| TST-1 | Tests catalog | Create test / Create package |
| TST-2 | Tests catalog | Tab strip |
| TST-3 | Tests catalog | Search box |
| TST-4 | Tests catalog | Count line |
| TST-5 | Tests catalog | Department card |
| TST-6 | Tests catalog | "All departments" breadcrumb |
| TST-7 | Tests catalog | Test row |
| TST-8 | Tests catalog | Package card |
| TST-9 | Tests catalog | Edit |
| PRC-1 | Tests catalog — Pricing | Department filter |
| PRC-2 | Tests catalog — Pricing | Search test name |
| PRC-3 | Tests catalog — Pricing | Bulk change % |
| PRC-4 | Tests catalog — Pricing | Apply to N filtered |
| PRC-5 | Tests catalog — Pricing | Per-row price input |
| PRC-6 | Tests catalog — Pricing | Save changes |
| PRC-7 | Tests catalog — Pricing | Discard |
| TED-1 | Test editor | Back |
| TED-2 | Test editor | Save |
| TED-3 | Test editor | Name |
| TED-4 | Test editor | Type |
| TED-5 | Test editor | Flow |
| TED-6 | Test editor | Department |
| TED-7 | Test editor | Sample type |
| TED-8 | Test editor | Price |
| TED-9 | Test editor | Tax slab |
| TED-10 | Test editor | TAT |
| TED-11 | Test editor | Outsource to |
| TED-12 | Test editor | Department at vendor |
| TED-13 | Test editor | Add parameter |
| TED-14 | Test editor | Parameter row header |
| TED-15 | Test editor | Remove parameter (×) |
| TED-16 | Test editor | Label (parameter) |
| TED-17 | Test editor | Type (field-type picker) |
| TED-18 | Test editor | Unit |
| TED-19 | Test editor | + Add range |
| TED-20 | Test editor | Range: Sex |
| TED-21 | Test editor | Range: Min age / Max age |
| TED-22 | Test editor | Range: Age unit |
| TED-23 | Test editor | Range: Normal min / max |
| TED-24 | Test editor | Remove range (×) |
| TED-25 | Test editor | Critical low / high |
| TED-26 | Test editor | Plausible low / high |
| TED-27 | Test editor | Options (comma-separated) |
| TED-28 | Test editor | Validation editor |
| TED-29 | Test editor | Conditional visibility |
| TED-30 | Test editor | Member count / total chips |
| TED-31 | Test editor | Search tests (package picker) |
| TED-32 | Test editor | Member checkbox rows |
| TED-33 | Test editor — layout | Version pill |
| TED-34 | Test editor — layout | Preview / Hide preview |
| TED-35 | Test editor — layout | Save layout |
| TED-36 | Test editor — layout | Section tabs + Add section |
| TED-37 | Test editor — layout | Section label / move / delete |
| TED-38 | Test editor — layout | Grid: spreadsheet |
| TED-39 | Test editor — layout | Paragraph: Template |
| TED-40 | Test editor — layout | Chart: Parameter / Min / Max / Zones |
| TED-41 | Test editor — layout | Image: Caption |
| TED-42 | Test editor — consumables | Item + qty/test + ✕ (per line) |
| TED-43 | Test editor — consumables | + Add item |
| TED-44 | Test editor — consumables | Save consumables |
| USR-1 | Users & access | Invite / Create role |
| USR-2 | Users & access | Tab strip |
| USR-3 | Users & access | Search name or email |
| USR-4 | Users & access | User row |
| USR-5 | Users & access | Call |
| USR-6 | Users & access | Deactivate |
| USR-7 | Users & access | Roles count line |
| USR-8 | Users & access | Role row |
| USR-9 | Users & access | Manage permissions |
| INV-1 | Invite user | Back |
| INV-2 | Invite user | Send invite |
| INV-3 | Invite user | First name |
| INV-4 | Invite user | Father's name |
| INV-5 | Invite user | Email |
| INV-6 | Invite user | Phone |
| INV-7 | Invite user | Role |
| INV-8 | Invite user | Scope |
| INV-9 | Invite user | Access method |
| INV-10 | Invite user | Password |
| ROL-1 | Role editor | Back |
| ROL-2 | Role editor | Save |
| ROL-3 | Role editor | Role name |
| ROL-4 | Role editor | Pre-seeded banner |
| ROL-5 | Role editor | Granted counter |
| ROL-6 | Role editor | Permission checkboxes |
| BRN-1 | Branches & departments | Add branch / Cancel |
| BRN-2 | Branches & departments | New branch fields |
| BRN-3 | Branches & departments | New branch: Create |
| BRN-4 | Branches & departments | New branch: Cancel |
| BRN-5 | Branches & departments | Branch header row |
| BRN-6 | Branches & departments | Add sub-branch |
| BRN-7 | Branches & departments | Sub-branch form: Save |
| BRN-8 | Branches & departments | Sub-branch form: Cancel |
| BRN-9 | Branches & departments | Sub-branch card |
| BRN-10 | Branches & departments | Deactivate (sub-branch) |
| BRN-11 | Branches & departments | Department pill |
| BRN-12 | Branches & departments | Sample # |
| BRN-13 | Branches & departments | Power icon / Deactivate–Reactivate |
| BRN-14 | Branches & departments | × (unassign) |
| BRN-15 | Branches & departments | "+ Assign dept" |
| BRN-16 | Branches & departments | Branch departments — Add |
| BRN-17 | Branches & departments | Add-department: Save / Cancel |
| BRN-18 | Branches & departments | "Assign →" |
| PWB-1 | Workflow builder | Branch scope select |
| PWB-2 | Workflow builder | Workflow select |
| PWB-3 | Workflow builder | + New |
| PWB-4 | Workflow builder | Duplicate |
| PWB-5 | Workflow builder | Set active |
| PWB-6 | Workflow builder | Save |
| PWB-7 | Workflow builder | Workflow name |
| PWB-8 | Workflow builder | Active / Unsaved badges |
| PWB-9 | Workflow builder | Palette |
| PWB-10 | Workflow builder | Work-area lane |
| PWB-11 | Workflow builder | Lane icon button |
| PWB-12 | Workflow builder | Lane name |
| PWB-13 | Workflow builder | ‹ / › (move lane) |
| PWB-14 | Workflow builder | × (delete work-area) |
| PWB-15 | Workflow builder | "Who" role strip |
| PWB-16 | Workflow builder | Per-action toggle |
| PWB-17 | Workflow builder | ＋ Add work-area |
| PWB-18 | Workflow builder | Navigation preview |
| PWB-19 | Workflow builder | Expand/collapse chevron (phone) |
| BCF-1 | Billing config | Save (header) |
| BCF-2 | Billing config | Tab strip |
| BCF-3 | Billing config | Enable GST |
| BCF-4 | Billing config | GST scope |
| BCF-5 | Billing config | Filing frequency |
| BCF-6 | Billing config | GSTIN per branch + Save |
| BCF-7 | Billing config | Allow discounts |
| BCF-8 | Billing config | Level 1 max % |
| BCF-9 | Billing config | Level 2 max % |
| BCF-10 | Billing config | Approval threshold % |
| BCF-11 | Billing config | Invoice prefix |
| BCF-12 | Billing config | Starting number |
| BCF-13 | Billing config | UPI address (VPA) / Payee name |
| BCF-14 | Billing config | Template style |
| BCF-15 | Billing config | Letterhead identity fields |
| BCF-16 | Billing config | Document type |
| BCF-17 | Billing config | Accent colour |
| BCF-18 | Billing config | Signatory / Jurisdiction / Bank / Declaration / Footer |
| BCF-19 | Billing config | Logo |
| BCF-20 | Billing config | Show logo / GSTIN / tracking QR |
| BCF-21 | Billing config | Save letterhead |
| BCF-22 | Billing config | Live preview pane |
| KPI-1 | KPI configuration | Back (chevron) |
| KPI-2 | KPI configuration | "Configure for" scope |
| KPI-3 | KPI configuration | Screen tabs |
| KPI-4 | KPI configuration | Catalog search |
| KPI-5 | KPI configuration | Catalog KPI row (＋ Add) |
| KPI-6 | KPI configuration | Assigned tile |
| KPI-7 | KPI configuration | Tile enable/disable toggle |
| KPI-8 | KPI configuration | Tile remove (×) |
| KPI-9 | KPI configuration | Drag handle |
| KPI-10 | KPI configuration | Discard |
| KPI-11 | KPI configuration | Save changes |
| MSGL-1 | Messages — locked screen | "Back to app" |
| RAIL-1 | Messages — rail | Reconnecting banner |
| RAIL-2 | Messages — rail | Mute-sounds bell |
| RAIL-3 | Messages — rail | "New" (+) |
| RAIL-4 | Messages — rail | "Chats" tab |
| RAIL-5 | Messages — rail | "Calls" tab |
| RAIL-6 | Messages — rail | "Search conversations" |
| RAIL-7 | Messages — rail | "Notes to self" |
| RAIL-8 | Messages — rail | Conversation row |
| RAIL-9 | Messages — rail | "Start one" (empty state) |
| CLOG-1 | Messages — Calls tab | "All" sub-tab |
| CLOG-2 | Messages — Calls tab | "Missed" sub-tab |
| CLOG-3 | Messages — Calls tab | Call row |
| CLOG-4 | Messages — Calls tab | Open chat |
| CLOG-5 | Messages — Calls tab | Call back |
| THR-1 | Messages — thread | Back (chevron) |
| THR-2 | Messages — thread | Header identity |
| THR-3 | Messages — thread | Context chip |
| THR-4 | Messages — thread | Search-in-conversation |
| THR-5 | Messages — thread | Mute conversation |
| THR-6 | Messages — thread | Voice call |
| THR-7 | Messages — thread | Group members |
| THR-8 | Messages — thread | Pinned strip |
| THR-9 | Messages — thread | Search bar input |
| THR-10 | Messages — thread | Message scroller |
| THR-11 | Messages — thread | System/call rows |
| THR-12 | Messages — thread | Message bubble |
| THR-13 | Messages — thread | Shared-record card |
| THR-14 | Messages — thread | Reaction pills |
| THR-15 | Messages — thread | Hover/tap action bar |
| THR-16 | Messages — thread | Reply |
| THR-17 | Messages — thread | Forward |
| THR-18 | Messages — thread | Pin / Unpin |
| THR-19 | Messages — thread | Edit (own messages) |
| THR-20 | Messages — thread | Delete (own messages) |
| THR-21 | Messages — thread | "Seen" line |
| THR-22 | Messages — thread | Typing indicator |
| CMP-1 | Messages — composer | Reply banner |
| CMP-2 | Messages — composer | Edit banner |
| CMP-3 | Messages — composer | Pending-attachment chip |
| CMP-4 | Messages — composer | "+" button (phone) |
| CMP-5 | Messages — composer | Attach (paperclip) |
| CMP-6 | Messages — composer | Share a patient |
| CMP-7 | Messages — composer | Emoji |
| CMP-8 | Messages — composer | Message box |
| CMP-9 | Messages — composer | @mention popover |
| CMP-10 | Messages — composer | Send |
| CMP-11 | Messages — composer | Microphone |
| CMP-12 | Messages — composer | Recording row |
| NEWC-1 | New chat / group modal | Title |
| NEWC-2 | New chat / group modal | Close / backdrop / Cancel |
| NEWC-3 | New chat / group modal | "Group name" |
| NEWC-4 | New chat / group modal | "Search people" |
| NEWC-5 | New chat / group modal | Person row |
| NEWC-6 | New chat / group modal | Footer count |
| NEWC-7 | New chat / group modal | "Open chat" / "Create group" |
| MEM-1 | Group members modal | Title |
| MEM-2 | Group members modal | Close (×) / backdrop |
| MEM-3 | Group members modal | Member row |
| MEM-4 | Group members modal | Remove (trash) |
| MEM-5 | Group members modal | "Leave group" |
| MEM-6 | Group members modal | "+ Add member" |
| ADDM-1 | Add-member sub-modal | "Search people" |
| ADDM-2 | Add-member sub-modal | Person row |
| ADDM-3 | Add-member sub-modal | Close (×) / backdrop |
| FWD-1 | Forward modal | Preview |
| FWD-2 | Forward modal | "Search a conversation" |
| FWD-3 | Forward modal | Destination row |
| FWD-4 | Forward modal | Close (×) / backdrop |
| RING-1 | Incoming-call ringer | Card identity |
| RING-2 | Incoming-call ringer | Decline |
| RING-3 | Incoming-call ringer | Accept |
| ORING-1 | Outgoing-call ringer | Card identity |
| ORING-2 | Outgoing-call ringer | Cancel |
| CALL-1 | Active-call screen | Minimise |
| CALL-2 | Active-call screen | Status pill |
| CALL-3 | Active-call screen | Timer |
| CALL-4 | Active-call screen | Connection chip |
| CALL-5 | Active-call screen | Remaining-time chip |
| CALL-6 | Active-call screen | In-call chat toggle |
| CALL-7 | Active-call screen | End (× in header) |
| CALL-8 | Active-call screen | Error banner |
| CALL-9 | Active-call screen | Participant tiles |
| CALL-10 | Active-call screen | In-call chat panel |
| CALL-11 | Active-call screen | Mute / Unmute |
| CALL-12 | Active-call screen | Add (invite) |
| CALL-13 | Active-call screen | End (red disc) |
| PILL-1 | Minimized call pill | Avatar + title + time |
| PILL-2 | Minimized call pill | Remaining chip |
| PILL-3 | Minimized call pill | Route badge |
| PILL-4 | Minimized call pill | Expand |
| PILL-5 | Minimized call pill | Mute / Unmute |
| PILL-6 | Minimized call pill | Add participant |
| PILL-7 | Minimized call pill | End |
| PPL-1 | People drawer | People button (top strip) |
| PPL-2 | People drawer | Header count |
| PPL-3 | People drawer | "Search people…" |
| PPL-4 | People drawer | Person row |
| PPL-5 | People drawer | Back (chat mode) |
| PPL-6 | People drawer | Call button (chat mode) |
| PPL-7 | People drawer | Message list (chat mode) |
| PPL-8 | People drawer | Composer (chat mode) |
| PPL-9 | People drawer | Close (×) / backdrop |
| NTF-1 | Notification surfaces | Message ping (sound) |
| NTF-2 | Notification surfaces | Browser (OS) notification |
| NTF-3 | Notification surfaces | Tab-title flash |
| NTF-4 | Notification surfaces | Unread badges |
| NTF-5 | Notification surfaces | Missed-call badge |
| NTF-6 | Notification surfaces | Toasts |
| NTF-7 | Notification surfaces | Notification bell (top strip) |
| NTF-8 | Notification surfaces | Reconnecting banner |

*End of specification.*












