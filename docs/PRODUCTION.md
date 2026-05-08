# Production Readiness Checklist

Use this checklist before deploying Edumy to production.

## Environment Variables (Required)

- [ ] `MONGO_URI` — MongoDB Atlas connection string
- [ ] `SESSION_SECRET` — Strong random string (min 32 chars)
- [ ] `NODE_ENV=production`

## Environment Variables (Recommended)

- [ ] `CSRF_SECRET` — Separate secret for CSRF tokens (falls back to SESSION_SECRET)
- [ ] `ADMIN_EMAILS` or `ADMIN_USER_IDS` — Admin access
- [ ] `USER_AI_KEY_ENCRYPTION_SECRET` — Encrypts user BYOK API keys at rest
- [ ] Optional `ALLOW_GLOBAL_AI_FALLBACK=true` + `AI_API_KEY` + `AI_BASE_URL` + `AI_MODEL` — admin/dev AI fallback only
- [ ] `CLOUDINARY_CLOUD_NAME` + `CLOUDINARY_KEY` + `CLOUDINARY_SECRET` — Image uploads
- [ ] `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` + `GOOGLE_CALLBACK_URL` — OAuth
- [ ] `LOG_LEVEL=info` (default in production)

## Database

- [ ] MongoDB Atlas cluster running
- [ ] Database backup strategy configured
- [ ] Connection string uses TLS/SSL
- [ ] IP whitelist includes deployment server

## Migrations

- [ ] Run `node scripts/migrate-progress-merge.js` (dry-run) — review output
- [ ] Run `node scripts/migrate-enrollment-fields.js` (dry-run) — review output
- [ ] Back up database
- [ ] Run migrations with `--apply` only after backup
- [ ] Verify sample users after migration

## Security

- [ ] `SESSION_SECRET` is strong and unique (not the dev fallback)
- [ ] No secrets in `.env.example`, `docker-compose.yml`, or source code
- [ ] CSP header working — check browser console for violations
- [ ] CSRF tokens working on all forms
- [ ] Rate limiting configured (`express-rate-limit`)
- [ ] Helmet security headers active
- [ ] Cookie `secure: true` in production (automatic when `NODE_ENV=production`)

## Health & Monitoring

- [ ] `GET /health` returns 200 with `status: "ok"`
- [ ] Monitor `/health` with uptime service (e.g., UptimeRobot, Better Stack)
- [ ] `dependencies.mongodb.status` = `"ok"`
- [ ] `dependencies.ai.status` = `"configured"` or `"not_configured"`

## Docker / CI

- [ ] `docker build -t edumy .` succeeds
- [ ] `docker compose up` starts app + MongoDB
- [ ] GitHub Actions CI passes on main branch
- [ ] Environment variables set in deployment platform (Render, Railway, etc.)

## Frontend

- [ ] Bootstrap CSS/JS SRI integrity hashes match CDN
- [ ] Font Awesome SRI hash verified
- [ ] No CSP violations in browser console
- [ ] All pages load correctly

## Logging

- [ ] Logs output JSON in production (pino default)
- [ ] No secrets logged (passwords, tokens, API keys)
- [ ] User AI API keys are never returned to the client; only masked status is displayed
- [ ] Log level appropriate (`info` or `warn`)

## Analytics Events

- [ ] `ANALYTICS_ENABLED=true` unless intentionally disabled
- [ ] `ANALYTICS_METADATA_MAX_BYTES` sized for production payloads (default `10240`)
- [ ] `analyticsevents` collection exists after first tracked event
- [ ] Indexes are present for `user + createdAt`, `course + eventType + createdAt`, and `eventType + createdAt`
- [ ] No raw IP, cookies, Authorization headers, API keys, tokens, passwords, full AI prompts, full AI responses, or note content in metadata
- [ ] Event volume is reviewed before adding a TTL index or archival job

Tracked priority events:
- `lesson_started`: lesson title/type and section/lesson indexes
- `lesson_completed`: lesson title/type, section/lesson indexes, completion source
- `video_progress`: video id, current time, duration, watched percent, playback rate, section/lesson indexes
- `course_enrolled`: course title and enrollment source
- `course_completed`: completion rate, completed/total lesson counts, completion timestamp
- `quiz_attempt_started`: attempt id, question count, quiz type, section/lesson indexes
- `quiz_question_answered`: attempt id, question index, selected answer index, correctness, time spent
- `quiz_completed`: attempt id, score, total, percentage, duration, pass flag, attempt number
- `ai_question_asked`: message length, chat id when available, model, provider type, success, latency
- `notification_clicked`: notification type, course id/title, notification timestamp, destination URL

