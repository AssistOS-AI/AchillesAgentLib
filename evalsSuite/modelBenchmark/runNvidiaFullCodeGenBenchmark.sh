#!/usr/bin/env bash
# Run full 7-skill code generation eval against all NIM models that scored 100%
# on the 3-skill benchmark (evalNvidiaCodeGenBenchmark.mjs).
#
# Tests: csv-parser, simple-cache, log-buffer, schema-validator,
#        config-loader, rate-limiter, hash-util
#
# Usage:
#   ./runNvidiaFullCodeGenBenchmark.sh
#   ./runNvidiaFullCodeGenBenchmark.sh 2>&1 | tee full-codegen-results.txt

set -euo pipefail

# Load API keys from .env
set -a
source ~/work/.env
set +a

# Models that scored 100% (42/42) on the 3-skill benchmark (2026-03-17)
MODELS=(
    "meta/llama-4-maverick-17b-128e-instruct"
    "openai/gpt-oss-120b"
    "qwen/qwen3.5-122b-a10b"
    "openai/gpt-oss-20b"
    "qwen/qwen2.5-coder-32b-instruct"
    "meta/llama-3.3-70b-instruct"
    "claude-opus-4-6"
    "openai/gpt-5.2-codex"
    "moonshotai/kimi-k2-instruct"
    "mistralai/mistral-nemotron"
    "mistralai/mistral-medium-3-instruct"
    "z-ai/glm5"
    "meta/llama-3.1-405b-instruct"
    "mistralai/mistral-large-3-675b-instruct-2512"
    "meta/llama-3.2-90b-vision-instruct"
    "minimaxai/minimax-m2.5"
    "mistralai/mistral-small-3.1-24b-instruct-2503"
    "mistralai/mistral-small-24b-instruct"
    "minimaxai/minimax-m2.1"
    "deepseek-ai/deepseek-v3.1-terminus"
    "qwen/qwen3.5-397b-a17b"
    "abacusai/dracarys-llama-3.1-70b-instruct"
    "nvidia/llama-3.1-nemotron-ultra-253b-v1"
    "qwen/qwen3-next-80b-a3b-thinking"
    "qwen/qwen3-coder-480b-a35b-instruct"
    "z-ai/glm4.7"
)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EVAL_SCRIPT="$SCRIPT_DIR/../mirror-code-gen/evalCodeGenerationPerformance.mjs"

TOTAL=${#MODELS[@]}
PASS=0
FAIL=0
PASSED_MODELS=""
FAILED_MODELS=""

echo "============================================================"
echo "Full 7-Skill Code Generation Benchmark (NIM top models)"
echo "============================================================"
echo "Models: $TOTAL"
echo "Skills: csv-parser, simple-cache, log-buffer, schema-validator,"
echo "        config-loader, rate-limiter, hash-util"
echo ""

for i in $(seq 0 $((TOTAL - 1))); do
    model="${MODELS[$i]}"
    num=$((i + 1))
    echo ""
    echo "============================================================"
    echo "[$num/$TOTAL] $model"
    echo "============================================================"

    START_TIME=$(date +%s)

    if node "$EVAL_SCRIPT" --model "$model" 2>&1; then
        PASS=$((PASS + 1))
        PASSED_MODELS="${PASSED_MODELS}  ✅ ${model}\n"
    else
        FAIL=$((FAIL + 1))
        FAILED_MODELS="${FAILED_MODELS}  ❌ ${model}\n"
    fi

    END_TIME=$(date +%s)
    ELAPSED=$((END_TIME - START_TIME))
    echo ""
    echo "⏱  ${model}: ${ELAPSED}s"
done

# Final summary
echo ""
echo "============================================================"
echo "FINAL SUMMARY"
echo "============================================================"
echo "Total: $TOTAL | Passed: $PASS | Failed: $FAIL"
echo ""

if [ -n "$PASSED_MODELS" ]; then
    echo "Passed:"
    printf "$PASSED_MODELS"
fi
if [ -n "$FAILED_MODELS" ]; then
    echo "Failed:"
    printf "$FAILED_MODELS"
fi
