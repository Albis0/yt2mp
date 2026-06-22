FROM oven/bun:1-debian AS base

RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 python3-pip ffmpeg ca-certificates && \
    pip3 install --no-cache-dir --break-system-packages -U yt-dlp && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build

EXPOSE 3000
ENV PORT=3000
ENV NODE_ENV=production

CMD ["bun", "run", "start"]
