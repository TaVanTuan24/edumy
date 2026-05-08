# Edumy System Overview

Tai lieu nay tom tat kien truc hien tai cua Edumy theo code trong repo. Cac so do dung Mermaid, co the xem truc tiep tren GitHub, Markdown Preview hoac mermaid.live.

## 1. Kien Truc Tong Quan

```mermaid
flowchart TD
  Browser["Web browser\nEJS pages + public JS/CSS"]
  VRClient["VR / external client"]

  App["Express app\nserver.js"]
  Middleware["Global middleware\nsession, Passport, CSRF, CSP nonce,\nHelmet CSP, CORS, rate limit,\nflash, static assets"]

  Views["EJS views\nviews/*"]
  Static["Static assets\npublic/*"]

  AuthRoutes["Auth + user routes\n/ register, login, Google OAuth,\nprofile, leaderboard"]
  CourseRoutes["Course learner routes\n/courses, /explore,\nprogress, notes, reviews,\nlesson AI"]
  DiscussionRoutes["Discussion routes\n/courses/:courseId/discussions"]
  AdminRoutes["Admin routes\n/admin"]
  AdminApiRoutes["Admin AJAX API\n/api/admin"]
  AiRoutes["AI routes\n/ai"]
  AnalyticsRoutes["Analytics + tracking\n/analytics/events, /track/*"]
  VideoRoutes["Video admin routes\n/videos/*"]
  VrRoutes["VR API\n/api/vr, /api/vr-auth"]

  Controllers["Controllers\ncontrollers/*"]
  Services["Domain services\nAI, analytics, YouTube import,\nlesson context, stream resolver"]
  Utils["Utilities\nvalidation, course normalization,\ngamification, audit, lifecycle"]

  Mongo[("MongoDB\nMongoose models")]
  Cloudinary["Cloudinary\nimages + PDF uploads"]
  Google["Google OAuth / APIs"]
  YouTube["YouTube APIs\ntranscript + playlist import"]
  AIProviders["AI providers\nOpenAI-compatible BYOK,\nOpenAI/xAI/Claude/Gemini/Grok"]
  StreamTools["Video stream tools\nytdl-core, yt-dlp"]

  Browser --> App
  VRClient --> VrRoutes
  App --> Middleware
  Middleware --> AuthRoutes
  Middleware --> CourseRoutes
  Middleware --> DiscussionRoutes
  Middleware --> AdminRoutes
  Middleware --> AdminApiRoutes
  Middleware --> AiRoutes
  Middleware --> AnalyticsRoutes
  Middleware --> VideoRoutes
  Middleware --> VrRoutes

  App --> Views
  App --> Static

  AuthRoutes --> Controllers
  CourseRoutes --> Controllers
  DiscussionRoutes --> Controllers
  AdminRoutes --> Controllers
  AdminApiRoutes --> Controllers
  AiRoutes --> Controllers
  AnalyticsRoutes --> Controllers
  VideoRoutes --> Controllers
  VrRoutes --> Controllers

  Controllers --> Services
  Controllers --> Utils
  Controllers --> Mongo
  Services --> Mongo
  Services --> AIProviders
  Services --> YouTube
  Services --> StreamTools
  Controllers --> Cloudinary
  AuthRoutes --> Google
```

## 2. Request Pipeline

```mermaid
flowchart LR
  Req["HTTP request"] --> Body["urlencoded/json parsers"]
  Body --> Method["method-override"]
  Method --> Static["static /public"]
  Static --> Logging["morgan + compression"]
  Logging --> Cors["CORS"]
  Cors --> Limit["global rate limit"]
  Limit --> Session["Mongo session store"]
  Session --> Flash["flash messages"]
  Flash --> Csrf{"CSRF required?"}
  Csrf -- "normal web/API" --> CsrfProtect["csrfProtection"]
  Csrf -- "/api/vr* exceptions" --> CsrfTokenOnly["csrfTokenOnly"]
  CsrfProtect --> CspNonce["CSP nonce locals"]
  CsrfTokenOnly --> CspNonce
  CspNonce --> Helmet["Helmet CSP"]
  Helmet --> Passport["Passport init/session"]
  Passport --> Locals["res.locals\ncurrentUser, csrfToken,\nnotifications, flash"]
  Locals --> Routes["Mounted route modules"]
  Routes --> Err["404 + centralized error handler"]
```

## 3. Route Map

