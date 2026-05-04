# Release Checklist — Edumy

Manual QA checklist before deploying to staging or production.

## Auth Flows

### Register
- [ ] Open `/register`
- [ ] Submit with valid email, username, password → account created, redirected to `/courses`
- [ ] Submit with invalid email → validation error shown
- [ ] Submit with short password (< 6 chars) → validation error shown
- [ ] Submit with existing email → error shown
- [ ] CSRF token present in form

### Login
- [ ] Open `/login`
- [ ] Login with email → success, redirected to `/courses`
- [ ] Login with username → success, redirected to `/courses`
- [ ] Wrong password → error message
- [ ] Rate limit: 8+ attempts within 15 min → blocked

### Logout
- [ ] Click logout → session destroyed, redirected to `/`
- [ ] Visit `/profile` after logout → redirected to `/login`

### Google OAuth (if configured)
- [ ] Click "Continue with Google" → Google consent screen
- [ ] After consent → account linked/created, redirected to `/courses`

## Course Flows

### Course List (Dashboard)
- [ ] Enrolled courses displayed
- [ ] Continue learning card shows last lesson
- [ ] Course search works
- [ ] Filter by status (All/In Progress/Completed)

### Course Detail
- [ ] Course loads with sections and lessons
- [ ] Video player renders for video lessons
- [ ] Quiz renders for quiz lessons
- [ ] Slide viewer renders for slide lessons
- [ ] Navigation (Previous/Next) works
- [ ] Progress bar updates after completing a lesson

### Enrollment
- [ ] Explore page → click course → preview → enroll
- [ ] After enrollment → course appears in dashboard
- [ ] Notification badge updates

### Learning Progress
- [ ] Complete a video lesson → progress updates
- [ ] Complete a quiz → score recorded
- [ ] Resume learning → resumes at last lesson
- [ ] Recent activity timeline updates

### Notes
- [ ] Write note in section → saved
- [ ] Reload page → note persists
- [ ] Edit note → saved

### Reviews
- [ ] Submit review with rating + comment → appears
- [ ] Review list loads correctly

## AI Flows

### AI Course Q&A
- [ ] Open course → AI Tutor button visible
- [ ] Ask question about current lesson → response received
- [ ] Switch AI model → model changes
- [ ] Summarize action → returns summary
- [ ] Rate limit: 40 requests / 15 min

### AI Chat
- [ ] Open `/ai` → chat interface loads
- [ ] Send message → response received (streaming)
- [ ] Create new chat → new conversation
- [ ] List chats → all chats shown
- [ ] Delete chat → removed
- [ ] Regenerate last response → new response

### AI Settings (BYOK)
- [ ] Open AI settings → providers listed
- [ ] Save API key → key encrypted and stored
- [ ] Test connection → success/failure feedback
- [ ] Clear key → key removed

## Admin Flows

### Admin Access
- [ ] Non-admin user → redirected from `/admin`
- [ ] Admin user (via `ADMIN_EMAILS` or `ADMIN_USER_IDS`) → admin dashboard loads

### Course Management
- [ ] Create course → new course created
- [ ] Edit course → changes saved
- [ ] Delete course → course removed
- [ ] AI summary generated on create

### Analytics
- [ ] Course analytics page loads
- [ ] Charts render
- [ ] Learner table displays

## Upload

- [ ] Upload avatar → image stored in Cloudinary
- [ ] Upload course thumbnail → image stored
- [ ] File size limit enforced

## Notifications

- [ ] Enroll in course → notification appears when course updated
- [ ] Mark notifications read → badge cleared
- [ ] Cache: reload page within 5 min → no extra DB query (check logs)

## System

### Health Check
- [ ] `GET /health` → 200, `status: "ok"`
- [ ] Response contains `version`, `uptime`, `memory`, `dependencies`

### Docker
- [ ] `docker compose up --build` → app starts
- [ ] App accessible at `http://localhost:3000`
- [ ] MongoDB connected

### CI
- [ ] Push to main → GitHub Actions runs
- [ ] All tests pass in CI

### Security
- [ ] CSRF token on all forms
- [ ] POST without token → 403
- [ ] CSP headers present (check DevTools → Network → Response Headers)
- [ ] No secrets in browser DevTools → Application → Cookies/Storage

## Common Error Signs

| Symptom | Likely Cause |
|---------|-------------|
| 403 EBADCSRFTOKEN | Missing or expired CSRF token |
| CSP violation in console | New inline script without nonce |
| "email is required" on login | Login schema mismatch (fixed in Phase 1) |
| 429 Too Many Requests | Rate limit hit |
| Empty notification badge | Session cache expired or DB query failed |
| AI timeout | AI provider unreachable or API key invalid |
| MongoDB disconnected | Connection string wrong or Atlas IP not whitelisted |