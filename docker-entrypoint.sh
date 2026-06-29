#!/bin/sh
set -eu

APP_USER="${APP_USER:-node}"
APP_GROUP="${APP_GROUP:-node}"
APP_DATA_DIR="${DATA_DIR:-/app/data}"
APP_HOME_DIR="${APP_HOME_DIR:-/app/data-home}"

mkdir -p "$APP_DATA_DIR" "$APP_HOME_DIR" 2>/dev/null || true
chown -R "$APP_USER:$APP_GROUP" "$APP_DATA_DIR" "$APP_HOME_DIR" 2>/dev/null || true
chmod -R u+rwX,g+rwX "$APP_DATA_DIR" "$APP_HOME_DIR" 2>/dev/null || true

if [ "${RUN_AS_ROOT:-false}" = "true" ] || [ "$(id -u)" != "0" ]; then
  exec "$@"
fi

if command -v su-exec >/dev/null 2>&1 && id "$APP_USER" >/dev/null 2>&1; then
  if su-exec "$APP_USER" sh -c 'dir="$1"; mkdir -p "$dir/db" && touch "$dir/.write-test" && rm -f "$dir/.write-test"' sh "$APP_DATA_DIR" 2>/dev/null; then
    exec su-exec "$APP_USER" "$@"
  fi
fi

echo "Warning: $APP_DATA_DIR is not writable by $APP_USER; running as root so mounted storage remains usable." >&2
exec "$@"
