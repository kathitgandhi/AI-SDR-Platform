# AI SDR Platform — Security, Rate Limiting & Operations Guide

## SECURITY RECOMMENDATIONS

### API Authentication
- All API endpoints require `Authorization: Bearer <API_SECRET_KEY>` header
- Webhook endpoints use HMAC-SHA256 signature verification (Telnyx, ElevenLabs)
- MCP server requires `MCP_AUTH_TOKEN` — never expose this publicly
- Rotate all API keys quarterly; use environment variables only, never commit keys

### Database Security
- Supabase Row Level Security (RLS) enabled on all sensitive tables
- Only service role key used by backend — anon key never exposed server-side
- All DNC lookups use SHA-256 hashed values — raw phone/email not stored in index
- Audit trail via `compliance_logs`, `lead_stage_history`, `consent_records`

### Network Security
- Deploy API behind Render's proxy (automatic TLS)
- Redis connection uses TLS (rediss://)
- `helmet` middleware applied: CSP, HSTS, X-Frame-Options
- CORS restricted to `ALLOWED_ORIGINS` — no wildcard in production

### Secrets Management
- All secrets in Render environment variables (encrypted at rest)
- Never log phone numbers, emails, or API keys — use masked versions in logs
- Phone numbers in logs: show only last 4 digits
- Emails in logs: show only domain part

### Webhook Validation
```
// All webhooks validated before processing:
Telnyx:    HMAC-SHA256 of payload + timestamp using TELNYX_WEBHOOK_SECRET
ElevenLabs: Token-based validation in header
Gmail:     Google OAuth2 push notification validation
```

---

## RATE LIMITING STRATEGY

### API Layer (Express)
```
Global:   100 requests/minute per IP
Webhooks: 1000 requests/minute (higher — webhook bursts expected)
Reporting: 10 requests/minute (Claude calls behind these)
Lead import: 5 requests/minute (ZoomInfo quota protection)
```

### ZoomInfo API
- Max 100 requests/minute (enforced in ZoomInfoClient)
- Sliding window counter with automatic pause
- Exponential backoff on 429 responses

### Telnyx API
- Call initiation: limited by CALL_MAX_CONCURRENT (default 10)
- Lookup API: 100 RPM hardcoded limit
- Pacing delay: CALL_PACING_DELAY_MS between call initiations

### ElevenLabs API
- One active conversation per call leg
- Session cleanup guaranteed on call end (via webhook + timeout)

### Anthropic API
- Transcript analysis: 5 concurrent (worker concurrency setting)
- Email generation: 10 concurrent
- Built-in SDK retry with exponential backoff
- Cache prompts where possible (system prompts are cache-eligible)

### Gmail API
- 250 quota units/second per user
- Email worker processes one at a time per contact thread
- Minimum 5-second delay between emails to same address

---

## ERROR HANDLING STRATEGY

### Hierarchy
```
1. Transient (retry): Network timeout, 429, 500-503 from any API
2. Permanent (skip):  404, 400 validation, DNC blocked, invalid phone
3. Fatal (alert):     Database connection loss, invalid auth, quota exhausted
```

### BullMQ Retry Policy
```typescript
// Per queue type:
call-execute:    attempts: 1  (no retry — prevents double-calls)
transcript:      attempts: 3, backoff: exponential(5s)
email-send:      attempts: 3, backoff: exponential(10s)
enrichment:      attempts: 3, backoff: exponential(30s)
phone-lookup:    attempts: 3, backoff: exponential(5s)
crm-sync:        attempts: 5, backoff: exponential(30s)
```

### Call Engine Error Recovery
- Call initiation failure → mark lead as `called_no_answer`, schedule retry
- ElevenLabs timeout → webhook-based cleanup, transcript marked as empty
- Transcript analysis failure → call still closed with outcome `error`, retry queue
- DNC check failure → BLOCK the call (fail safe — always block on error)

### Database Error Recovery
- All operations use Supabase's built-in connection pool
- Write failures retry 3× with 1s delay
- Critical writes (DNC, compliance) use upsert for idempotency

---

## RETRY STRATEGY

### Call Retries
```
Attempt 1: Initial call
Attempt 2: +60 min (configurable via CALL_RETRY_DELAY_MINUTES)
Attempt 3: +24 hours
After 3: Move to email-only nurture
```

### Voicemail Cadence
```
Attempt 1: Leave voicemail, send email immediately
Attempt 2: +2 business days, leave voicemail, no email
Attempt 3: +5 business days, final voicemail, breakup email
After 3: Move to 30-day nurture
```

### API Retry Backoff
```
Attempt 1: immediate
Attempt 2: 5 seconds
Attempt 3: 25 seconds
Attempt 4: 125 seconds
Attempt 5: 625 seconds (CRM sync only)
```

---

## WEBHOOK ARCHITECTURE

### Inbound Webhooks
```
POST /webhooks/telnyx     → Call state events (answered, hangup, voicemail detect)
POST /webhooks/elevenlabs → Conversation events (if ElevenLabs sends direct webhooks)
POST /webhooks/gmail      → Email open/click/reply/bounce events
```

### Webhook Processing Pattern
1. Validate signature immediately
2. Return 200 within 50ms (before any DB operations)
3. Process event asynchronously (fire-and-forget with error logging)
4. Idempotency: all webhook handlers use upsert or check-before-insert

### Webhook Retry Handling
- Telnyx retries up to 3× on non-200 response — handlers are idempotent
- Gmail Pub/Sub retries — event deduplication via event ID stored in call_events

---

## COST OPTIMIZATION

### Anthropic (Highest Variable Cost)
- Use `claude-opus-4-7` for transcript analysis and handoff summaries (quality-critical)
- Use `claude-haiku-4-5` for email generation (high volume, lower stakes)
- Implement prompt caching: system prompts qualify for cache tokens (5-minute TTL)
- Cache the SDR Brain prompt in ElevenLabs — don't re-send on every call
- Expected cost per call: ~$0.08-0.15 for transcript analysis
- Expected cost per email: ~$0.01-0.03 for generation

### Telnyx
- Lookup API: ~$0.005/lookup — only lookup unique numbers, cache results
- Call minutes: batch calls geographically to reduce carrier routing costs
- Don't call mobile numbers (filtered by lookup) — they have higher failure rates

### ElevenLabs
- Conversational AI pricing is per minute — keep calls under 8 minutes
- Use AMD (Answering Machine Detection) to avoid charging for machine calls
- Set CALL_MAX_DURATION_SECONDS = 600 (10 min hard limit)

### Supabase
- Use materialized views (mv_daily_stats) with scheduled refresh instead of live queries
- Index-only scans for DNC checks (hash indexes)
- Partition the `api_usage` and `error_logs` tables monthly if volume exceeds 10M rows

### ZoomInfo
- ZoomInfo charges per contact export — batch imports, don't re-pull known contacts
- Cache enrichment results (set enriched_at + re-enrich only if > 30 days old)

---

## MONITORING CHECKLIST

### Metrics to Watch
- [ ] Call connect rate (target >15%)
- [ ] Meeting booking rate (target >2% of calls)
- [ ] Voicemail delivery rate
- [ ] Email open rate per sequence
- [ ] DNC rate (flag if >2% — may indicate bad lead list)
- [ ] API error rate per provider
- [ ] Queue depth (alert if call queue > 500 waiting)
- [ ] Telnyx call failure rate
- [ ] Claude API latency (p95 > 10s = alert)

### Sentry Integration
- All unhandled exceptions and Promise rejections
- All DNC check failures (security-critical)
- All webhook signature validation failures
- Claude API errors with context (but no PII in the error payload)

### Health Check Endpoint
```
GET /health → 200 { status: "ok", db: "ok", redis: "ok", timestamp: "..." }
```