## Multi-Instance (if applicable)

- [ ] Use external session store (MongoDB — already configured via `connect-mongo`)
- [ ] Replace in-memory AI cache with Redis (see `services/ai/aiCacheService.js` docs)
- [ ] Replace session notification cache with Redis (see `server.js` comments)
- [ ] Ensure `trust proxy` setting matches load balancer

## Rate Limits

Current defaults (in `utils/rateLimiters.js`):
- Global: disabled in development, 1200 req / 15 min per IP in production (`GLOBAL_RATE_LIMIT_MAX`, `GLOBAL_RATE_LIMIT_WINDOW_MS`)
- Login: 8 attempts / 15 min
- Register: 6 attempts / 1 hour
- AI Chat: 40 requests / 15 min
- AI Stream: 25 requests / 15 min
- Upload: 20 requests / 15 min

Adjust if needed for expected traffic.

## Post-Deploy Verification

- [ ] Login/register works
- [ ] Course creation works
- [ ] AI chat responds after configuring user BYOK settings in `/ai`
- [ ] File upload works (if Cloudinary configured)
- [ ] Google OAuth works (if configured)
- [ ] No 500 errors in logs
- [ ] Health check stable

## Health Check Monitoring

### Using `/health` with uptime monitors

Point your uptime monitor (UptimeRobot, Better Stack, Pingdom, etc.) to:
```
GET https://your-domain.com/health
```

### Response interpretation

| Field | Value | Meaning |
|-------|-------|---------|
| `status` | `"ok"` | App and MongoDB healthy |
| `status` | `"degraded"` | MongoDB disconnected but app is running |
| HTTP status | `200` | Healthy |
| HTTP status | `503` | Unhealthy — MongoDB down or critical dependency failed |
| `dependencies.mongodb.status` | `"ok"` | MongoDB `readyState === 1` |
| `dependencies.mongodb.status` | `"disconnected"` | MongoDB connection lost |
| `dependencies.ai.status` | `"configured"` | Optional global AI fallback env is present |
| `dependencies.ai.status` | `"not_configured"` | No global fallback env configured; users can still use BYOK settings |

### Recommended monitoring thresholds

- Check interval: 60 seconds
- Alert after: 2 consecutive failures
- Alert channels: email + Slack/webhook

### Health check does NOT

- Call AI provider (no cost, no latency)
- Expose secrets, API keys, or connection strings
- Query database beyond `readyState` check

## User BYOK AI

- Users can configure any OpenAI-compatible provider with `baseUrl`, `apiKey`, and `model`.
- Server-defined provider/model lists are not exposed to the UI.
- Set `USER_AI_KEY_ENCRYPTION_SECRET` before accepting user API keys in production.
- Generate the secret with `openssl rand -hex 32`.
- Back up the database before changing or rotating this secret. If it is lost, existing encrypted user keys cannot be decrypted.

## Security Verification

### CSRF
- [ ] All HTML forms contain `_csrf` hidden input
- [ ] AJAX requests send `x-csrf-token` header (via `csrf.js` auto-patch)
- [ ] POST without token returns 403 with `code: "EBADCSRFTOKEN"`
- [ ] Token rotates on each page load

### CSP (Content Security Policy)
- [ ] Browser console has no CSP violations for scripts (nonce-based)
- [ ] `styleSrc` still includes `'unsafe-inline'` — documented limitation
- [ ] All inline scripts use `nonce="<%= cspNonce %>"` attribute

### Validation
- [ ] Invalid JSON API input returns 400 with `success: false`
- [ ] Invalid HTML form input redirects back with flash message
- [ ] Unknown fields are stripped from request body

### Admin Access
- [ ] No hardcoded admin IDs in source code
- [ ] Admin access configured via `ADMIN_EMAILS` and/or `ADMIN_USER_IDS` env vars
- [ ] Non-admin users get 403 on `/admin` routes

### Logging
- [ ] Production logs output JSON (pino)
- [ ] No cookies, tokens, passwords, or API keys in log output
- [ ] Log level set to `info` or `warn` (not `debug`)

### Secrets
- [ ] `.env` is in `.gitignore`
- [ ] `.env.example` contains no real secrets
- [ ] Docker Compose reads secrets from `.env`, not hardcoded
- [ ] `SESSION_SECRET` is strong (min 32 random chars)

### Rate Limits
- [ ] Login: 8 attempts / 15 min
- [ ] Register: 6 attempts / 1 hour
- [ ] AI Chat: 40 requests / 15 min
- [ ] Upload: 20 requests / 15 min
- [ ] Global: disabled in development, 1200 requests / 15 min per IP in production
