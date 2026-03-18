#!/usr/bin/env bash
# Run multi-skill parallel execution benchmark with NVIDIA NIM models from Soul Gateway
#
# Tests all NIM models (nvidia/*, meta/*, qwen/*, mistralai/*, etc.) for
# multi-step task execution (2-3 parallel skill invocations).
#
# Usage:
#   ./runNvidiaMultiSkillBenchmark.sh [options]
#   ./runNvidiaMultiSkillBenchmark.sh --session sop --times 3
#   ./runNvidiaMultiSkillBenchmark.sh --plan-model "nvidia/llama-3.3-nemotron-super-49b-v1"

set -euo pipefail

# Load API keys from .env
if [ -f ~/work/.env ]; then
    export $(grep -v '^#' ~/work/.env | xargs)
fi

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

export AGENT_NAME=benchmarking

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/../.."

# Run each NIM model as the plan model
IFS=',' read -ra MODELS <<< "$NIM_MODELS"
for model in "${MODELS[@]}"; do
    echo ""
    echo "=========================================="
    echo "Plan model: $model"
    echo "=========================================="
    node evalsSuite/modelBenchmark/evalMultiSkillBenchmark.mjs \
        --plan-model "$model" \
        --session sop \
        "$@" || true
done
