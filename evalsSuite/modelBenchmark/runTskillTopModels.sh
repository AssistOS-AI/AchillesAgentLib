#!/usr/bin/env bash
# Run tskill code generation benchmark with models that passed both area + material
# (151/151 on tskill benchmark, 2026-03-18)
#
# Usage:
#   ./runTskillTopModels.sh
#   ./runTskillTopModels.sh --skills "area,material,equipment,job"

set -euo pipefail

set -a
source ~/work/.env
set +a

# Models that passed both area (58/58) and material (93/93) = 151/151
MODELS="openai/gpt-oss-20b,\
openai/gpt-oss-120b,\
meta/llama-4-maverick-17b-128e-instruct,\
meta/llama-3.3-70b-instruct,\
claude-opus-4-6,\
openai/gpt-5.2-codex,\
meta/llama-3.1-405b-instruct,\
mistralai/mistral-medium-3-instruct,\
mistralai/mistral-small-3.1-24b-instruct-2503,\
mistralai/mistral-small-24b-instruct,\
minimaxai/minimax-m2.1"

# Failed material skill (area only):
# moonshotai/kimi-k2-instruct
# qwen/qwen2.5-coder-32b-instruct
# mistralai/mistral-large-3-675b-instruct-2512
# qwen/qwen3.5-397b-a17b
# abacusai/dracarys-llama-3.1-70b-instruct

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
node "$SCRIPT_DIR/evalTskillCodeGenBenchmark.mjs" \
  --models "$MODELS" \
  --skills "area,material" \
  --output "$SCRIPT_DIR/tskill-codegen-results.json" \
  "$@"
