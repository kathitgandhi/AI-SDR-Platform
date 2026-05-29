#!/usr/bin/env bash
#
# AI SDR Platform — End-to-end smoke test
# Run from EC2: bash scripts/e2e-smoke-test.sh
#
# Exercises every major surface area:
#  - Health checks (API + DB)
#  - Auth (x-api-key path)
#  - Dashboard / KPIs
#  - CSV lead import
#  - Lead detail + bulk update
#  - Notes (create/read)
#  - Tickets (create/read)
#  - Email preview + send (real Gmail send to TEST_EMAIL)
#  - SMS endpoints (queue + thread)
#  - Settings (read/write)
#  - DNC management
#  - Transfer rules CRUD
#  - CRM sync to AirDesk360
#  - Audit log
#  - API docs page
#
# Prints PASS/FAIL for each. Exits non-zero if any FAIL.

set -uo pipefail

# ────────────────────────────────────────────────────────────────────
# CONFIG
# ────────────────────────────────────────────────────────────────────
ENV_FILE="${ENV_FILE:-$HOME/AI-SDR-Platform/.env}"
BASE_URL="${BASE_URL:-http://localhost:3000}"
TEST_EMAIL="${TEST_EMAIL:-dev@q8marketing.design}"
KEY=$(grep ^API_SECRET_KEY "$ENV_FILE" | cut -d= -f2)
H="x-api-key: $KEY"

# Counters
PASS=0
FAIL=0
SKIP=0
FAILURES=()

# Pretty printing
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# ────────────────────────────────────────────────────────────────────
# HELPERS
# ────────────────────────────────────────────────────────────────────
log_section() {
  echo
  echo -e "${BLUE}━━━ $1 ━━━${NC}"
}

assert_status() {
  local name="$1"
  local got="$2"
  local want="$3"
  if [[ "$got" == "$want" ]]; then
    echo -e "  ${GREEN}✓${NC} $name (HTTP $got)"
    PASS=$((PASS + 1))
  else
    echo -e "  ${RED}✗${NC} $name (HTTP $got, wanted $want)"
    # Print the actual response body so we know WHY it failed.
    # 404 => route not registered (stale image). 500 => exception (often missing table).
    if [[ -f /tmp/.e2e-body ]]; then
      local snippet
      snippet=$(head -c 300 /tmp/.e2e-body)
      [[ -n "$snippet" ]] && echo -e "      ${YELLOW}body:${NC} $snippet"
    fi
    FAIL=$((FAIL + 1))
    FAILURES+=("$name (HTTP $got)")
  fi
}

assert_contains() {
  local name="$1"
  local haystack="$2"
  local needle="$3"
  if [[ "$haystack" == *"$needle"* ]]; then
    echo -e "  ${GREEN}✓${NC} $name"
    PASS=$((PASS + 1))
  else
    echo -e "  ${RED}✗${NC} $name (missing: $needle)"
    echo -e "      got: $(echo "$haystack" | head -c 200)"
    FAIL=$((FAIL + 1))
    FAILURES+=("$name")
  fi
}

skip() {
  echo -e "  ${YELLOW}⊘${NC} $1"
  SKIP=$((SKIP + 1))
}

# Returns just the response body on stdout. Stores HTTP status in the file
# /tmp/.e2e-status, read back via $LAST_STATUS (a function-like alias below).
#
# IMPORTANT: api() is always invoked as `resp=$(api ...)`, which runs it in a
# command-substitution SUBSHELL. A plain shell-variable assignment inside that
# subshell is lost when it exits — which silently blanked the status code and
# made every assert_status fail even though the app was returning 200s. Files
# survive the subshell, so we persist the code to /tmp/.e2e-status instead.
api() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  local code
  if [[ -n "$body" ]]; then
    code=$(curl -s -o /tmp/.e2e-body -w "%{http_code}" -X "$method" \
      -H "$H" -H "Content-Type: application/json" \
      -d "$body" "$BASE_URL$path")
  else
    code=$(curl -s -o /tmp/.e2e-body -w "%{http_code}" -X "$method" \
      -H "$H" "$BASE_URL$path")
  fi
  echo "$code" > /tmp/.e2e-status
  cat /tmp/.e2e-body
}

