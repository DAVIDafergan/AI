#!/bin/sh
# docker-entrypoint.sh – Translates Docker environment variables into CLI
# arguments for the GhostLayer local agent (index.js).
#
# Required env vars:
#   API_KEY     – Tenant API key from the GhostLayer dashboard
#
# Optional env vars:
#   SERVER_URL  – GhostLayer SaaS base URL
#   SCAN_DIR    – Directory to scan inside the container  (default: /data)
#   LOCAL_PORT  – Port for the local extension API        (default: 4000)
#   VERBOSE     – Set to "true" for detailed logging      (default: false)

set -e

if [ -z "$API_KEY" ]; then
  echo "❌  ERROR: API_KEY environment variable is required." >&2
  echo "   Set it in your .env file or pass -e API_KEY=<your-key>." >&2
  exit 1
fi

ARGS="--api-key=$API_KEY"

if [ -n "$SERVER_URL" ]; then
  ARGS="$ARGS --server-url=$SERVER_URL"
fi

SCAN_DIR="${SCAN_DIR:-/data}"
ARGS="$ARGS --dir=$SCAN_DIR"

LOCAL_PORT="${LOCAL_PORT:-4000}"
ARGS="$ARGS --local-port=$LOCAL_PORT"

if [ "${VERBOSE:-false}" = "true" ]; then
  ARGS="$ARGS --verbose"
fi

echo "🚀  Starting GhostLayer Agent…"
echo "   Scan directory : $SCAN_DIR"
echo "   API port       : $LOCAL_PORT"

# shellcheck disable=SC2086
exec node index.js $ARGS
