# OPD — how it works

OPD (outpatient consults + pharmacy) runs inside the LMS as a separate module.
It is still **dark**: nobody sees it unless the tenant is explicitly entitled
(`ModulesJson` `opd.enabled = true`) or the person typed `pf.opd()` in the
browser console (every API call then carries `X-PF-OPD: 1`). The server enforces
the same rule (`[RequireOpd]` → 404), so a hidden OPD cannot be reached by URL.
The lab never depends on OPD: an OPD investigation becomes an ordinary lab order.

```
Front desk ──book + bill──▶ opd_visits ──vitals──▶ doctor queue ──consult──▶ completed
   │                          │                                   │
   │ optional lab tests       │                                   ├─ investigations ─▶ orders (normal lab order) ─▶ lab queues
   ▼                          ▼                                   ├─ Rx lines ────────▶ pharmacy queue ─▶ dispense ─▶ bill + stock ledger
 lab order + lab bill      opd_bills (consult)                    ├─ media ───────────▶ object storage ({tenant-folder}/opd/consult/{visit}/…)
                                                                  └─ follow-up date ──▶ a new booked opd_visit
```

## 1. Who sees what

| Surface | Route | Who |
|---|---|---|
| OPD tab (nav) → OPD hub | `/opd` | anyone who can open at least one OPD area (tiles filtered by permission) |
| Consults tab | `/opd/consult` | doctors (users with a `DoctorProfile`); staff see all doctors with a doctor filter |
| Doctor login landing | `/` → `/opd/consult` | a doctor with no lab landing (else their lab landing wins) |
| Front desk: lab cart / consult icon | `/frontdesk` | the cart is ALWAYS the lab order; the stethoscope icon next to it opens `/opd/visit/new` |
| Admin | `/admin/opd/**` | admin permissions (`manage_users` / settings perms) |

A doctor is a user whose role has `Kind = doctor` / `Module = opd` and who has a
`doctor_profiles` row (registration number lives on `users.RegistrationId`).

## 2. Masters (Admin → OPD)

| What | Table | Key columns |
|---|---|---|
| Department | `opd_departments` | `Code`, `Name`, `DefaultFormId` → the department's consult form |
| Service (consultation / procedure) | `opd_services` | `Category`, `PriceMode` (`common` / `per_doctor`), `CommonPrice`, `TaxSlab` (0 — SAC 999312), `FollowUpWithinDays`, `FollowUpFee` / `FollowUpPercent`, `FormId` (override) |
| Per-doctor price | `opd_service_doctor_prices` | `ServiceId`, `DoctorUserId`, `Price`, `FollowUpFee` |
| Doctor room / token prefix / days | `opd_settings.WorkflowJson` (doctor extras) | read through `OpdSettingsJson` |
| Workflow (vitals at desk or station, pay first / later, note visibility) | `opd_settings.WorkflowJson` | one reader: `Services/Opd/Admin/OpdSettingsJson.cs` |
| Common diagnoses → usual Rx + tests | `opd_diagnosis_templates` | `DepartmentId`, `DoctorUserId` (optional), `Code` (ICD-10), `Label`, `RxJson`, `TestsJson`, `Advice` — the consult's one-tap "usual" falls back to it when the doctor has no past consult for that diagnosis that prescribed or ordered something |

The fee is decided in ONE place — `OpdFeeRules.Quote` (service × doctor × patient's
last visit with that doctor → new / follow-up / tenant tier / desk override).

## 3. How a consult form is built and published

1. **Library.** Every form is an `opd_form_definitions` row (name, code,
   `CurrentVersionId`). Its content lives in `opd_form_versions`
   (`Version`, `Status` = `draft` | `published`, `SchemaJson`).
2. **Edit.** Admin → OPD → Consultation forms opens the builder. Every change is
   saved to the single **draft** version (`PUT /api/opd/admin/forms/{id}/draft`);
   the server validates it (`OpdFormSchemaRules.Validate`: answer types, choices,
   left/right, conditions, tables, calculated fields, limits).
3. **Publish.** `POST /api/opd/admin/forms/{id}/publish` freezes the draft as the
   next immutable version and points `CurrentVersionId` at it. Published versions
   are never edited.
4. **Attach.** A department's `DefaultFormId` (or a service's `FormId`, which
   wins) decides which form a consult uses. A doctor can ADD their own questions
   (`opd_doctor_form_addons.FieldsJson`) — never remove the clinic's.
5. **Pinning.** When the doctor starts a consult, the current published version
   is pinned on the record (`opd_consult_records.FormVersionId`). Publishing a new
   version later never changes an existing consult: it keeps rendering and
   printing with the version it was filled with. New consults pin the new one.

