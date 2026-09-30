# Storage dev smoke

After every deploy that touches storage (`SpacesStorageService`, `UploadStore`,
`UploadsController`, `ReportsController`'s stored-PDF endpoints), run the
automated probe below, then click through the manual list. Both are
**read-only** against `https://med-fetch-dev.prefrontal.health` — nothing is
uploaded, changed, or deleted. Never point either at stage or prod.

## Automated: `scripts/storage-dev-smoke.sh`

```bash
export PF_TOKEN='<bearer token of a real dev user — never commit or paste this anywhere>'
./scripts/storage-dev-smoke.sh \
  --upload-path '/uploads/<tenant-guid>/<some-file>.png' \
  --report-id '<a report guid that has been viewed at least once>' \
  --public-token '<a live public report link token>'
```

All three `--upload-path` / `--report-id` / `--public-token` are optional —
omit what you don't have and that probe prints `SKIP`, not `FAIL`. The token
value is never printed, logged, or echoed by the script.

Where to get the inputs:
- `--upload-path`: open any patient's report/result/document with attachments
  in dev, open devtools → Network, find a `GET /api/uploads/file?path=...`
  request, copy the `path` query value.
- `--report-id`: the `id` in a `GET /api/reports/{id}/pdf` request for a
  report you've already opened once (so it has a stored PDF).
- `--public-token`: the `token` segment of a report's WhatsApp / SMS link
  (`.../reports/public/<token>`).
- `PF_TOKEN`: your own dev session's bearer token (devtools → Network → any
  `/api/...` request → `Authorization` header, minus the `Bearer ` prefix).

### What it checks

| Probe | Expects | A FAIL usually means |
|---|---|---|
| `health` | `GET /health` → 200 | the app didn't start / DB unreachable |
| `uploads-file` | `GET /api/uploads/file?path=...` → 200 + an `ETag` header | storage misconfigured (503) or the path/token is stale |
| `uploads-file-304` | same request with `If-None-Match: <etag>` → 304 | ETag revalidation regressed (would mean every render re-fetches from storage) |
| `uploads-file-range` | same request with `Range: bytes=0-15` → 206 | range support regressed (audio/video seeking would break) |
| `uploads-file-missing` | a sibling path that can't exist → 410 `file_missing`, never 500 | the dev incident class: a missing object leaking a raw SDK/500 instead of the friendly 410 |
| `report-pdf` | `GET /api/reports/{id}/pdf` → 200 `application/pdf` | the report's stored PDF is missing or storage is down |
| `public-report-link` | `GET /api/public/report/{token}` → 200 | the public link route is broken (this probe does not submit identity, so it proves reachability only, not that patient data unlocks correctly) |

A FAIL that shows **500** anywhere is worse than a FAIL that shows **503**:
503 means the app correctly detected a storage problem and told the caller;
500 means a raw exception (possibly SDK text) reached the response — that's
the dev incident (`Amazon.Runtime.Internal.HttpErrorResponseException` was
seen leaking to the UI once) and should be treated as a regression, not a
transient blip.

## Manual click list

For each row: do the action in dev, then check the expected result. A
**failure** column tells you what a broken storage path looks like so you
don't mistake it for something else.

| Area | Action | Expected | Failure looks like |
|---|---|---|---|
| Report template | Admin → Report template → upload a logo | Logo appears immediately in the preview and survives a refresh | A toast reading "Storage unavailable, try again" (503) is an honest failure; a toast with `Amazon.` / `HttpErrorResponseException` / a stack trace is a bug |
| Result entry | Enter a result → attach a microscopy/instrument image | Thumbnail renders inline within a few seconds | Thumbnail stays a spinner forever (no error surfaced), or shows broken-image with a raw error toast |
| Chat | Messages → send an image attachment, then a voice note | Both render inline (image thumbnail, audio player with a working scrubber) | Attachment renders as a bare "message" with no media, or console shows a raw fetch error |
| Outsourced / partner report | Frontdesk → Outsourced tab → attach a partner PDF, then open the combined PDF | Combined PDF opens showing both the in-house and partner pages | "Could not load report" toast, or the combined PDF is missing the partner's pages |
| Patient documents | Patient profile → Documents tab → upload, view, delete a document | Upload appears in the list at once; view opens it; delete removes it and a second view shows a friendly "no longer available, upload again" if re-opened from a stale link | View spins forever, or delete succeeds but the file is still viewable (would mean storage delete didn't run) |
| Expenses | Expense tracker → add an expense → attach a bill photo | Bill thumbnail shows on the expense row | Row shows no attachment icon at all, or clicking it errors |
| Vendors | Vendor wallet → record a payment → attach proof of payment | Proof thumbnail visible on the ledger row | Same failure shape as expenses |
| OPD | OPD consult → attach a photo/document to the consult | Attachment visible in the consult's media list | Attach button does nothing / silent failure |
| Pharmacy | Pharmacy walk-in → if Rx image upload is offered, attach one | Rx image visible on the dispense screen | Same |
| Reports (core) | Open a finalized report → View, Download, Print, then WhatsApp-send it | View renders the PDF; Download saves a real PDF file; Print opens the browser print dialog with the report; WhatsApp send shows a delivered/sent status | View shows a blank page or a raw error string instead of the report; Download saves a 0-byte or HTML error file; WhatsApp send silently does nothing |

### Reading a failure

- **A friendly toast/message, no raw exception text** → the UI is handling
  the storage error correctly even if storage itself is having a bad moment;
  file it as an infra issue (check the automated probe's `health` /
  `uploads-file` rows), not a UI bug.
- **Raw exception text anywhere in the UI** (`Amazon.`, `HttpErrorResponseException`,
  a .NET stack trace, `System.`) → this is the exact bug class the dev
  incident showed. File it as a UI bug: the component/interceptor is passing
  `error.message` straight to a toast instead of mapping the error code to
  a friendly string.
- **A spinner that never resolves** → likely a 410/503 the component isn't
  listening for at all. File it as a UI bug.
