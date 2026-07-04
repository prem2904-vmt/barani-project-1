# Prefrontal LMS — Product & Workflow Guide

**The official guide to how the application works, organized by the people who use it.**

This guide is for the team and for anyone onboarding — new staff at a customer lab, new engineers, support, sales, and implementation. It explains what the product does, how each role experiences it, and the rules the system enforces. It complements the QA test guide: that document tells you how to *verify* behaviour; this one tells you how the product is *meant to work* and why.

---

## 1. What the product is

Prefrontal LMS is a laboratory management system for diagnostic labs. It runs the entire journey of a patient's visit, from the moment they walk in to the moment their report reaches their phone — and it runs the lab's own operations around that journey: billing and GST, sample logistics, result quality control, inventory, home collection, staff communication, and multi-branch administration.

**The pipeline, in plain words:**

1. **A patient arrives** — walk-in, appointment, or a booked home visit.
2. **They are registered** — once, for life. The system assigns a permanent MRN (medical record number); returning patients are found by name, phone, MRN, or by scanning their ID-card QR.
3. **An order is created** — the front desk picks tests and packages from the lab's catalogue. The system prices the cart, applies GST if configured, suggests cheaper packages, and estimates when the report will be ready.
4. **Payment happens** — inline at the front desk, or at a separate billing counter, or deferred ("pay later" with an optional advance). Every order gets an invoice with a tracking QR the patient can scan to follow their own progress.
5. **Samples are collected** — the order automatically splits into one barcoded tube per department. A phlebotomist (at the counter, at the front desk, or in the patient's home) taps each vial off as it is drawn.
6. **Samples reach the lab** — dispatched and received, or received instantly on short workflows. The TAT (turnaround time) clock starts.
7. **Results are entered** — a lab technician claims the tube by scanning its barcode and keys in values. The system blocks implausible entries and flags every value High / Low / Critical against reference ranges matched to the patient's age and sex.
8. **Results are validated** — a pathologist reviews, comments, and signs off (or rejects back to the technician with a reason). The person who entered a result can never validate it, unless the lab deliberately grants that override.
9. **The report is delivered** — generated automatically the moment the last test is validated, then shared by WhatsApp, print, in-app, or through the patient's own tracking link. Corrections after release automatically produce a clearly-marked amended report.

**The flow is admin-configurable.** This pipeline is the default, not a straitjacket. Every lab's administrator uses the **Process Builder** to decide which stages exist, what they are called, who works in them, and where they happen — billing at the front desk or at a separate counter, collection at reception or a dedicated phlebotomy station, dispatch and lab intake present or skipped entirely. When an admin changes the workflow, the navigation, screens, and buttons of every staff member reshape to match. Two labs running Prefrontal can look meaningfully different, on purpose.

The same application runs on the web, on desktop, and as a native phone app — with built-in staff chat, voice calls, and push notifications, so a small lab needs no second tool to coordinate.

---

## 2. Getting in

### Organizations, accounts, and the three-field sign-in

Prefrontal is multi-tenant: every lab company is a walled-off **organization**, and every user belongs to exactly one. Signing in therefore takes **three things: Organization + Username + Password**. The organization field accepts the org's short slug, its full name, or its organization ID. The username field accepts either a username or the person's email address — invited staff simply use their email. The same real email can hold accounts in different organizations without conflict.

There is no self-registration and no self-service password *reset* — a forgotten password always goes through an admin. The login screen says it plainly: *"Locked out? Ask your admin."* While signed in, though, anyone can **change** their own password at any time from the profile menu — nobody is stuck with an admin-set password.

### How accounts come to exist

- **The first account — the Lab Admin** — is created by the Prefrontal platform team when the organization is onboarded. Provisioning also creates a Main Branch, default departments, a starter test catalogue, and workflow templates, so a new org is never empty on day one. The admin receives a "Your workspace is ready" email with a temporary password and a sign-in link that pre-fills the organization and username — they only type the temp password.
- **Every subsequent employee** is invited from inside the app (Admin → Users & Access) by anyone holding the manage-users permission. The inviter picks a role and a branch scope, then either sends an email invite (the person sets their own password) or types a password to share personally.

### Day one for a brand-new user

1. Open the app, enter organization + username + password, press Sign in.
2. If the account carries a **temporary password** (a provisioned admin, or after a platform reset), the app holds you on a **Set a new password** screen — every other page is blocked, server-side, until you finish. Passwords are 8–64 characters, and any password found in known data breaches is rejected outright.
3. Once through, you land on the screen your role can actually use: admins land in Admin, receptionists at the Front Desk, technicians in the Lab, pathologists in Validate, collectors on the collection counter, store staff on the Inventory desk, managers on the TAT board. The navigation shows only your permitted work areas. (One known exception: a pure Billing Counter login has no natural landing page and may see "no access" at the app root — see §4.2 for the workaround.)
4. Your session survives app restarts; tokens renew quietly in the background for as long as you keep using the app.
5. Signing out lives in the profile menu. It ends the session on that device and de-registers it from push notifications — which is why a shared iPad stops receiving the previous user's messages.

### Branches

Organizations can have multiple **branches**, and branches can have **sub-branches** (a specific lab, collection centre, or satellite within a branch). When a role is assigned to a user it carries a scope: all branches, one branch, or one sub-branch. Multi-branch users get a **branch switcher** in the top strip; picking a branch fully reloads the app scoped to it, so no data from the previous branch lingers. Single-branch users see their branch name but no switcher — and the server validates every request's branch against their grants, so an unauthorized branch can never be smuggled in.

Failed sign-ins are rate-limited (five attempts, then growing waits), a suspended organization locks out every one of its users, and a deactivated user simply cannot sign in. Every login, failed login, and password change is audited.

---

## 3. Role-based access, explained

### The model

Access in Prefrontal is **permission-based, with roles as bundles**. Roughly fifty fine-grained permissions exist — "Register patient", "Collect payment", "Enter result", "Validate result", "Manage users", and so on — grouped by module. A **role** is simply a named checklist of those permissions. A user holds one or more roles, and their effective rights are the union of everything their roles grant.

Enforcement is double-layered:

- **The server is the real gate.** Every action is tagged with the permission(s) it requires, and the server re-checks the caller's current permissions on every request. Change a role, and the change bites on the user's very next action — no re-login required.
- **The UI is the polish.** Navigation items only appear if you hold at least one of their permissions, unauthorized routes bounce to a "no access" page, and the post-login landing page is chosen by what you're allowed to see. Hiding a button is never the only defence.

### Default roles and custom roles

Ten roles ship pre-seeded and are shared across all tenants: **Receptionist, Billing Counter, Sample Collector, Home Collection Agent, Lab Technician, Pathologist, Branch Manager, Store Keeper, Inventory Manager, and Lab Admin**. Pre-seeded roles cannot be modified (they're shared) — labs that want a different mix create **custom roles** with any combination of permissions. A guard rail prevents self-escalation: a user-manager can only grant permissions they personally hold, unless they also hold organization management.

### The super-admin bypass

A wildcard permission exists that bypasses every check and reveals every screen. **No seeded role grants it and the role editor never offers it** — it is a platform-level mechanism, not something a lab admin can hand out. The everyday "admin" is the **Lab Admin role**, which is powerful because its checklist is essentially complete, not because of any wildcard.

### Branch scoping

Branch scope is orthogonal to roles. What a scope *does* depends on a tenant-level policy set by the platform: with **branch isolation on**, operational data (orders, bills, samples, stock…) is hard-filtered to the user's active branch by the server — a branch-pinned user cannot see another branch's work no matter what their role says. With isolation **off** (the default, for hub-style labs), scope mainly drives defaults and routing, and data is tenant-wide. Branch switching is always validated server-side.

### The Role × Capability matrix

Legend: **Y** = yes, — = no. Columns: **Rec** Receptionist, **Bill** Billing Counter, **SC** Sample Collector, **HCA** Home Collection Agent, **LT** Lab Technician, **Path** Pathologist, **BM** Branch Manager, **SK** Store Keeper, **IM** Inventory Manager, **LA** Lab Admin.

| Capability | Rec | Bill | SC | HCA | LT | Path | BM | SK | IM | LA |
|---|---|---|---|---|---|---|---|---|---|---|
| Register / edit patients | Y | — | — | — | — | — | — | — | — | Y |
| Merge patients / link ABHA | Y | — | — | — | — | — | — | — | — | Y |
| View patients & orders | Y | Y | Y | Y | Y | Y | Y | — | — | Y |
| Book appointments / check in | Y | — | — | — | — | — | — | — | — | Y |
| Book / assign home-collection visits | Y | — | — | — | — | — | Y | — | — | Y |
| Start / complete own home visits | — | — | — | Y | — | — | — | — | — | Y |
| Create orders | Y | — | — | — | — | — | — | — | — | Y |
| Cancel an order | — | — | — | — | — | — | — | — | — | Y |
| Modify tests on a billed order | — | — | — | — | — | — | — | — | — | Y |
| Create bill / collect payment | Y | Y | — | — | — | — | — | — | — | Y |
| Give discount (within Level-1 cap) | Y | Y | — | — | — | — | — | — | — | Y |
| Override / approve large discounts | — | — | — | — | — | — | — | — | — | Y |
| Process a refund | — | — | — | — | — | — | — | — | — | Y |
| Run day-end reconciliation | — | Y | — | — | — | — | — | — | — | Y |
| View bills | Y | Y | — | — | — | — | Y | — | — | Y |
| Collect sample | Y* | — | Y | Y | Y | — | — | — | — | Y |
| Reject sample | Y | — | Y | Y | Y | — | — | — | — | Y |
| Print barcodes / labels | Y | Y | Y | Y | Y | — | — | Y | Y | Y |
| Dispatch samples to the lab | Y | — | — | — | — | — | — | — | — | Y |
| Receive samples at the lab | — | — | — | — | Y | — | — | — | — | Y |
| Enter / edit results | — | — | — | — | Y | — | — | — | — | Y |
| Delegate own tests to another tech | — | — | — | — | Y | — | — | — | — | Y |
| Validate / reject / reassign results | — | — | — | — | — | Y | — | — | — | Y |
| Reassign technicians' bench work | — | — | — | — | — | Y | — | — | — | Y |
| Validate a result they entered themselves | — | — | — | — | — | — | — | — | — | Y |
| Deliver reports to patients | Y | — | — | — | — | Y | — | — | — | Y |
| Read finished reports (viewer) | Y | — | — | — | Y | Y | Y | — | — | Y |
| Work the report delivery queue | Y | — | — | — | — | Y | — | — | — | Y |
| View test catalogue | Y | — | — | — | Y | — | Y | Y | Y | Y |
| Receive / issue / count stock | — | — | — | — | — | — | — | Y | Y | Y |
| Transfer stock between branches | — | — | — | — | — | — | — | — | Y | Y |
| Configure inventory items | — | — | — | — | — | — | — | — | Y | Y |
| View dashboards / TAT board | — | — | — | — | — | — | Y | — | Y | Y |
| View audit trail | — | — | — | — | — | — | Y | — | — | Y |
| Triage Lost & Found | — | — | — | — | — | — | Y | — | — | Y |
| Manage home-collection agents | — | — | — | — | — | — | Y | — | — | Y |
| Browse branch list / inspect branch info | — | — | — | — | — | — | Y | — | — | Y |
| Edit branch info | — | — | — | — | — | — | — | — | — | Y |
| Manage users & roles | — | — | — | — | — | — | — | — | — | Y |
| Manage test catalogue & pricing | — | — | — | — | — | — | — | — | — | Y |
| Manage referral vendors / top up vendor wallets | — | — | — | — | — | — | — | — | — | Y |
| Send samples to / record results from a referral lab | — | — | — | — | — | — | — | — | — | Y |
| Org settings (billing config, report templates, workflows, notifications, lab settings) | — | — | — | — | — | — | — | — | — | Y |

\* Receptionist's sample collection is automatically suppressed in the UI when the branch runs a dedicated collection counter — the permission stays on the role so an admin can flip the branch back without touching anyone's role.

**Rules that cut across every role:**

- **Any-of gating.** When an action lists several permissions, holding any one unlocks it. Read screens are deliberately generous — anyone who registers, orders, bills, or collects can search patients.
- **Two-person validation.** The person who entered a result may not validate it. Only roles carrying the explicit "validate own result" override (Lab Admin by default) are exempt — so single-person labs keep working while accredited labs get the two-person rule by simply not granting the override.
- **Two-level discount caps.** Billing config sets a Level-1 cap for ordinary discount givers and a Level-2 cap for override holders. A discount above your cap is rejected, not clamped; above the approval threshold, only an override holder can apply it at all.
- **Immediate effect.** Role changes take effect on the user's next request server-side; their own screen catches up when it refreshes (on window focus or re-login). Deactivating a user kills access on their next request — no lingering sessions.
- **Upgrades enrich, never trim.** New permissions introduced in a release are automatically added to the matching default roles; permissions an admin deliberately removed are never re-added.

---

## 4. The actors, one chapter each

### 4.1 Receptionist

**What you see when you log in.** The Frontdesk landing: a universal patient search, today's appointments, in-progress orders, a "Payments due" drawer, and a "Stragglers" panel flagging missed appointments, uncollected reports, and bills unpaid for over a day.

**Your typical day.**
1. A patient walks in. Search by name, phone, MRN, or scan their ID-card QR. Not found? **Register patient** — the form is workflow-driven (name, phone, sex, DOB *or* approximate age, plus whatever fields your admin configured). Saving assigns a lifetime MRN.
2. **Create the order.** Pick tests in the categorized picker — Recent, Favourites, Packages, All. The cart shows subtotal, GST if applicable, an optional discount, and a report-ETA. If a cheaper package covers everything selected, a suggestion banner offers a one-click swap.
3. Set priority and referring hospital/doctor if relevant.
4. **Take payment** — if your branch bills at the front desk, the payment pane is right there: UPI, card, cash, wallet, split, or pay-later with an optional advance. Confirm creates the order, the bill, and the payment in one flow. If your branch has a separate billing counter, creating the order auto-generates the invoice and you send the patient to the counter.
5. **Print or WhatsApp the invoice.** Every invoice carries a patient tracking QR — the patient can follow their own sample's progress after verifying their DOB or phone.
6. If your branch collects samples at the front desk, tap **Collect sample** and draw the tubes (see the Sample Collector chapter — it's the same screen).
7. **Dispatch to the lab.** If your branch runs a dispatch step, rack the drawn tubes and tap **Dispatch** — the lab's intake pane lights up with the incoming rack, and a technician receiving it there starts the TAT clock. On short workflows without dispatch/intake, tubes count as received the moment they're drawn and there is nothing to dispatch. Note the handoff: you dispatch, the lab technician receives — the Sample Collector does neither.
8. **Book ahead.** From Appointments, book a visit for a patient: date, slot, and — worth the extra minute — the tests themselves. For a **home visit**, book a home-collection appointment with the address and the tests: pre-booked tests are what let the agent's check-in auto-create the order (§4.4). Home visits auto-route to a covering agent; anything nobody covers lands in your unassigned queue, where you assign it by hand.
9. When a booked patient arrives: **Check in** — if tests were pre-booked, the order spawns automatically.
10. Through the day, keep an eye on Payments due and Stragglers.

**What you can do:** register/edit/merge patients, link ABHA (the patient's national digital health ID — see the glossary), book appointments, create orders, bill and take payments, give discounts up to the Level-1 cap, collect and reject samples (front-desk-collection branches), dispatch samples, deliver reports, print labels, assign home collections.

**What you can't do:** modify or cancel an order after creation (call a Lab Admin — §5.7 shows exactly what they do), record refunds, exceed the discount cap, enter or validate results, or open any admin screen.

**Rules you'll bump into.** One bill per order — rebilling returns the existing bill. Orders need at least one individual test (a package alone isn't enough). At inventory-enabled branches, a test whose consumables are out of stock can't be ordered — the error names the short items. Cash confirm stays disabled until the tendered amount covers the due. Overpaid bills show an amber "record a refund" panel, but recording it needs a Lab Admin. And if your lab enables **require payment before sharing report** (§5.6), the share/deliver actions stay blocked on an unpaid bill — collect the balance before promising the report, because you are the one the gate stops.

**Tips.** Half-built carts save as drafts (one per patient, seven days, this device only). "Repeat order" from history silently drops retired tests and tells you how many. Cancelling on the billing screen doesn't cancel the order — it stays in Payments due. The "Collect sample" buttons come and go by branch configuration, not by your role.

### 4.2 Billing Counter

**What you see when you log in.** The Billing counter workspace — but note: a pure Billing Counter login has no natural landing page and may see "no access" at the app root. Enter via the **Billing** nav item (it appears whenever your branch runs billing at a separate counter) and bookmark it.

**Your typical day.**
1. A patient arrives from the front desk holding an invoice. Find their order three ways: search the patient, type the invoice/order number, or **scan** the invoice barcode with the device camera.
2. The Collect payment screen opens: invoice preview on the left (line items, GST, discount box, total), payment pane on the right.
3. Cash mode gives you a numpad, quick-add notes, an "Exact" button, and a live change calculator — Confirm enables only when the cash covers the due.
4. Wallet mode charges a referring clinic's prepaid credit — insufficient balance blocks the payment.
5. After payment, print or WhatsApp the invoice. The Confirm button locks permanently — that's the double-charge lock, not a bug.
6. Watch the **Money** pane through the day: outstanding balances and refunds owed.
7. At close, run the **Day-end summary** — per-mode payment and refund totals for the day, the numbers you tally the cash box against.

**What you can do:** view patients, orders, and bills; create bills; take payments; give discounts up to the Level-1 cap; print barcodes; run day-end reconciliation.

**What you can't do:** register patients, create/modify/cancel orders, record refunds (you see the refunds-owed list; a Lab Admin records them), collect samples, deliver reports, or open front-desk or lab screens.

**Rules you'll bump into.** Discounts above your cap are rejected with an explanation. A discount typed at order time carries into billing and wins over an older billing draft. Pay-later orders show the outstanding amount as due — collect any time before report delivery.

**Tips.** Day-end totals don't roll over at midnight local time — payments taken before about 5:30 AM IST count toward the *previous* day's summary, so a very-early-morning payment can appear under yesterday. Tally accordingly. Your workspace is branch-scoped; patient search spans the whole tenant.

### 4.3 Sample Collector

**What you see when you log in.** You land directly on the **Sample collection** screen — no dashboard detour. A KPI strip (awaiting / collected today), a scan-or-search bar, and a "Pending collection" list: one card per patient with a mini rack of coloured chips, one per tube.

**Your typical day.**
1. Every order arrives pre-split into one barcoded tube per department — an EDTA tube (the lavender-top whole-blood tube), an SST tube (the gold-top serum-separator tube), a urine cup, each drawn as a life-size illustration coloured to match the physical rack.
2. Find the patient: type (name, MRN, phone, order number, barcode), scan with the camera, or use a barcode gun — it just types into the autofocused field.
3. Open the patient's **collect drawer**: progress bar, one large illustrated vial per tube with its tests and barcode.
4. **Tap each vial as you draw it** — it fills and gets a green tick with the time. Mis-tap? Tap again to undo (until the tube leaves the counter).
5. **Print labels** any time — before or after the draw; pre-labelling the rack is fine.
6. Can't draw? Tap **Can't collect** and pick a structured reason (patient refused, fainted, vein not found, insufficient sample, wrong tube, other). All still-pending tubes on the order are rejected with that reason; the front desk and colleagues are notified automatically.
7. When every vial is drawn, the order completes automatically and the patient drops off the queue.

**What you can do:** work the pending queue for your branch, collect and un-collect tubes, reject with a reason, print labels, look up samples by barcode, view patients and orders.

**What you can't do:** dispatch tubes to the lab (no Dispatch button appears), receive samples at lab intake, enter results, bill, register patients, or manage home-collection assignments.

**Rules you'll bump into.** Payment never blocks collection — the pay-in-full gate (if the lab enables it) sits at report release instead. Only a pending tube can be collected; un-collect works only until pickup or receipt. Validated tubes can never be rejected. When one collector starts a patient, other collectors' "ready to collect" alerts expire — no racing. Stock consumables are auto-deducted as you draw, silently, and never block you.

**Tips.** A rejected tube leaves the queue permanently — the re-draw happens when the front desk re-adds the test, which mints a fresh tube and barcode; don't wait for the old one to reappear. The drawer intentionally never refreshes while open; the queue reconciles when you close it. Scanning an order QR from an invoice opens the collect drawer for that order directly.

### 4.4 Home Collection Agent

**What you see when you log in.** **Home Visits (My visits)** — a card list of the home-collection appointments assigned to you, sorted by date and slot, with the patient's address, a Directions link that opens Google Maps, a tap-to-call phone number, and status chips (Booked / Checked in / Collecting).

**Your typical day.**
1. Visits are **auto-routed** to you: you have a coverage area (a pincode list or a geo radius) and a weight; the system gives each booking to the least-loaded covering agent. Anything nobody covers goes to the front desk's unassigned queue for manual assignment.
2. Tap **Directions** to navigate; tap the number to call the patient.
3. On arrival, tap **Check in & collect**. Check-in spawns the lab order from the tests pre-booked on the appointment, and you land on the standard collection screen — same illustrated vials, same labels, same reject flow as the counter.
4. Draw the tubes, tap them off, bag the samples.
5. Back on My visits, tap **Complete visit**.

**What you can do:** everything a Sample Collector can, plus start and complete your own visits. Your queue shows only your own, still-open, branch-scoped visits.

**What you can't do:** see other agents' visits or the unassigned pool, reassign visits, create orders manually, bill, or manage agents.

**Rules you'll bump into.** **No money changes hands in the field.** The agent has no billing capability, so every home visit is effectively pay-later: the patient pays through the UPI button on their tracking link, or at the lab afterwards, and if the lab enables the pay-before-report gate the report simply isn't shared until the balance clears. Collection itself is never blocked by payment — you always draw. Tell patients this up front; "how do I pay you?" is the commonest doorstep question. Check-in only auto-creates the order if tests were pre-booked — a visit booked without tests leaves nothing to collect until the front desk creates the order. **Known setup caveat:** the check-in step requires an order-creation permission the stock agent role doesn't include; labs rolling out field collection either grant it via a custom role or have the front desk check visits in. Plan for this before a field rollout.

**Tips.** Everything is one-thumb phone-first: big tap targets, tap-to-call, native maps hand-off, camera barcode scanning — no extra hardware needed. If you're deactivated as an agent, your already-assigned visits stay with you until completed or reassigned.

### 4.5 Lab Technician

**What you see when you log in.** The **Lab** area ("My Work"), three panes: **Lab Intake** (receive arriving tubes), **My Work** (tubes you've claimed), and **Queue** (the unclaimed pool). Work is bucketed by urgency — Urgent / High / Within TAT — with one expandable card per patient.

**Your typical day.**
1. **Receive** racks arriving from collection into the lab (on short workflows without dispatch/intake, tubes arrive pre-received and the TAT clock started at the draw).
2. In **Queue**, pick a tube — the app asks you to **scan its barcode** to claim it, proof you physically hold the right sample (a lab-level setting can relax this to a no-scan claim). One scan claims every test riding on that tube.
3. **Open the tube** — all its tests on one screen, each parameter showing its input with the normal value and critical thresholds printed beneath.
4. Enter values. **Save draft** any time — drafts skip all checks and never block half-finished work.
5. **Submit All Results.** The system blocks the submit if any value is outside its plausibility band ("re-check the value"); otherwise every value is graded High / Low / Critical / Abnormal / Normal against reference ranges resolved for this patient's age and sex.
6. Made a mistake? **Undo submit & edit** works while the result is still awaiting validation. Once a pathologist signs, that window closes for good.
7. When a pathologist rejects your result, the tube shows a red **"Sent back for re-entry"** banner with their reason and the doubted parameters highlighted. Correct and resubmit — your resubmission auto-resolves their correction threads.

**What you can do:** receive tubes, collect and reject samples, claim pool work, enter and edit results, save drafts, re-open your own not-yet-validated submissions, delegate your own tests to another tech, read finished reports.

**What you can't do:** validate anything — especially your own entries; grab another tech's claimed tube (ask a supervisor to delegate it); touch a validated result; open the report delivery queue; enter results for outsourced tests; see billing or admin.

**Rules you'll bump into.** Result entry is blocked until the tube's status is "received" at the lab. A tube claimed by someone else is locked. The status ladder is one-way: pending → in progress → entered → validated, with rejection the only way back down. Tests configured as *direct flow* auto-validate on your submit and never reach a pathologist.

**Tips.** Drafts skip every check — don't treat a saved draft as vetted. You may see a "Results" link you can't open: technicians read reports through the viewer; dispatching them is a delivery-role job. Critical values notify automatically the moment they're flagged.

### 4.6 Pathologist

**What you see when you log in.** The **Validate** area: pending validation, two tabs — **My queue** and **All** — bucketed by TAT urgency, with a red **CRITICAL** chip on any patient group carrying a critical value. That chip is your triage signal.

**Your typical day.**
1. Open a test. The validation screen shows each parameter with its value, unit, the resolved reference range, a visual range bar with a pin at the entered value, and its flag.
2. Converse with the technician if needed: an overall comment thread plus per-parameter threads. Comments are **observations** (FYI) or **corrections** (requesting a change — these auto-resolve when the tech resubmits).
3. Decide, from the sticky bottom bar:
   - **Validate** — signs the result. On a critical value the button reads *Validate · notify* and triggers the critical-value notification path. If this was the order's last outstanding test, the final report generates itself.
   - **Reject** — a reason is mandatory; the test drops back to the technician's queue with your reason attached as a live thread.
   - **Reassign** — hand the test to another pathologist.
4. Work the **Results** delivery queue when needed: release urgent **partial reports** (covering only fully-validated tubes, footnoting what's pending), deliver finals by WhatsApp / print / in-app share, and trigger amendments.

**What you can do:** validate, reject, and reassign results; comment per-parameter; deliver reports; issue amendments; reassign technicians' bench work (supervisor-grade); receive critical-value notifications.

**What you can't do:** enter or edit raw result values — the supported correction path is always **Reject with a reason**, which reopens the technician's structured entry screen; validate a result you entered yourself (moot for the stock role); collect or receive samples; validate outsourced tests (they arrive signed by the referral lab and print "Tested at: …"); bill or administer.

**Rules you'll bump into.** Nobody — not even a Lab Admin — directly overwrites a validated result; the only path is reject → re-enter → re-validate, which automatically issues a superseding **amended** report if a final was already released, stamped with the reason and the date of the report it replaces. Direct-flow tests skip you entirely unless the branch turns on "require validation for all results".

**Tips.** Use per-parameter comments to point at the exact value you doubt — the technician sees that field highlighted. The reassign prompt currently asks for the target pathologist's user ID, so have it handy — anyone with Users & Access can read it off the colleague's entry there, so ask your admin once and keep a note of your co-pathologists' IDs. The "Show claimed" toggle on the queue reveals tubes stuck with absent techs — combined with reassign, it's how you unjam a shift handover.

### 4.7 Store Keeper & Inventory Manager

**What you see when you log in.** The **Inventory desk** (Stores) — a user with only inventory permissions lands here directly. The Overview tab shows a KPI strip (Items / In stock / Low / Out / Expiring soon), a searchable stock table, and Low-stock and Expiring-soon alert cards.

**Your typical day (Store Keeper).**
1. **Receive** a delivery: the Receive tab listens for barcode-gun bursts document-wide (a camera button works too). Scanning a GS1-128 supplier barcode (the standard logistics barcode on medical cartons that packs lot, expiry, and quantity into one strip) pre-fills all three. Confirm the four fields — lot, expiry, unit cost, quantity — and receive. A fresh **lot label** prints so the physical stock is labelled immediately.
2. **Issue / consume**: scan the item or lot, enter a quantity, issue. Consumption is **FEFO** — first-expiry-first-out, expired lots never touched. Not enough non-expired stock? The issue is refused with exactly what's short.
3. **Stock count**: scan an item, see each batch with its system quantity, type what you physically counted, save. The variance is ledgered ("Adjusted by +2 / −3").
4. Once an item is scanned, switching between Receive / Issue / Count keeps it — scan once, do several things.

**The Inventory Manager adds:** the catalogue (Admin → Inventory: create/edit items, SKUs, categories, reorder levels, near-expiry windows, barcodes), the **per-test consumables map** (which stock each test burns — this drives auto-deduction at collection and the out-of-stock ordering gate), the inter-branch transfer permission, and dashboards.

**What you can't do.** Store Keeper: no catalogue edits, no consumables map, no dashboards, no patient/order/billing screens. Inventory Manager: everything inventory, but still no patient, billing, or lab capabilities, and no branch inventory on/off switch — that lives in Lab Settings and belongs to the Lab Admin.

**Rules you'll bump into.** Stock is per branch; the catalogue is tenant-wide. SKUs and barcodes are unique. You can't issue more than the non-expired on-hand, and adjustments can't push a batch negative. Everything is written to an append-only ledger with actor and reason; consumption rows link to the order and sample, so lots are traceable to patient samples. Auto-deduction at collection is best-effort — patient care is never blocked by stock; a shortfall is logged instead.

**Tips.** Inventory is double-gated: the tenant's plan must include the module *and* the branch must switch it on (new branches start off). Undated lots are consumed last — enter expiry dates for strict rotation. There is no branch-transfer screen yet despite the permission; today, moving stock means issuing at one branch and receiving at the other. On-hand "drift" between ordering and collection is normal — the ledger explains every movement.

### 4.8 Branch Manager

**What you see when you log in.** The **TAT board** and dashboards — an oversight view of the branch's throughput, not an operational queue.

**Your typical day.**
1. Watch the dashboards and the TAT board for bottlenecks.
2. Review the **audit trail** — who did what, when.
3. Manage the **home-collection agents**: add agents, set their pincode or radius coverage and load weights, reassign stranded visits.
4. Inspect branch information, browse the branch and department structure, and open Lab Settings to review the branch's operating modes — all read-only at this tier: the pages open, but edits to branch info or settings need the Lab Admin.
5. After the admin changes a workflow, sweep **Lost & Found** for orders stranded in a removed stage and send them onward, reject, or escalate.
6. Escalate: anything that changes tenant-level configuration — roles, catalogue, workflows, billing config — goes to the Lab Admin.

**What you can do:** view everything operational (patients, orders, bills, finished reports, dashboards, audit trail), manage home-collection agents and reassign stranded visits, triage Lost & Found, and browse/inspect branch structure.

**What you can't do:** any operational action — no registering, billing, collecting, resulting, or validating — and no user/role management, catalogue edits, workflow edits, or data wipes. Notably, the Branch Manager has **no inventory visibility** either; stock oversight belongs to the Inventory Manager.

**Rules you'll bump into.** Your admin gear appears (via branch rights), and several admin pages open for you, but any save that needs organization-level rights — including edits to branch info — is refused. This is deliberate: the role is oversight, not administration.

**Tips.** The audit trail plus dashboards make this the natural first responder for "why is this order stuck?" questions — check Lost & Found after any workflow change, and the TAT buckets before blaming a person.

### 4.9 The Patient

The patient is an actor too — the only one without a login, and the person your support and sales conversations will most often be about. Everything they touch runs through the **patient tracking link**: the QR printed on every invoice (and carried in its WhatsApp copy), which opens a public status page.

**Their typical journey.**
1. Scan the invoice QR or tap the WhatsApp link. The page asks them to **verify who they are first** — date of birth or registered phone number. Nothing displays until they pass.
2. They watch their own order's live progress: samples collected, received at the lab, report expected by the ETA.
3. If a balance is due and the lab has configured a UPI address (§5.5), a pre-filled **Pay via UPI** button lets them settle from their phone — this is how pay-later and home-visit balances usually clear.
4. When the last test is validated, the finished report appears on the same page to view and download. If the lab enables the pay-before-report gate, the report stays hidden until the balance is cleared.
5. If a result is corrected after release, the clearly-marked **amended** report supersedes the original on the link.

**What they cannot see:** anyone else's data (the link covers one order and demands identity verification), results before validation, internal comment threads, or any staff screen. There is no patient account, password, or app to install — the link is their entire product surface. A patient who loses it just asks the front desk to reprint or re-send the invoice.

---

## 5. The Lab Admin

The Lab Admin runs the organization inside the product. The Admin area opens from the **gear icon** in the top strip — deliberately outside the main work navigation, because it configures the app rather than operating the lab. It has three layers: an **Overview** (live KPI cards with date filters, a configuration at-a-glance strip, a link to the live TAT board), a searchable **Manage settings hub** (five categories: Tests & Catalog, People & Access, Branches & Organization, Billing & Finance, Workflow & Automation — the hub search is the fastest route to any setting), and the individual config screens, each guarded by its own permission.

### 5.1 Users & roles

- **Invite:** Users & Access → Invite. Name, email, phone; one **role** (seeded or custom); a **branch scope** (all branches, one branch, or a sub-branch); and an access method — email invite (they set their own password) or set-a-password-now (you share it personally; copy it before submitting, it isn't shown again). Invited staff sign in with their email as username.
- **Deactivate, don't delete:** removing an employee is a deactivation — access dies on their next request, history and assignments are kept. There is no user deletion.
- **Roles & Permissions:** create custom roles by ticking permissions (grouped by module, with a live granted counter). **Pre-seeded roles cannot be modified** — the editor lets you toggle boxes, but the save is rejected because seeded roles are shared across every tenant; make a custom copy from the start. You can only grant permissions you yourself hold (unless you hold org management), so nobody mints themselves a super-role.
- Changes take effect immediately server-side; open sessions pick them up within minutes of the user next focusing their window.

### 5.2 Catalogue & pricing

- **Tests:** each test carries its department, sample type, price, tax slab, TAT, and a **flow** — *Direct* (result goes straight to the report) or *Approval* (queues for pathologist validation). The **Parameters** builder defines the result-entry form: field types, units, required/conditional flags, and reference ranges — including multiple sex- and age-segmented ranges, which power the automatic High/Low/Critical flagging. Per-test **report layout** and **consumables** (with inventory) attach after first save. Tests can be **outsourced** to a referral lab — their results arrive signed from the vendor and are never entered in-house.
- **Packages:** a member-test picker with a running member-price total and the package's own price. The front desk gets automatic "cheaper package" suggestions from these.
- **Pricing tab:** a bulk editor — filter by department, edit inline or apply a percentage to the filtered list; nothing persists until the sticky Save bar. The percentage applies to *the filtered list*, not the whole catalogue — filter first.

### 5.3 Branches, sub-branches, departments

Add branches (name, code, city, state); within each, manage **sub-branches** (in-house lab / collection centre / satellite) and **departments**. Each department carries a two-digit **sample code** that prefixes the short tube barcode. Departments and sub-branches deactivate softly — hidden from pickers, but history keeps its references.

### 5.4 The Process Workflow Builder — the heart of the admin area

This is where the admin composes what the rest of the staff actually see.

- **Scope first.** Pick "All branches (default)" or a specific branch — each branch can run its own workflow; branches without one inherit the tenant default. It is easy to edit the default thinking you're editing one site.
- **The board:** a palette of actions (Appointments, Register Patient, New Order, Billing, Queue, Dispatch, Sample Collection, Home Visits, Lab Intake, Result Entry, Validate, Results, Lost & Found, Messages) and work-area **lanes**. Drag actions into lanes; each lane gets an icon, an editable name (this becomes the nav label), an order, a **"Who"** role allow-list, and per-action on/off toggles.
- **Guardrails, enforced server-side too:** core actions are locked to their home areas; Register Patient can't be switched off; Dispatch and Lab Intake toggle as a coupled pair; prerequisites cascade (Billing needs Registration, Results needs Validate needs Result Entry). Sample Collection is repeatable — place it at the front desk *and* a dedicated counter *and* the lab if you like.
- **What activation changes:** every work-area becomes a nav item; a user sees it only if their role is allowed *and* they can run at least one enabled action inside. Disabling an action removes the whole feature — screen and deep links, not just the button. **Placement derives operating modes:** Billing or Collection living in a different menu from Registration means a separate counter, and the system syncs those modes into every affected branch automatically — Lab Settings shows them read-only. To make billing a separate counter, drag Billing into its own menu; there is no toggle to hunt for.
- **Save ≠ activate.** Drafts are free; nothing changes for staff until **Set active** — then navigation updates immediately, with a live preview strip showing exactly what staff will see. Leaving the "Who" list empty means *anyone with matching permissions*; adding one role silently excludes everyone else.
- **After big changes, check Lost & Found:** orders sitting in a stage you removed surface there for triage — send onward, reject, or cancel.
- **Fail-open safety:** no active workflow means the built-in default navigation; an unmentioned action counts as enabled. A configuration mistake can hide features, but it can never lock the whole staff out.

### 5.5 Billing & GST configuration

Three tabs:

1. **GST Setup** — a master Enable-GST toggle (off = zero-tax **Bill of Supply**, which suits most GST-exempt diagnostics; on = per-test tax slabs on a Tax Invoice), GST scope (per branch / per region / consolidated), filing frequency, and a GSTIN + state code per branch.
2. **Discounts** — allow-discounts master switch and three numbers: the Level-1 cap (ordinary discount rights), the Level-2 cap (override rights), and the approval threshold above which only an override holder may apply a discount at all. Caps reject, never clamp.
3. **Invoice** — invoice prefix and starting number with a live "next invoice" preview; an optional **UPI address** that puts a pre-filled "Pay via UPI" option on the patient's public tracking page; and the **letterhead editor** — template style, lab identity, accent colour, logo, signatory, bank details, declarations, and show/hide toggles — with a live sample-PDF preview switchable between Bill of Supply and Tax Invoice. The preview uses a fake patient; it's for checking the letterhead, not a real document.

### 5.6 Lab settings

Per-branch operational switches: the read-only counter/collection modes (edit them in the Workflow builder); the **patient ID format** (date prefix, separator, digits, optional letters — the running number never resets and existing IDs are never rewritten); sample-barcode number width; **allow no-scan claim** (supervisor override for smudged barcodes, every use audit-logged); **enable inventory** (only shown if the plan includes the module); **require payment before sharing report** (collection is never blocked, so pay-later still works); **require validation for all results** (forces even direct-flow tests through the pathologist — flip this rather than editing every test if your accreditation demands universal sign-off); and per-department **auto-assignment** of incoming work to people or roles (least-loaded wins; nothing set = shared queue). A double-confirmed **danger zone** can wipe all patient/operational data for dev testing while keeping config, users, roles, catalogue, and workflows.

### 5.7 Everyday rescue actions — cancel, modify, refund

The three "call a Lab Admin" moments from the front-of-house chapters all happen on screens the admin already has — no special console, just extra buttons on the same order and billing views:

- **Cancel an order.** Find the order (universal patient search, or straight from the Frontdesk / Payments due lists — you see the same screens as the receptionist, with more actions). **Cancel order** appears for you where her toolbar has none; a reason is required and the cancellation is audited. An order with already-validated results can't be cancelled — resolve those tests first.
- **Modify tests on a billed order.** From the same order view, **Edit tests** lets you add or remove tests after billing. Adding a test mints a fresh barcoded tube and re-prices the bill; removing one whose tube is already being worked in the lab is refused. The bill updates to the new total — an overpayment created this way surfaces as a refund owed.
- **Record a refund.** Open the bill: overpaid or cancelled bills show the amber **refund panel** (counter staff see it too — they just can't press it). Enter the amount, mode, and reference, confirm, and the refund lands in that day's day-end totals.

If you're doing these hourly, the fix is usually upstream — a workflow, pricing, or discount-cap change elsewhere in this chapter, not more rescues.

### 5.8 Referral labs, referring clinics, and the vendor wallet

Both kinds of outside partner belong to the Lab Admin — no seeded operational role can set them up or settle with them.

- **Referring clinics (work coming in).** The admin creates the clinic as a **vendor** and tops up its prepaid **vendor wallet**; from then on the billing counter can charge "Wallet" instead of taking money at the desk. Top-ups and balance reviews are admin-side, so when a counter payment is blocked for insufficient balance, the call comes to you.
- **Referral labs (work going out).** A test marked **outsourced** in the catalogue (§5.2) is never entered in-house. Its sample is still drawn and barcoded locally like any other; the admin then marks the sample **sent to the vendor** from the order, and when the vendor's signed result comes back, the admin records it against the test. The printed report carries "Tested at: …", and the result never passes through your technicians or pathologists — there is nothing for them to enter or validate.

### 5.9 What even the Lab Admin cannot do

Create or suspend organizations, change the tenant's plan or module entitlements, or flip branch isolation — those belong to the platform control plane (chapter 7). And no one, Lab Admin included, directly edits a validated result: the formal reject → re-enter → re-validate cycle is the only path, by design.

---

## 6. Communication & the mobile app

### Messages

A Teams/WhatsApp-style chat built into the same app: 1:1 threads, named groups, and a private "Notes to self" scratchpad. Messages are real-time while the app is open and fall back to push notifications when it isn't. Chat is clinically aware — share a patient profile or a finalized report straight into a thread, or open a conversation *anchored* to a specific patient or order, labelled with a context chip, separate from your general thread with the same person.

Messages is deliberately the one open-to-all area: **every signed-in user can chat, see presence, and call — no permission needed.** But nobody, admins included, can read a thread they're not a participant of, edit or delete someone else's message, or reach a user in another organization. Message tools: reply with quote, edit/delete your own (deletes leave a placeholder), pin, react, forward, @mentions (which cut through mutes), attachments, voice messages, and per-thread mute.

### Presence

Two layers make the coloured dot: automatic connection presence (online / away / on a call / offline) and a user-chosen status — Available, Busy, With a patient, On rounds, In surgery, Do not disturb, Away. **"In surgery" and "Do not disturb" are real:** the server refuses calls to you and silences your chat pushes (unread badges still accumulate). Status persists and syncs across all your devices.

### Calls

Audio-only voice calls, up to five participants: grow a 1:1 by inviting a colleague mid-call, or ring a whole group chat at once. Calls are time-capped — 10 minutes 1:1, 30 minutes once a call has ever had three or more people — with a sixty-second warning. One call at a time; answering on one device silences the ring on all your others. A Calls tab keeps history (missed / declined / connected with duration).

**Locked iPhones still ring like a phone.** An incoming call to a locked, backgrounded, or even fully-killed iPhone shows the native full-screen ringer; answering boots the app in the background and connects (a few seconds of "Connecting…" on a cold launch is normal). Android shows a high-priority call notification. Known weak spot: locking the screen *mid-call* on iPhone can still drop the call — keep the screen on for important calls.

### Notifications

Business events push to devices and deep-link to the right screen: critical values, test assignments, and result rejections open My Work; report-ready opens Reports; sample events open the Frontdesk. On iPhone, chat notifications carry an inline **Reply** — answer from the lockscreen without opening the app; a failed lockscreen send comes back as "tap to open and resend" rather than silent loss. Push registrations follow sign-in and are removed at sign-out, so a shared iPad stops receiving the previous user's messages.

### One app, three shapes

One product ships to web, desktop, and native iOS/Android, and the shell adapts: phones get a floating bottom tab pill (which hides while typing or inside an open thread — swipe back from the screen edge to get out; it's not a bug), tablets get a left rail, desktops get a top strip. Drill-down screens always show a back chevron, touch devices support edge-swipe back, and Android's hardware back button behaves as expected. On phones, sharing a report or invoice uses the OS share sheet (AirDrop, WhatsApp, Mail) — the installed app shares the actual PDF, where the web version opens a pre-filled chat message instead. Web browsers only notify when the tab is hidden.

---

## 7. Behind the scenes: the platform

Above every lab sits the **control plane** — Prefrontal's own internal console, used by Prefrontal staff only, never by customers. Lab users never see it; they feel its decisions.

- **Provisioning.** The platform team creates each organization: one form stands up the tenant, its main branch, default departments, a starter catalogue, workflow templates, and the first Lab Admin account. The new admin receives a "Your workspace is ready" email with a temporary password and a pre-filled sign-in link, and is forced to set their own password at first login. Passwords are generated and emailed by the platform and are never shown on any screen.
- **Plans & modules.** Each tenant has a subscription plan, and four product modules can be licensed per tenant: **Inventory, Messages, Home Collection, and Reports/analytics**. Entitlements gate navigation and deep links alike; a tenant without a module simply doesn't have it (Messages shows a locked "upgrade" screen; the others disappear). Changing a tenant's plan does not retroactively change its modules — those are adjusted explicitly. Legacy tenants with no entitlement record get everything, by design.
- **Suspension.** The platform can suspend an organization with a mandatory reason: every one of its users is blocked at their very next request, and reactivation is equally immediate.
- **Branch isolation.** The tenant-wide shared-vs-isolated data policy (chapter 3) is flipped here, not by the lab admin.
- **Admin password resets.** A fresh temporary password is set, must-change is flagged, and credentials are emailed to the on-file admin address — support never sees the password.
- Platform access itself is two-tier — **superadmin** (all of the above) and **support** (strictly read-only) — and every mutation is written to an immutable audit log with actor, action, target, and IP.

If a lab reports "we're all locked out", "a whole module vanished", or "we never got our welcome email" — that's a control-plane conversation, not a Lab Admin setting.

---

## 8. Glossary

| Term | Meaning |
|---|---|
| **Organization / tenant** | One lab company; a fully walled-off customer of the platform. Users belong to exactly one. |
| **Branch / sub-branch** | A physical site of the organization; a sub-branch is a specific lab, collection centre, or satellite within it. |
| **Branch isolation** | Tenant-wide policy: on = each branch's staff see only their branch's operational data; off (default) = shared, hub-style visibility. |
| **Permission** | One atomic capability ("Register patient", "Validate result"); about fifty exist. |
| **Role** | A named bundle of permissions. Ten pre-seeded roles ship with the product; labs add custom roles. |
| **Lab Admin** | The most powerful tenant role — a near-complete permission checklist, not a wildcard. |
| **MRN** | The patient's lifetime medical record number, assigned once at registration, format admin-configurable, never reset. |
| **ABHA** | Ayushman Bharat Health Account — India's national digital health ID under the ABDM programme. The front desk can link a patient's ABHA to their MRN at registration. |
| **EDTA / SST tube** | Common blood-tube types: EDTA is the lavender-top whole-blood tube; SST is the gold-top serum-separator tube. The collect screen draws each as a colour-matched illustration. |
| **GS1-128** | The standard logistics barcode on supplier cartons, packing lot number, expiry, and quantity into one strip; scanning it pre-fills stock receiving. |
| **Order** | One visit's set of tests for one patient; the unit that gets billed, collected, and reported. |
| **Bill / invoice** | The money side of an order — one bill per order, with a tenant-configured invoice number, GST treatment, discounts, and payments. |
| **Bill of Supply / Tax Invoice** | The two invoice forms: zero-tax (GST off) vs. per-test tax slabs (GST on). |
| **Pay later** | Collecting part or none of the payment at order time; invoicing, not payment, lets the order proceed. |
| **Sample / tube** | One barcoded physical specimen; every order auto-splits into one tube per department. The unit of collection and result entry. |
| **Barcode (sample)** | System-issued tube identity: department code + year + running number; claimed by scanning. |
| **FEFO** | First-Expiry-First-Out — how stock is always consumed; expired lots are never used. |
| **BOM / per-test consumables** | The mapping of which stock items a test burns; drives auto-deduction at collection and the out-of-stock ordering gate. |
| **TAT** | Turnaround time — the promised time from lab receipt (or collection, on short workflows) to result; drives the Urgent/High/Within-TAT queue buckets and the TAT board. |
| **Direct vs. Approval flow** | Per-test setting: direct results auto-validate on entry; approval results queue for a pathologist. A branch switch can force everything through approval. |
| **Two-person rule** | The person who entered a result may not validate it, unless their role holds the explicit self-validation override. |
| **Amended report** | The automatically issued, clearly-banner-marked report that supersedes a released final after a post-release correction. |
| **Partial report** | An early release covering only fully-validated tubes, footnoting what is still pending. |
| **Process Builder** | The admin tool that composes each branch's workflow — work areas, actions, names, roles — and thereby the whole staff's navigation. |
| **Work area** | One nav item produced by the Process Builder, containing enabled actions and an optional role allow-list. |
| **Lost & Found** | The triage screen where orders stranded by a workflow change surface for forwarding, rejection, or cancellation. |
| **Module entitlement** | A per-tenant licence switch (Inventory, Messages, Home Collection, Reports) set in the control plane, above the Lab Admin. |
| **Control plane** | Prefrontal's internal console: provisioning, plans, modules, suspension, isolation, admin password resets. |
| **Home collection** | Field phlebotomy: visits auto-routed to agents by pincode or geo-radius coverage and load weight. |
| **Vendor wallet** | A referring clinic's prepaid credit balance that the billing counter can charge instead of taking payment. |
| **Patient tracking link** | The public QR-reached status page — locked behind the patient's DOB or phone — showing progress, balance-due UPI payment, and the finished report. |
| **Presence / DND** | The status dot next to every user; "In surgery" and "Do not disturb" genuinely block calls and silence pushes. |
| **Temporary password** | A platform-issued credential that forces a password change at first login and blocks everything else until changed. |
| **Soft delete / deactivate** | The product's universal removal model — users, departments, sub-branches, patients, and agents are deactivated with history intact; nothing operational is ever hard-deleted. |
