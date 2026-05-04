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

AI_PROVIDER=openai-compatible
AI_BASE_URL=
AI_API_KEY=
AI_CHAT_MODEL=gpt-5.5
AI_SUMMARY_MODEL=gpt-5.5

CLOUDINARY_CLOUD_NAME=
CLOUDINARY_KEY=
CLOUDINARY_SECRET=
```

## AI provider notes

- The app no longer depends on a local Ollama runtime.
- Server-managed AI uses `AI_BASE_URL` plus `AI_API_KEY` with an OpenAI-compatible API.
- The default chat model is `AI_CHAT_MODEL`.
- Course summaries use `AI_SUMMARY_MODEL`.
- Optional BYOK settings for OpenAI, xAI, Claude, and Gemini are still available in the `/ai` UI.
- Grok scraper remains optional for local desktop use and should stay disabled on headless production servers unless you explicitly support it.

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
- `dependencies.ai.status`: `"configured"` or `"not_configured"`

Returns HTTP 200 when healthy, 503 when MongoDB is disconnected.

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
