#!/usr/bin/env bash
# Run NVIDIA code generation benchmark via Soul Gateway
#
# Tests all nvidia/* models for code generation quality using
# mirror-code-generator specs (hash-util, schema-validator, config-loader).
#
# Usage:
#   ./runNvidiaCodeGenBenchmark.sh [options]
#   ./runNvidiaCodeGenBenchmark.sh --output nvidia-codegen-results.json
#   ./runNvidiaCodeGenBenchmark.sh --models "nvidia/nemotron-nano-12b-v2-vl"

set -euo pipefail

# Load API keys from .env
set -a
source ~/work/.env
set +a

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
node "$SCRIPT_DIR/evalNvidiaCodeGenBenchmark.mjs" "$@"