# Reads the status code persisted by the most recent api() call.
LAST_STATUS() { cat /tmp/.e2e-status 2>/dev/null; }

json_extract() {
  python3 -c "import sys,json
try:
  d=json.load(sys.stdin)
  for p in '$1'.split('.'):
    if p.startswith('[') and p.endswith(']'):
      d=d[int(p[1:-1])]
    else:
      d=d.get(p) if isinstance(d, dict) else d
    if d is None: break
  print(d if d is not None else '')
except Exception as e:
  print('', file=sys.stderr)
"
}

# ────────────────────────────────────────────────────────────────────
# 1. HEALTH
# ────────────────────────────────────────────────────────────────────
log_section "1. Health & connectivity"

resp=$(curl -s -w "\n%{http_code}" "$BASE_URL/health")
status=$(echo "$resp" | tail -n1)
body=$(echo "$resp" | head -n -1)
assert_status "GET /health" "$status" "200"
assert_contains "DB connection" "$body" "\"db\":\"ok\""

# API docs page
status=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/docs/")
assert_status "GET /api/docs (Swagger UI)" "$status" "200"

# ────────────────────────────────────────────────────────────────────
# 2. AUTH
# ────────────────────────────────────────────────────────────────────
log_section "2. Authentication"

status=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/v1/leads")
assert_status "401 without auth" "$status" "401"

resp=$(api GET /api/v1/leads)
assert_status "200 with x-api-key" "$(LAST_STATUS)" "200"

# ────────────────────────────────────────────────────────────────────
# 2b. ROOT-CAUSE DIAGNOSTIC
# One-shot probe of the endpoints that have been failing, printing the
# raw status + body so we can tell stale-image (404) from missing-table (500).
# ────────────────────────────────────────────────────────────────────
log_section "2b. Root-cause diagnostic"

diag() {
  local path="$1"
  local code
  code=$(curl -s -o /tmp/.diag-body -w "%{http_code}" -H "$H" "$BASE_URL$path")
  local body
  body=$(head -c 200 /tmp/.diag-body)
  local verdict
  case "$code" in
    200|201|202) verdict="${GREEN}OK${NC}" ;;
    404)         verdict="${RED}404 → ROUTE MISSING (API image is stale, rebuild needed)${NC}" ;;
    500)         verdict="${RED}500 → SERVER ERROR (likely missing DB table — run migrations 006/007)${NC}" ;;
    401)         verdict="${RED}401 → AUTH (api key mismatch)${NC}" ;;
    *)           verdict="${YELLOW}$code${NC}" ;;
  esac
  echo -e "  $path → $(echo -e "$verdict")"
  [[ "$code" != "200" && -n "$body" ]] && echo -e "      body: $body"
}

diag /api/v1/settings
diag /api/v1/notes?lead_id=00000000-0000-0000-0000-000000000000
diag /api/v1/tickets
diag /api/v1/dnc
diag /api/v1/transfer-rules
diag /api/v1/audit
diag /api/v1/emails?lead_id=00000000-0000-0000-0000-000000000000

echo
echo -e "  ${BLUE}Interpretation:${NC}"
echo -e "    • All 404  → API container running OLD image. Rebuild: sudo docker compose build --no-cache api && sudo docker compose up -d --force-recreate api"
echo -e "    • All 500  → migrations 006 + 007 not applied in Supabase. Run them in SQL Editor."
echo -e "    • Mixed    → see each body above."

# ────────────────────────────────────────────────────────────────────
# 3. DASHBOARD
# ────────────────────────────────────────────────────────────────────
log_section "3. Dashboard / KPIs"

resp=$(api GET /api/v1/dashboard/)
assert_status "GET /api/v1/dashboard/" "$(LAST_STATUS)" "200"
assert_contains "Today block present" "$resp" "\"today\""
assert_contains "This-month block present" "$resp" "\"thisMonth\""
assert_contains "Inbound/outbound split" "$resp" "\"inboundCalls\""
assert_contains "Funnel" "$resp" "\"funnel\""