```mermaid
flowchart TD
  App["server.js route mounts"]

  App --> R1["/ -> users + home\nregister/login/logout\nGoogle OAuth\nprofile, leaderboard"]
  App --> R2["/explore\ncourse discovery, preview, enroll"]
  App --> R3["/courses\nlearner course pages\ncreate/update/delete for admins\nprogress, notes, quiz results, lesson AI"]
  App --> R4["/courses/:id/reviews\nreview create/delete"]
  App --> R5["/courses/:courseId/discussions\nQ&A list/show/create\nanswers, votes, accept/delete"]
  App --> R6["/admin\nadmin dashboard/editor\ncourse lifecycle\nslides, quizzes, video settings\nYouTube import, Grok setup"]
  App --> R7["/api/admin\nAJAX section/lesson/library CRUD"]
  App --> R8["/ai\nchat, streaming chat, settings,\nquiz/slide generation"]
  App --> R9["/videos\ntranscript fetch + AI quiz from video"]
  App --> R10["/analytics/events\nclient analytics ingestion"]
  App --> R11["/track\nlearning interaction tracking"]
  App --> R12["/api/vr-auth\nVR device pairing"]
  App --> R13["/api/vr\nVR course/lesson/progress\nstream resolve/proxy"]
  App --> R14["/health\nruntime health check"]
```

## 4. Learning Flow

```mermaid
sequenceDiagram
  participant Learner
  participant Browser as Course UI
  participant Express as Express routes
  participant CourseCtrl as courses/tracking controllers
  participant Progress as UserCourseProgress
  participant Analytics as AnalyticsEvent
  participant Mongo as MongoDB

  Learner->>Browser: Open /courses/:id
  Browser->>Express: GET /courses/:id
  Express->>CourseCtrl: requireCourseAccess + showCourses
  CourseCtrl->>Mongo: Load Course, Progress, Notes, Reviews, Discussions
  Mongo-->>CourseCtrl: Course view model
  CourseCtrl-->>Browser: EJS course player

  Learner->>Browser: Play video / view slide / answer quiz
  Browser->>Express: POST /courses/:courseId/progress
  Express->>CourseCtrl: updateProgress
  CourseCtrl->>Progress: upsert lesson completion + activity
  CourseCtrl->>Mongo: save progress

  Browser->>Express: POST /analytics/events or /track/*
  Express->>Analytics: sanitize metadata + trackEventSafe
  Analytics->>Mongo: insert AnalyticsEvent
```

## 5. AI Flow

```mermaid
flowchart TD
  User["Logged-in user"]
  AiUI["/ai page or course lesson AI"]
  AiRoutes["routes/ai.js\nroutes/courses.js lesson AI"]
  AiControllers["aiChatController\naiCourseController\ncourses.askLessonAi"]
  Context["Context builders\nragService\nlessonAiContextService\naiPromptService"]
  ChatStore[("Chat")]
  Settings[("UserAISettings\nencrypted API key")]
  Orchestrator["chatOrchestrator / aiRouter"]
  UserClient["userAiClient\nOpenAI-compatible BYOK"]
  Providers["Provider services\nopenai, xai, claude, gemini, grok"]
  ExternalAI["External AI APIs"]
  Gamification["awardGamification"]

  User --> AiUI --> AiRoutes --> AiControllers
  AiControllers --> Context
  AiControllers --> ChatStore
  AiControllers --> Settings
  AiControllers --> Orchestrator
  Orchestrator --> UserClient
  Orchestrator --> Providers
  UserClient --> ExternalAI
  Providers --> ExternalAI
  AiControllers --> Gamification
```

## 6. Admin Content Flow

```mermaid
flowchart TD
  Admin["Admin user"]
  AdminUI["Admin EJS pages\n/admin, course editor,\nslide editor, video settings"]
  AdminRoutes["routes/admin.js"]
  AdminApi["routes/api/admin.js"]
  CourseTools["Course utilities\nsyncCourseContent\nprepareLessonForWrite\nsyncCourseAggregateFields\ncourseLifecycle"]
  Library["Content library\nContentLibrary"]
  Course[("Course\nsections -> lessons")]
  Video[("Video")]
  Transcript[("Transcript")]
  Audit[("AuditLog")]
  Cloudinary["Cloudinary uploads\nimages + PDF"]
  YouTubeImport["YouTube playlist import service"]
  TranscriptSvc["transcript controller\nYouTube transcript + AI quiz"]

  Admin --> AdminUI
  AdminUI --> AdminRoutes
  AdminUI --> AdminApi
  AdminRoutes --> CourseTools
  AdminApi --> CourseTools
  CourseTools --> Course
  AdminApi --> Library
  AdminRoutes --> Cloudinary
  AdminRoutes --> YouTubeImport
  AdminRoutes --> Audit
  AdminApi --> Audit
  AdminRoutes --> Video
  TranscriptSvc --> Video
  TranscriptSvc --> Transcript
```

