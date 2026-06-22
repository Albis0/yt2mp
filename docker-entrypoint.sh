#!/bin/sh
set -e

node /opt/bgutil-pot/server/build/main.js &

exec bun run start