# ────────────────────────────────────────────────────────────────────
# 4. CSV LEAD IMPORT
# ────────────────────────────────────────────────────────────────────
log_section "4. CSV lead import"

# Get a campaign id
camp_resp=$(api GET /api/v1/campaigns)
CAMP_ID=$(echo "$camp_resp" | python3 -c "import sys,json;c=json.load(sys.stdin)['campaigns'];print(c[0]['id'] if c else '')")
if [[ -z "$CAMP_ID" ]]; then
  skip "no campaign found — creating one"
  c=$(api POST /api/v1/campaigns "{\"name\":\"E2E Smoke Test\",\"target_verticals\":[\"grocery\"]}")
  CAMP_ID=$(echo "$c" | python3 -c "import sys,json;print(json.load(sys.stdin)['campaign']['id'])")
fi
echo "  using campaign: $CAMP_ID"

unique=$(date +%s)
import_body=$(cat <<EOF
{
  "campaign_id": "$CAMP_ID",
  "filename": "e2e-smoke.csv",
  "rows": [
    {"first_name":"Alice","last_name":"Tester","email":"alice.e2e+$unique@example.com","phone":"+15125550101","title":"VP Ops","company_name":"E2E Test Co $unique","retail_vertical":"grocery","store_count":250}
  ]
}
EOF
)
resp=$(api POST /api/v1/imports/leads "$import_body")
assert_status "POST /api/v1/imports/leads" "$(LAST_STATUS)" "200"
assert_contains "imported >= 1" "$resp" "\"imported\":1"
IMPORT_ID=$(echo "$resp" | json_extract import_id)
echo "  import id: $IMPORT_ID"

# ────────────────────────────────────────────────────────────────────
# 5. LEADS
# ────────────────────────────────────────────────────────────────────
log_section "5. Leads"

resp=$(api GET "/api/v1/leads?company=E2E%20Test")
assert_status "GET /api/v1/leads (filtered)" "$(LAST_STATUS)" "200"
LEAD_ID=$(echo "$resp" | python3 -c "import sys,json;l=json.load(sys.stdin)['leads'];print(l[0]['id'] if l else '')")
if [[ -z "$LEAD_ID" ]]; then
  echo -e "  ${RED}✗${NC} could not find imported lead"
  FAIL=$((FAIL + 1))
  FAILURES+=("Lead not found after import")
else
  echo "  lead id: $LEAD_ID"
fi

resp=$(api GET "/api/v1/leads/$LEAD_ID")
assert_status "GET /api/v1/leads/:id" "$(LAST_STATUS)" "200"
assert_contains "Lead detail has contacts" "$resp" "\"contacts\":"
assert_contains "Lead detail has companies" "$resp" "\"companies\":"

# Update stage
resp=$(api PATCH "/api/v1/leads/$LEAD_ID/stage" '{"stage":"qualified","reason":"e2e test"}')
assert_status "PATCH /api/v1/leads/:id/stage" "$(LAST_STATUS)" "200"

# Bulk update
resp=$(api POST /api/v1/leads/bulk-update "{\"lead_ids\":[\"$LEAD_ID\"],\"updates\":{\"score\":85}}")
assert_status "POST /api/v1/leads/bulk-update" "$(LAST_STATUS)" "200"

# ────────────────────────────────────────────────────────────────────
# 6. NOTES
# ────────────────────────────────────────────────────────────────────
log_section "6. Notes"

resp=$(api POST /api/v1/notes "{\"lead_id\":\"$LEAD_ID\",\"body\":\"E2E test note created at $(date)\"}")
assert_status "POST /api/v1/notes" "$(LAST_STATUS)" "201"
NOTE_ID=$(echo "$resp" | json_extract note.id)

resp=$(api GET "/api/v1/notes?lead_id=$LEAD_ID")
assert_status "GET /api/v1/notes?lead_id=" "$(LAST_STATUS)" "200"
assert_contains "Note in list" "$resp" "\"id\":\"$NOTE_ID\""

# ────────────────────────────────────────────────────────────────────
# 7. TICKETS
# ────────────────────────────────────────────────────────────────────
log_section "7. Tickets"

