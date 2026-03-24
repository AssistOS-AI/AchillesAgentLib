#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/../.."

if [ -f ~/work/.env ]; then
    export $(grep -v '^#' ~/work/.env | xargs)
fi
export AGENT_NAME=benchmarking

exec node evalsSuite/modelBenchmark/evalFastModelsBenchmark.mjs --soul-gateway --healthy --quick "$@"
