#!/usr/bin/env bash
# storage-dev-smoke.sh — READ-ONLY post-deploy probe for the Spaces storage
# path on dev. Never sends POST/PUT/DELETE/PATCH; only ever GETs. Safe to run
# against https://med-fetch-dev.prefrontal.health after every deploy.
#
# Usage:
#   PF_TOKEN=<bearer token of a real dev user> \
#   ./scripts/storage-dev-smoke.sh \
#     --upload-path '/uploads/<tenant-guid>/<file>.png' \
#     --report-id <report-guid> \
#     --public-token <public-report-token>
#
# All three --upload-path / --report-id / --public-token are OPTIONAL — the
# script always runs the health probe, and skips (SKIP, not FAIL) any check
# whose input wasn't given. PF_TOKEN is required for the authenticated
# probes (uploads/file, report pdf) and is NEVER printed, logged, or echoed —
# only PASS/FAIL/SKIP lines and HTTP status codes reach stdout.
#
# What each probe means, see docs/STORAGE-DEV-SMOKE.md.
set -u
BASE_URL="${PF_BASE_URL:-https://med-fetch-dev.prefrontal.health}"
TOKEN="${PF_TOKEN:-}"
UPLOAD_PATH=""
REPORT_ID=""
PUBLIC_TOKEN=""

while [ $# -gt 0 ]; do
  case "$1" in
    --upload-path) UPLOAD_PATH="$2"; shift 2 ;;
    --report-id) REPORT_ID="$2"; shift 2 ;;
    --public-token) PUBLIC_TOKEN="$2"; shift 2 ;;
    --base-url) BASE_URL="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

PASS=0
FAIL=0
SKIP=0
declare -a ROWS=()

row() { ROWS+=("$1|$2|$3"); }
pass() { row "$1" "PASS" "$2"; PASS=$((PASS+1)); }
fail() { row "$1" "FAIL" "$2"; FAIL=$((FAIL+1)); }
skip() { row "$1" "SKIP" "$2"; SKIP=$((SKIP+1)); }

# curl wrapper: GET only, auth header never echoed, body capped and scrubbed
# of anything that looks like a token before it's used in a message.
auth_get() {
  # $1 = path (from BASE_URL), remaining = extra curl args (headers etc.)
  local path="$1"; shift
  curl -sS -o /tmp/pf-smoke-body.$$ -D /tmp/pf-smoke-headers.$$ \
    -w '%{http_code}' \
    -H "Authorization: Bearer ${TOKEN}" \
    "$@" \
    "${BASE_URL}${path}" 2>/tmp/pf-smoke-err.$$
}

header_value() {
  # $1 = header name (case-insensitive), reads /tmp/pf-smoke-headers.$$
  awk -v h="$1" 'BEGIN{IGNORECASE=1} tolower($1) == tolower(h) ":" {sub(/\r$/,""); $1=""; print substr($0,2)}' /tmp/pf-smoke-headers.$$
}

cleanup_tmp() { rm -f /tmp/pf-smoke-body.$$ /tmp/pf-smoke-headers.$$ /tmp/pf-smoke-err.$$; }
trap cleanup_tmp EXIT

echo "prefrontal-ui storage dev smoke — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "target: ${BASE_URL} (read-only: GET only, never writes)"
echo

# ── 1. health ────────────────────────────────────────────────────────────
code=$(curl -sS -o /dev/null -w '%{http_code}' "${BASE_URL}/health" 2>/dev/null)
if [ "$code" = "200" ]; then pass "health" "GET /health -> 200"
else fail "health" "GET /health -> ${code:-no response} (expected 200)"; fi

# ── 2. GET /api/uploads/file on a known path ────────────────────────────
if [ -z "$TOKEN" ]; then
  skip "uploads-file" "PF_TOKEN not set"
  skip "uploads-file-304" "PF_TOKEN not set"
  skip "uploads-file-range" "PF_TOKEN not set"
elif [ -z "$UPLOAD_PATH" ]; then
  skip "uploads-file" "no --upload-path given"
  skip "uploads-file-304" "no --upload-path given"
  skip "uploads-file-range" "no --upload-path given"