## 7. VR Flow

```mermaid
sequenceDiagram
  participant VR as VR Device
  participant Web as Web User
  participant Auth as /api/vr-auth
  participant API as /api/vr
  participant Session as VRLoginSession
  participant Stream as streamResolver
  participant Mongo as MongoDB

  VR->>Auth: POST /request-code
  Auth->>Session: create pending code
  Auth-->>VR: code

  Web->>Auth: POST /approve (logged-in session)
  Auth->>Session: mark approved + issue token

  VR->>Auth: GET /poll/:code
  Auth->>Session: read approved token
  Auth-->>VR: bearer token

  VR->>API: GET /courses with JWT
  API->>Mongo: load enrolled courses
  Mongo-->>API: courses
  API-->>VR: course list

  VR->>API: POST /stream/resolve
  API->>Stream: resolve YouTube/direct stream
  Stream-->>API: playable stream URL or proxy info
  API-->>VR: stream payload
```

## 8. Data Model Overview

```mermaid
erDiagram
  USER ||--o{ COURSE : authors
  USER ||--o{ USER_COURSE_PROGRESS : has
  COURSE ||--o{ USER_COURSE_PROGRESS : tracks
  USER ||--o{ NOTE : writes
  COURSE ||--o{ NOTE : contains
  USER ||--o{ DISCUSSION : asks
  COURSE ||--o{ DISCUSSION : has
  DISCUSSION ||--o{ ANSWER : contains
  USER ||--o{ ANSWER : writes
  USER ||--o{ CHAT : owns
  USER ||--o| USER_AI_SETTINGS : configures
  USER ||--o{ CONTENT_LIBRARY : owns
  COURSE ||--o{ VIDEO : indexes
  VIDEO ||--o{ TRANSCRIPT : has
  COURSE ||--o{ ANALYTICS_EVENT : emits
  USER ||--o{ ANALYTICS_EVENT : emits
  USER ||--o{ AUDIT_LOG : performs
  USER ||--o{ VR_LOGIN_SESSION : approves

  USER {
    ObjectId _id
    string username
    string email
    string googleId
    mixed enrolledCourses
    object gamification
  }

  COURSE {
    ObjectId _id
    string title
    string topic
    string status
    ObjectId author
    section sections
    number totalLessonCount
    number totalDurationSeconds
    mixed aiSummary
  }

  USER_COURSE_PROGRESS {
    ObjectId user
    ObjectId course
    string completedLessons
    object lessonTracking
    object quizResults
    number completionRate
  }

  DISCUSSION {
    ObjectId course
    string lessonId
    string title
    string body
    ObjectId author
    answer answers
  }

  CHAT {
    ObjectId userId
    string title
    message messages
    string defaultModel
  }

  USER_AI_SETTINGS {
    ObjectId user
    string baseUrl
    string model
    string apiKeyEncrypted
    string apiKeyLast4
  }

  ANALYTICS_EVENT {
    ObjectId user
    ObjectId course
    string eventType
    string lessonId
    mixed metadata
    date createdAt
  }

  CONTENT_LIBRARY {
    ObjectId userId
    string type
    string title
    mixed data
    string tags
  }

  VIDEO {
    ObjectId courseId
    string url
    string source
    string youtubeVideoId
    ObjectId transcripts
  }

  TRANSCRIPT {
    ObjectId videoId
    number offset
    number duration
    string text
  }
```

## 9. Main Runtime Responsibilities

- `server.js`: boot Express, connect MongoDB, register middleware, mount routes, expose `/health`, handle errors and graceful shutdown.
- `routes/*`: define HTTP surfaces. Most user-facing pages are server-rendered EJS; AJAX/API endpoints return JSON.
- `controllers/*`: coordinate request handling, Mongoose reads/writes, rendering and service calls.
- `models/*`: Mongoose schemas for users, courses, progress, discussions, AI chat/settings, analytics, library, video transcripts, audit logs and VR login sessions.
- `services/ai/*`: BYOK AI client, provider adapters, chat orchestration, RAG/context, slide/quiz/course summary generation.
- `services/youtube/*` and `controllers/transcript.js`: playlist import, transcript fetching, video-derived AI quiz generation.
- `services/analytics*`: learning analytics aggregation and sanitized event ingestion.
- `public/javascripts/show/*`: client-side course player state/rendering for video, slides, quizzes, progress and lesson AI.
