#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/../.."

if [ -f ~/work/.env ]; then
    export $(grep -v '^#' ~/work/.env | xargs)
fi
export AGENT_NAME=benchmarking

TIMESTAMP=$(date -u +"%Y-%m-%dT%H-%M-%S")
OUTPUT_FILE="evalsSuite/modelBenchmark/adhoc-orchestrator-${TIMESTAMP}.json"

# Default: test-fast tier. Override with --tier <name>, --models "...", --free, etc.
exec node evalsSuite/modelBenchmark/evalAdHocOrchestrator.mjs --tier test-fast --output "$OUTPUT_FILE" "$@"
