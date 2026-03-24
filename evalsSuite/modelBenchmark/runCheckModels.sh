#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/../.."

if [ -f ~/work/.env ]; then
    export $(grep -v '^#' ~/work/.env | xargs)
fi
export AGENT_NAME=health-check

exec node evalsSuite/modelBenchmark/checkModels.mjs "$@"