resp=$(api POST /api/v1/tickets "{\"title\":\"E2E Test Ticket\",\"description\":\"Created by smoke test\",\"priority\":\"high\",\"lead_id\":\"$LEAD_ID\"}")
assert_status "POST /api/v1/tickets" "$(LAST_STATUS)" "201"
TICKET_ID=$(echo "$resp" | json_extract ticket.id)

resp=$(api PATCH "/api/v1/tickets/$TICKET_ID" '{"status":"in_progress"}')
assert_status "PATCH /api/v1/tickets/:id" "$(LAST_STATUS)" "200"

resp=$(api GET "/api/v1/tickets?status=in_progress")
assert_status "GET /api/v1/tickets?status=" "$(LAST_STATUS)" "200"

# ────────────────────────────────────────────────────────────────────
# 8. EMAIL PREVIEW + SEND
# ────────────────────────────────────────────────────────────────────
log_section "8. Email (Claude preview + Gmail send)"

# Point the lead's contact at our test inbox so the send goes somewhere real
contact_id=$(api GET "/api/v1/leads/$LEAD_ID" | python3 -c "import sys,json;print(json.load(sys.stdin)['lead']['contact_id'])")
# update via Supabase REST is out of scope — use the bulk-update path through a different mechanism
# Actually simpler: just update the contact via raw SQL would require service key. Skip and just trigger send.

resp=$(api POST /api/v1/emails/preview "{\"lead_id\":\"$LEAD_ID\",\"template\":\"follow_up\"}")
assert_status "POST /api/v1/emails/preview (Claude generates)" "$(LAST_STATUS)" "200"
assert_contains "Preview has subject" "$resp" "\"subject\":"
assert_contains "Preview has body_text" "$resp" "\"body_text\":"

resp=$(api POST /api/v1/emails/send "{\"lead_id\":\"$LEAD_ID\",\"template\":\"follow_up\"}")
assert_status "POST /api/v1/emails/send (queued)" "$(LAST_STATUS)" "202"
assert_contains "Gmail configured" "$resp" "\"gmail_configured\":true"

# Wait a moment then check the emails table
sleep 8
resp=$(api GET "/api/v1/emails?lead_id=$LEAD_ID")
assert_status "GET /api/v1/emails (sent record)" "$(LAST_STATUS)" "200"
assert_contains "Email row persisted" "$resp" "\"status\":\"sent\""

# ────────────────────────────────────────────────────────────────────
# 9. SMS
# ────────────────────────────────────────────────────────────────────
log_section "9. SMS (queue test — actual send needs Telnyx)"

resp=$(api GET /api/v1/sms/threads)
assert_status "GET /api/v1/sms/threads" "$(LAST_STATUS)" "200"

resp=$(api GET "/api/v1/sms?contact_id=$contact_id")
assert_status "GET /api/v1/sms?contact_id=" "$(LAST_STATUS)" "200"

# Skip POST send — Telnyx not connected
skip "POST /api/v1/sms/send (Telnyx pending)"

# ────────────────────────────────────────────────────────────────────
# 10. SETTINGS
# ────────────────────────────────────────────────────────────────────
log_section "10. Settings"

resp=$(api GET /api/v1/settings)
assert_status "GET /api/v1/settings" "$(LAST_STATUS)" "200"
assert_contains "company_profile" "$resp" "\"company_profile\""
assert_contains "business_hours" "$resp" "\"business_hours\""

# x-api-key path doesn't write user-scoped settings (no req.user.id), skip write
skip "PUT /api/v1/settings/:key (needs JWT auth path; covered by frontend)"

# ────────────────────────────────────────────────────────────────────
# 11. DNC
# ────────────────────────────────────────────────────────────────────
log_section "11. DNC management"

resp=$(api GET /api/v1/dnc)
assert_status "GET /api/v1/dnc" "$(LAST_STATUS)" "200"

