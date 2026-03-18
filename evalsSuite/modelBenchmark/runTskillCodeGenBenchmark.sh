#!/usr/bin/env bash
# Run tskill code generation benchmark
#
# Tests the full pipeline: tskill.md → specs → LLM code gen → functional tests
# Uses real coral-agent skills (area, equipment, job, material)
#
# Usage:
#   ./runTskillCodeGenBenchmark.sh
#   ./runTskillCodeGenBenchmark.sh --skills "area,material"
#   ./runTskillCodeGenBenchmark.sh --models "meta/llama-4-maverick-17b-128e-instruct,claude-opus-4-6"
#   ./runTskillCodeGenBenchmark.sh --output tskill-results.json

set -euo pipefail

set -a
source ~/work/.env
set +a

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
node "$SCRIPT_DIR/evalTskillCodeGenBenchmark.mjs" "$@"
