#!/bin/sh
# Chesspirit one-line installer:
#
#   curl -fsSL https://raw.githubusercontent.com/aminghuf/chesspirit/main/install.sh | sh
#
# It does exactly what the README's `docker run` does, plus a few checks:
# Docker must be installed and running, and an existing container or volume
# is reused, never deleted. Read it before you pipe it into a shell.
#
# Settings (environment variables):
#   CHESSPIRIT_PORT    host port              (default 8800)
#   CHESSPIRIT_NAME    container name         (default chesspirit)
#   CHESSPIRIT_VOLUME  data volume            (default chesspirit-data)
#   CHESSPIRIT_IMAGE   image                  (default ghcr.io/aminghuf/chesspirit:latest)
#
# Example: curl -fsSL …/install.sh | CHESSPIRIT_PORT=9000 sh

set -eu

PORT="${CHESSPIRIT_PORT:-8800}"
NAME="${CHESSPIRIT_NAME:-chesspirit}"
VOLUME="${CHESSPIRIT_VOLUME:-chesspirit-data}"
IMAGE="${CHESSPIRIT_IMAGE:-ghcr.io/aminghuf/chesspirit:latest}"

say() { printf '%s\n' "$*"; }
fail() { printf 'chesspirit: %s\n' "$*" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || fail "Docker is not installed. Get it from https://docs.docker.com/get-docker/ and run this again."

DOCKER="docker"
if ! docker info >/dev/null 2>&1; then
  if command -v sudo >/dev/null 2>&1 && sudo -n docker info >/dev/null 2>&1; then
    DOCKER="sudo docker"
  else
    fail "Docker is installed but not reachable. Start Docker, or add your user to the docker group (or run this with sudo)."
  fi
fi

case "$PORT" in
  ''|*[!0-9]*) fail "CHESSPIRIT_PORT must be a number, got '$PORT'." ;;
esac

if $DOCKER container inspect "$NAME" >/dev/null 2>&1; then
  say "A container named '$NAME' already exists. Starting it (your data is untouched)."
  $DOCKER start "$NAME" >/dev/null
  say "To update to the latest image instead: docker pull $IMAGE && docker rm -f $NAME, then run this again."
else
  say "Pulling $IMAGE …"
  $DOCKER pull "$IMAGE"
  say "Starting Chesspirit on port $PORT (data in the '$VOLUME' volume) …"
  $DOCKER run -d \
    -p "$PORT:8800" \
    -v "$VOLUME:/app/data" \
    --name "$NAME" \
    --restart unless-stopped \
    "$IMAGE" >/dev/null
fi

# Wait for the health check to answer, up to ~60 s.
i=0
while [ $i -lt 30 ]; do
  if $DOCKER exec "$NAME" node -e "fetch('http://localhost:8800/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
    say ""
    say "Chesspirit is running: http://localhost:$PORT"
    say "Open it in a browser; the setup wizard creates your admin account."
    exit 0
  fi
  i=$((i + 1))
  sleep 2
done

say "The container started but isn't answering yet. Check the logs with: $DOCKER logs $NAME"
exit 1
