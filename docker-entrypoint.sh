#!/bin/sh
set -e

if [ -n "$COOKIES_CONTENT" ]; then
  printf '%b' "$COOKIES_CONTENT" > /tmp/cookies.txt
  export COOKIES_FILE=/tmp/cookies.txt
fi

node --max-old-space-size=64 /opt/bgutil-pot/server/build/main.js &

exec bun run start