Schema (v2) — `{ sections: [{ key, title, fields: [...] }] }`; a field is
`{ key, label, type, sides?, required?, print?, choices?, unit?, min?, max?, shape?, rows?, cols?, when?, formula?, from?, row? }`.
Types: `short long yn one many num scale date media diagram table calc`.
`sides` asks right and left separately; `when` shows a question only for a given
answer of an earlier one; `calc` is read-only and computed on screen:
`edd` (LMP + 280 days), `pog` (weeks + days since LMP), `pta` (mean of 500 / 1000 / 2000 Hz of an audiometry table row).
Vitals, diagnosis, prescription, investigations and follow-up are **built-in**
consult sections, never form questions.

The seeded forms (tools/opd-seed/data/forms.mjs): ENT (history, ear R/L with TM
findings, tuning fork, audiometry table + PTA, nose, throat, neck, procedure),
Dermatology (morphology, distribution + body map, extent % BSA, leprosy screen,
bedside tests, consented photos), Gynaecology (menstrual, G/P/L/A, LMP → EDD /
POG, antenatal, P/A · P/S · P/V, USG).

## 4. Where every piece of consult data is stored

| Data | Table · column |
|---|---|
| The visit (token, status, purpose, doctor, department, service, fee, follow-up link, lab order link) | `opd_visits` (`Token`, `Status`, `Purpose`, `QuotedFee`, `FeeOverride`, `IsFollowUp`, `FollowUpOfVisitId`, `BillId`, `LabOrderId`, timestamps per step) |
| Token numbers (per doctor per IST day) / visit & invoice numbers | `opd_token_counters`, `opd_sequences` (atomic counters) |
| Vitals | `opd_vitals` (BP, pulse, SpO₂, temp °F, RR, weight, height, GRBS, pain, `ExtraJson`) |
| Consult bill, lines, payments, refunds / credit notes | `opd_bills`, `opd_bill_lines`, `opd_payments`, `opd_refunds` |
| Form answers | `opd_consult_records.AnswersJson` (keyed by field key; `{ r, l }` for left/right; media answers keep only the storage key) |
| Pinned form version | `opd_consult_records.FormVersionId` → `opd_form_versions` |
| Chief complaint, diagnoses (ICD-10 + label + primary), advice | `opd_consult_records.ChiefComplaint`, `DiagnosisJson`, `Advice` |
| Private notes + who may read them | `opd_consult_records.PrivateNotes`, `PrivateNotesVisibility` (`doctor` / `department` / `all_doctors`) |
| Follow-up | `opd_consult_records.FollowUpDate`, `FollowUpNote` → a new booked `opd_visits` row (`Source = follow_up`) |
| Prescription | `opd_rx_lines` (drug, form, dose, site, `ScheduleJson`, `DurationDays`, food, server-computed `Quantity`, allergy acknowledgement, pregnancy acknowledgement `PregnancyAck` / `PregnancyAckNote`, `DispenseStatus`) |
| Investigations | `opd_investigations` (`ItemsJson` = `[{ testId, name, specimen? }]` — `specimen` for a Test Master "choose" test, `LabOrderId`, `Status`) |
| Allergies | `opd_patient_allergies` |
| Images / videos / audiograms / PDFs | object storage (Spaces), key `{tenant-folder}/opd/consult/{visitId}/{guid}.{ext}` |

**Media.** `POST /api/opd/consult/{visitId}/media` (any format, ≤ 50 MB; a
declared image/video/PDF must really be one) writes the file under the tenant's
named folder (`tenants.StoragePrefix`, `TenantStorageKeys`) and returns
`{ id: key, name, kind, contentType, size, url }`. The answers keep the key; the
`url` is always the **authenticated** path
`GET /api/opd/consult/{visitId}/media/file?key=…` — access-checked for that
visit and tenant, streamed, ETag / 304, `Cache-Control: private`. No presigned
link is ever handed out. Walk-in paper prescriptions follow the same rule
(`{tenant-folder}/pharmacy/rx/{saleId}/…`, `GET …/counter/{id}/prescription/file`).

### Safety checks at Complete

**Complete** (`POST /api/opd/consult/{visitId}/complete`) is one transaction and refuses, before
anything is written:
- `allergy_unacknowledged` — an Rx drug matches a recorded allergy and wasn't acknowledged;
- `pregnancy_unacknowledged` — the patient is pregnant (one resolver, `Services/Opd/Consult/PregnancyStatus.cs`:
  a form answer `pregnancy_status = Pregnant`, or an O / Z33 / Z34 / Z36 diagnosis, in the last 300 days)
  and an Rx drug's `pharmacy_drugs.PregnancyRisk` is `avoid` / `contraindicated` without an acknowledgement;