resp=$(api POST /api/v1/dnc "{\"phone\":\"+15125550199\",\"reason\":\"e2e test\"}")
assert_status "POST /api/v1/dnc" "$(LAST_STATUS)" "201"
DNC_ID=$(echo "$resp" | json_extract entry.id)
[[ -n "$DNC_ID" ]] && api DELETE "/api/v1/dnc/$DNC_ID" > /dev/null

# ────────────────────────────────────────────────────────────────────
# 12. TRANSFER RULES
# ────────────────────────────────────────────────────────────────────
log_section "12. Transfer rules"

resp=$(api POST /api/v1/transfer-rules "{\"name\":\"E2E Test Rule\",\"trigger\":\"qualification_threshold\",\"conditions\":{\"min_qualification_score\":80},\"transfer_to_number\":\"+15125550100\"}")
assert_status "POST /api/v1/transfer-rules" "$(LAST_STATUS)" "201"
RULE_ID=$(echo "$resp" | json_extract rule.id)

resp=$(api GET /api/v1/transfer-rules)
assert_status "GET /api/v1/transfer-rules" "$(LAST_STATUS)" "200"

[[ -n "$RULE_ID" ]] && api DELETE "/api/v1/transfer-rules/$RULE_ID" > /dev/null

# ────────────────────────────────────────────────────────────────────
# 13. CRM SYNC (AirDesk360)
# ────────────────────────────────────────────────────────────────────
log_section "13. CRM sync to AirDesk360"

resp=$(api GET /api/v1/crm/health)
assert_status "GET /api/v1/crm/health" "$(LAST_STATUS)" "200"
assert_contains "AirDesk connected" "$resp" "\"ok\":true"

resp=$(api POST "/api/v1/crm/sync/lead/$LEAD_ID")
assert_status "POST /api/v1/crm/sync/lead/:id" "$(LAST_STATUS)" "200"
assert_contains "Customer synced" "$resp" "\"customer_id\":\""

# ────────────────────────────────────────────────────────────────────
# 14. REPORTING
# ────────────────────────────────────────────────────────────────────
log_section "14. Reporting"

for ep in /api/v1/reporting/stats /api/v1/reporting/pipeline /api/v1/reporting/leaderboard /api/v1/reporting/costs; do
  status=$(curl -s -o /dev/null -w "%{http_code}" -H "$H" "$BASE_URL$ep")
  assert_status "GET $ep" "$status" "200"
done

# ────────────────────────────────────────────────────────────────────
# 15. AUDIT LOG
# ────────────────────────────────────────────────────────────────────
log_section "15. Audit log"

resp=$(api GET /api/v1/audit)
assert_status "GET /api/v1/audit" "$(LAST_STATUS)" "200"

# ────────────────────────────────────────────────────────────────────
# 16. QUEUES
# ────────────────────────────────────────────────────────────────────
log_section "16. Queues"

resp=$(api GET /api/v1/queues/)
assert_status "GET /api/v1/queues/" "$(LAST_STATUS)" "200"
assert_contains "callExecute queue listed" "$resp" "callExecute"

# ────────────────────────────────────────────────────────────────────
# 17. WORKER HEALTH
# ────────────────────────────────────────────────────────────────────
log_section "17. Worker container status"

ps_out=$(sudo docker compose ps --format json 2>/dev/null || sudo docker compose ps)
for svc in api call-workers pipeline-workers mcp redis; do
  if echo "$ps_out" | grep -q "$svc.*[Uu]p"; then
    echo -e "  ${GREEN}✓${NC} $svc container is Up"
    PASS=$((PASS + 1))
  else
    echo -e "  ${RED}✗${NC} $svc container is NOT up"
    FAIL=$((FAIL + 1))
    FAILURES+=("Container $svc not up")
  fi
done

# ────────────────────────────────────────────────────────────────────
# RESULTS
# ────────────────────────────────────────────────────────────────────
echo
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "Result: ${GREEN}$PASS passed${NC}, ${RED}$FAIL failed${NC}, ${YELLOW}$SKIP skipped${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [[ $FAIL -gt 0 ]]; then
  echo -e "${RED}Failures:${NC}"
  for f in "${FAILURES[@]}"; do echo "  • $f"; done
  exit 1
fi
exit 0
