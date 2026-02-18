#!/usr/bin/env bash
# Run deep models benchmark with axiologic_proxy models

set -euo pipefail

# Load API keys from .env
set -a
source ~/work/.env
set +a

# axiologic_proxy deep models from LLMConfig.json
export ACHILLES_ENABLED_DEEP_MODELS="\
axiologic_proxy/gpt-5.3-codex,\
axiologic_proxy/gpt-5.2-codex,\
axiologic_proxy/gpt-5.2,\
axiologic_proxy/gpt-5.1-codex,\
axiologic_proxy/gpt-5.1-codex-max,\
axiologic_proxy/gpt-5.1-codex-mini,\
axiologic_proxy/gpt-5.1,\
axiologic_proxy/gpt-5-codex,\
axiologic_proxy/gpt-5-codex-mini,\
axiologic_proxy/gpt-5,\
axiologic_proxy/gemini-2.5-pro"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
node "$SCRIPT_DIR/evalDeepModelsBenchmark.mjs" "$@"