- `required_missing` — a visible required form question is unanswered (`OpdFormSchemaRules.MissingRequired`);
- `specimen_required` — an investigation whose Test Master specimen mode is "choose" has no specimen.

## 5. How it flows to the lab

- **At the desk**: lab tests picked while booking create an ordinary lab order
  (`OrderService.CreateAsync`) with its own lab bill; `opd_visits.LabOrderId`
  links it.
- **From the consult**: on **Complete**, the investigations become ONE ordinary
  lab order (same `OrderService.CreateAsync`, the doctor as referrer, the chosen
  specimens as `CreateOrderInput.Specimens`);
  `opd_investigations.LabOrderId` + `Status = ordered`. From there it is a normal
  lab order: it shows in the front desk's orders, the sample-collection queue,
  results, validation and reports exactly like any other. Nothing in the lab
  knows about OPD.

## 6. How it flows to the pharmacy

1. Complete consult → the Rx lines (`opd_rx_lines`, `DispenseStatus = pending`)
   put the visit on the pharmacy queue (`GET /api/opd/pharmacy/rx-queue`).
2. The pharmacist opens the prescription: quantity per line is derived from the
   schedule (`RxScheduleMath.Quantity` — never free text); batches are offered
   earliest-expiry first (**FEFO**) or by the pharmacist's pick (Pharmacy
   settings `batchPick`); same-generic substitutes are listed.
3. Dispense (`POST …/rx/{visitId}/dispense`) writes `pharmacy_dispenses` +
   `pharmacy_dispense_lines` (drug, **batch**, qty, MRP, GST), deducts
   `pharmacy_batches.QtyOnHand` and appends a `pharmacy_stock_moves` row
   (`Kind = dispense` for a prescription, `sale` for a walk-in; negative qty) in one transaction under a row lock. A
   Schedule H1 / X line also writes `pharmacy_h1_register`.
4. The sale is billed (`opd_bills` `Kind = pharmacy`, GST split CGST / SGST) and
   paid (`opd_payments`) — at the counter, or later: "Give, bill later" leaves a
   balance that `POST /api/opd/pharmacy/dispenses/{id}/pay` collects. Discounts
   follow the same role cap as the lab bill. The printed bill is a GST tax
   invoice (letterhead from the branch GST config, per-line HSN / batch / expiry,
   CGST / SGST, amount in words).
   A dispensed quantity above the Rx quantity needs a reason
   (`pharmacy_dispense_lines.OverrideReason`, ≤ 5× the Rx, never more than stock).
   H1 / X lines need the patient's address and are numbered in the H1 register
   (`pharmacy_h1_register.Serial`, `PatientAddress`, `PrescriberAddress`).
5. Walk-in customers use the same engine without a visit (`Kind = walk_in`).

**Stock.** Every change is a ledger row in `pharmacy_stock_moves`: `receive`
(opening stock / GRN against a purchase order — `pharmacy_purchase_orders`,
`…_lines`), `dispense` / `sale`, `return_in` (patient return: back onto the same batch; a PAID
bill gets a credit note in `opd_refunds`, an unpaid bill is reduced instead), `return_out` (to the supplier), `adjust`, `expire`. On-hand per
batch is `pharmacy_batches.QtyOnHand`; reorder levels in `pharmacy_reorder_levels`.

**Drug master.** `pharmacy_drugs`: rows with `TenantId = null` are the Prefrontal
master; a tenant edit writes a copy-on-write override row with the same
`CatalogKey`; `local-…` keys are the tenant's own drugs. `Schedule` = none / G / H /
H1 / X (H1 and X are enforced: prescription required + register). `PregnancyRisk`
(`safe` / `caution` / `avoid` / `contraindicated`) + `PregnancyNote` drive the
pregnancy chips in the Rx editor and at dispensing.

## 7. Seeding a clinic (dev / demo)

`tools/opd-seed/seed.mjs` creates, through the app's own APIs and safe to re-run:
the three India forms (published), departments, services with INR fees and
follow-up rules, a *Doctor (OPD)* role with six doctor logins (credentials go
only to a chmod-600 file), ~130 NLEM-2022-anchored drugs with CDSCO schedules
(well-known brands flagged SAMPLE), 30 diagnosis templates, two demo suppliers
and two batches of opening stock per drug (one near expiry, to show FEFO).
See the header of the script for the exact command.
