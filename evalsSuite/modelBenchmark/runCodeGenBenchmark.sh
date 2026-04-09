#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/../.."

if [ -f ~/work/.env ]; then
    set -a
    source ~/work/.env
    set +a
fi
export AGENT_NAME=code-gen-bench

TIMESTAMP=$(date -u +"%Y-%m-%dT%H-%M-%S")
OUTPUT_FILE="evalsSuite/modelBenchmark/codegen-benchmark-${TIMESTAMP}.json"

# Default: free soul_gateway models, all levels. Override with any flag below.
exec node evalsSuite/modelBenchmark/evalCodeGenBenchmark.mjs \
    --free --soul-gateway \
    --output "$OUTPUT_FILE" \
    "$@"
