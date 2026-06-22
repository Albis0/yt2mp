# Minimal image for the static landing page (Next.js, no yt-dlp/ffmpeg anymore).
# Render is configured as a Docker service for this repo, so it needs a
# Dockerfile at the root even though the app is now just a landing page.
FROM oven/bun:1 AS build
WORKDIR /app

# Install dependencies first for better layer caching.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Build the Next.js app.
COPY . .
RUN bun run build

# Render injects $PORT; Next's start server binds to it.
EXPOSE 3000
CMD ["sh", "-c", "bun run start -- -p ${PORT:-3000} -H 0.0.0.0"]
