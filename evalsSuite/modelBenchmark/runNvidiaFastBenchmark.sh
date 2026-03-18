#!/usr/bin/env bash
# Run fast models (skill routing) benchmark with all NVIDIA NIM models from Soul Gateway
#
# Tests all NIM models (nvidia/*, meta/*, qwen/*, mistralai/*, etc.) for
# skill/tool selection accuracy and speed.
#
# Usage:
#   ./runNvidiaFastBenchmark.sh [options]
#   ./runNvidiaFastBenchmark.sh --output nvidia-fast-results.json
#   ./runNvidiaFastBenchmark.sh --cases 1-5

set -euo pipefail

# Load API keys from .env
set -a
source ~/work/.env
set +a

# Discover all NIM models from Soul Gateway (any model with / in the name)
NIM_MODELS=$(curl -s \
    -H "Authorization: Bearer $SOUL_GATEWAY_API_KEY" \
    "https://soul.axiologic.dev/v1/models" \
    | python3 -c "
import sys, json
data = json.load(sys.stdin)
models = [m['id'] for m in (data.get('data', data) if isinstance(data, dict) else data) if '/' in m['id']]
print(','.join(sorted(models)))
")

if [ -z "$NIM_MODELS" ]; then
    echo "Error: No NIM models found on soul.axiologic.dev"
    exit 1
fi

echo "Discovered NIM models: $(echo "$NIM_MODELS" | tr ',' '\n' | wc -l | tr -d ' ')"

export ACHILLES_ENABLED_FAST_MODELS="$NIM_MODELS"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
node "$SCRIPT_DIR/evalFastModelsBenchmark.mjs" "$@"
