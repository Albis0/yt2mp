# Minimal image for the landing page (Next.js, in web/; no yt-dlp/ffmpeg).
# Render is configured as a Docker service for this repo, so the Dockerfile
# stays at the repo root (moving it would mean changing Render's settings) and
# copies only web/ into the image.
FROM oven/bun:1 AS build
WORKDIR /app

# Install dependencies first for better layer caching.
COPY web/package.json web/bun.lock ./
RUN bun install --frozen-lockfile

# Build the Next.js app.
COPY web/ .
RUN bun run build

# Render injects $PORT; Next's start server binds to it.
EXPOSE 3000
CMD ["sh", "-c", "bun run start -- -p ${PORT:-3000} -H 0.0.0.0"]
