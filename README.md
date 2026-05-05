# Edumy

Edumy is a Node.js, Express, MongoDB, and EJS learning platform with authentication, course management, learner progress, AI-assisted tools, discussions, and admin workflows.

## Run locally

1. Install dependencies:

```bash
npm install
```

2. Create `.env` from `.env.example` and fill in the required values.

3. Start the app:

```bash
npm start
```

For local development:

```bash
npm run dev
```

The app listens on `PORT` or `3000`.

## Required environment variables

```env
NODE_ENV=development
PORT=3000

MONGO_URI=
SESSION_SECRET=

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_CALLBACK_URL=http://localhost:3000/auth/google/callback

USER_AI_KEY_ENCRYPTION_SECRET=
ALLOW_GLOBAL_AI_FALLBACK=false
AI_BASE_URL=
AI_API_KEY=
AI_MODEL=
AI_SUMMARY_MODEL=

CLOUDINARY_CLOUD_NAME=
CLOUDINARY_KEY=
CLOUDINARY_SECRET=
```

## AI BYOK notes

- Users configure their own OpenAI-compatible AI settings in `/ai`: `baseUrl`, `apiKey`, and `model`.
- The server no longer maintains or exposes a predefined model/provider list.
- User API keys are encrypted at rest with `USER_AI_KEY_ENCRYPTION_SECRET` and are never returned to the client after saving.
- Generate the encryption secret with `openssl rand -hex 32`. If this secret is lost or changed, saved user AI keys cannot be decrypted.
- Optional global fallback for admin/dev can use `ALLOW_GLOBAL_AI_FALLBACK=true` with `AI_BASE_URL`, `AI_API_KEY`, and `AI_MODEL`; it is not used for user-facing model selection.
- Grok scraper remains optional for legacy admin workflows and should stay disabled on headless production servers unless you explicitly support it.

## Google OAuth

Set these values:

```env
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_CALLBACK_URL=http://localhost:3000/auth/google/callback
```

Production example:

```env
GOOGLE_CALLBACK_URL=https://your-render-app-name.onrender.com/auth/google/callback
```

## Tests

```bash
npm test
```

Runs all Jest tests in-band. Requires a running MongoDB instance (set `MONGO_URI` in `.env`).

## Docker

Build and run with Docker Compose (includes MongoDB):

```bash
# Create .env with at least SESSION_SECRET and MONGO_URI
cp .env.example .env

# Build and start
docker compose up --build

# Run in background
docker compose up -d --build
```

The app will be available at `http://localhost:3000`.

Stop and remove containers:

```bash
docker compose down

# Also remove database volume
docker compose down -v
```

### Docker standalone (without Compose)

```bash
docker build -t edumy .
docker run -p 3000:3000 --env-file .env edumy
```

## CI

GitHub Actions CI runs on push/PR to `main`/`master`:
- Installs dependencies with `npm ci`
- Runs tests with `npm test`
- Uses MongoDB service container for tests

Workflow: `.github/workflows/ci.yml`

## Health check

```
GET /health
```

Returns JSON with:
- `status`: `"ok"` or `"degraded"`
- `version`: app version from `package.json`
- `uptime`: server uptime in seconds
- `memory`: Node.js memory usage
- `dependencies.mongodb.status`: `"ok"` or `"disconnected"`
- `dependencies.ai.status`: optional global fallback status; user BYOK settings are stored per user in MongoDB

Returns HTTP 200 when healthy, 503 when MongoDB is disconnected.

## Analytics events

Edumy records priority learning events in the `analyticsevents` MongoDB collection through `services/analyticsEventService.js` and `POST /analytics/events`.

Tracked events:
- `lesson_started`, `lesson_completed`, `video_progress`
- `course_enrolled`, `course_completed`
- `quiz_attempt_started`, `quiz_question_answered`, `quiz_completed`
- `ai_question_asked`, `notification_clicked`

Privacy/security rules:
- Raw IP addresses, cookies, Authorization headers, API keys, passwords, tokens, full AI prompts, full AI responses, and note content are not stored.
- Event metadata is sanitized recursively, sensitive keys are removed, long strings are truncated, and oversized metadata is reduced.
- Analytics failures are logged and do not fail the main user request.

Collection/index notes:
- Model: `models/analyticsEvent.js`
- Main indexes: `user + createdAt`, `course + eventType + createdAt`, and `eventType + createdAt`
- Retention is not enforced yet; define a TTL/archival policy before high-volume production use.

## Admin access

Configure admin users via environment variables:

```env
ADMIN_EMAILS=admin@example.com,another@example.com
ADMIN_USER_IDS=mongodb_object_id_1,mongodb_object_id_2
```

Users matching either an admin email or admin user ID will have admin privileges. Both fields accept comma-separated values.

## Migration scripts

> **WARNING:** Always run with `--dry-run` (default) first. Only use `--apply` after reviewing the output and backing up your database. Never run `--apply` on production without a backup.

### Progress merge (legacy Progress → UserCourseProgress)

```bash
# Dry-run (default) — shows what would change
node scripts/migrate-progress-merge.js

# Apply changes
node scripts/migrate-progress-merge.js --apply
```

- Reads legacy `Progress` documents (completedVideos)
- Creates `UserCourseProgress` entries if missing
- Merges missing lessons into existing `UserCourseProgress` using `$addToSet`
- Idempotent: safe to run multiple times
- Does NOT delete `Progress` data

### Enrollment field consolidation (enrolledCourseIds → enrolledCourses)

```bash
# Dry-run (default) — shows what would change
node scripts/migrate-enrollment-fields.js

# Apply changes
node scripts/migrate-enrollment-fields.js --apply
```

- Reads `enrolledCourseIds` (legacy ObjectId array)
- Backfills missing entries into `enrolledCourses` (canonical Mixed array)
- Idempotent: skips courses already present in `enrolledCourses`
- Does NOT delete `enrolledCourseIds`

## Render deployment

- Build command: `npm install`
- Start command: `npm start`
- Health check path: `/health`
- Runtime: Node

Set `MONGO_URI` to your MongoDB Atlas connection string and configure the rest of the required environment variables in Render.