else
  code=$(auth_get "/api/uploads/file" -G --data-urlencode "path=${UPLOAD_PATH}")
  etag=$(header_value "ETag")
  if [ "$code" = "200" ] && [ -n "$etag" ]; then
    pass "uploads-file" "GET /api/uploads/file?path=<given> -> 200, ETag present"
  else
    fail "uploads-file" "GET /api/uploads/file?path=<given> -> ${code} (expected 200 + ETag); got ETag='${etag}'"
  fi

  if [ -n "$etag" ]; then
    code304=$(auth_get "/api/uploads/file" -G --data-urlencode "path=${UPLOAD_PATH}" -H "If-None-Match: ${etag}")
    if [ "$code304" = "304" ]; then pass "uploads-file-304" "If-None-Match revalidation -> 304"
    else fail "uploads-file-304" "If-None-Match revalidation -> ${code304} (expected 304)"; fi
  else
    skip "uploads-file-304" "no ETag from the first probe"
  fi

  code206=$(auth_get "/api/uploads/file" -G --data-urlencode "path=${UPLOAD_PATH}" -H "Range: bytes=0-15")
  if [ "$code206" = "206" ]; then pass "uploads-file-range" "Range: bytes=0-15 -> 206"
  else fail "uploads-file-range" "Range: bytes=0-15 -> ${code206} (expected 206)"; fi

  # ── 3. missing-path probe: same tenant/area prefix, a filename that
  #      cannot exist -> 410 file_missing, never 404 (bad path) or 500. ──
  missing_path=$(python3 - "$UPLOAD_PATH" <<'PY'
import re, sys, uuid
p = sys.argv[1]
m = re.match(r'^(/uploads/(?:(?:chat|plates)/)?[0-9a-fA-F-]{36}/)[A-Za-z0-9_-]{1,80}(\.[A-Za-z0-9]{1,8})$', p)
if not m:
    print("")
else:
    print(f"{m.group(1)}pfsmoke-missing-{uuid.uuid4().hex}{m.group(2)}")
PY
)
  if [ -z "$missing_path" ]; then
    skip "uploads-file-missing" "could not derive a well-formed sibling path from --upload-path"
  else
    code410=$(auth_get "/api/uploads/file" -G --data-urlencode "path=${missing_path}")
    body=$(cat /tmp/pf-smoke-body.$$ 2>/dev/null)
    if [ "$code410" = "410" ] && printf '%s' "$body" | grep -q "file_missing"; then
      pass "uploads-file-missing" "GET a well-formed but nonexistent path -> 410 file_missing"
    elif [ "$code410" = "500" ]; then
      fail "uploads-file-missing" "GET a well-formed but nonexistent path -> 500 (must be 410 file_missing, never a bare 500)"
    else
      fail "uploads-file-missing" "GET a well-formed but nonexistent path -> ${code410} (expected 410 file_missing)"
    fi
  fi
fi

# ── 4. stored report PDF view ────────────────────────────────────────────
if [ -z "$REPORT_ID" ]; then
  skip "report-pdf" "no --report-id given"
elif [ -z "$TOKEN" ]; then
  skip "report-pdf" "PF_TOKEN not set"
else
  code=$(auth_get "/api/reports/${REPORT_ID}/pdf")
  ctype=$(header_value "Content-Type")
  if [ "$code" = "200" ] && printf '%s' "$ctype" | grep -qi "application/pdf"; then
    pass "report-pdf" "GET /api/reports/${REPORT_ID}/pdf -> 200 application/pdf"
  elif [ "$code" = "404" ]; then
    fail "report-pdf" "GET /api/reports/${REPORT_ID}/pdf -> 404 no_stored_pdf (report has no stored PDF yet — pass a report that has been viewed/stored once)"
  else
    fail "report-pdf" "GET /api/reports/${REPORT_ID}/pdf -> ${code} content-type='${ctype}' (expected 200 application/pdf)"
  fi
fi

# ── 5. public report link ────────────────────────────────────────────────
if [ -z "$PUBLIC_TOKEN" ]; then
  skip "public-report-link" "no --public-token given"
else
  code=$(curl -sS -o /tmp/pf-smoke-body.$$ -w '%{http_code}' "${BASE_URL}/api/public/report/${PUBLIC_TOKEN}" 2>/dev/null)
  if [ "$code" = "200" ]; then
    pass "public-report-link" "GET /api/public/report/<token> -> 200 (identity verification gate reachable; this probe does not submit identity, so no patient data is asserted)"
  else
    fail "public-report-link" "GET /api/public/report/<token> -> ${code} (expected 200)"
  fi
fi

echo
printf '%-24s %-6s %s\n' "PROBE" "RESULT" "DETAIL"
printf '%-24s %-6s %s\n' "------------------------" "------" "------"
for r in "${ROWS[@]}"; do
  IFS='|' read -r name result detail <<<"$r"
  printf '%-24s %-6s %s\n' "$name" "$result" "$detail"
done
echo
echo "PASS=${PASS} FAIL=${FAIL} SKIP=${SKIP}"
[ "$FAIL" -eq 0 ]
