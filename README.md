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

## Render deployment

- Build command: `npm install`
- Start command: `npm start`
- Health check path: `/health`
- Runtime: Node

Set `MONGO_URI` to your MongoDB Atlas connection string and configure the rest of the required environment variables in Render.
