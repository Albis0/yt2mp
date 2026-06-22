FROM oven/bun:1-debian AS base

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        python3 python3-pip ffmpeg ca-certificates nodejs npm git && \
    rm -rf /var/lib/apt/lists/*

# PO token provider: lets yt-dlp pass YouTube's bot-check on datacenter IPs
# (cloud hosts like Render/Railway get "Sign in to confirm you're not a bot"
# without this). Server runs alongside the app; yt-dlp talks to it over
# http://127.0.0.1:4416 automatically once the Python plugin is installed.
RUN git clone --single-branch --branch 1.3.1 --depth 1 \
        https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git /opt/bgutil-pot && \
    cd /opt/bgutil-pot/server && \
    npm ci && \
    npx tsc

RUN pip3 install --no-cache-dir --break-system-packages -U yt-dlp bgutil-ytdlp-pot-provider

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build
RUN chmod +x docker-entrypoint.sh

EXPOSE 3000
ENV PORT=3000
ENV NODE_ENV=production

CMD ["./docker-entrypoint.sh"]
