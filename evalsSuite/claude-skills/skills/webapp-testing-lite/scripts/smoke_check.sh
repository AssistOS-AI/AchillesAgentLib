#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 4 ]; then
  echo "Usage: smoke_check.sh <web_root> <port> <keywords_csv> <report_path>" >&2
  exit 1
fi

WEB_ROOT="$1"
PORT="$2"
KEYWORDS="$3"
REPORT_PATH="$4"

LOG_PATH="${REPORT_PATH}.server.log"

python -m http.server "$PORT" --directory "$WEB_ROOT" >"$LOG_PATH" 2>&1 &
SERVER_PID=$!

cleanup() {
  kill "$SERVER_PID" >/dev/null 2>&1 || true
}
trap cleanup EXIT

sleep 1

CONTENT=$(curl -s "http://localhost:${PORT}")
missing=()

IFS=',' read -ra words <<< "$KEYWORDS"
for word in "${words[@]}"; do
  trimmed=$(echo "$word" | sed 's/^ *//;s/ *$//')
  if [ -n "$trimmed" ] && ! printf '%s' "$CONTENT" | grep -q "$trimmed"; then
    missing+=("$trimmed")
  fi
done

{
  echo "Smoke Check"
  echo "url=http://localhost:${PORT}"
  echo "keywords=${KEYWORDS}"
  if [ ${#missing[@]} -eq 0 ]; then
    echo "status=PASS"
  else
    echo "status=FAIL"
    echo "missing=${missing[*]}"
  fi
} >"$REPORT_PATH"

cat "$REPORT_PATH"

if [ ${#missing[@]} -ne 0 ]; then
  exit 2
fi
