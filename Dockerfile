# ---- Build stage ----
FROM node:20-alpine AS base

WORKDIR /app

# Install yt-dlp into the image so production does not depend on runtime GitHub downloads.
# Alpine community repo provides yt-dlp as a package.
RUN apk add --no-cache python3 py3-pip yt-dlp && yt-dlp --version

# Copy dependency manifests first for better layer caching
COPY package.json package-lock.json ./

# Install production dependencies
RUN npm ci --omit=dev

# Copy application source
COPY . .

# Create non-root user
RUN addgroup -S edumy && adduser -S edumy -G edumy
RUN chown -R edumy:edumy /app
USER edumy

# Environment
ENV NODE_ENV=production
ENV PORT=3000
ENV VR_STREAM_YTDLP_PATH=/usr/bin/yt-dlp
ENV VR_STREAM_SKIP_YTDLP_DOWNLOAD=true

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "server.js"]
