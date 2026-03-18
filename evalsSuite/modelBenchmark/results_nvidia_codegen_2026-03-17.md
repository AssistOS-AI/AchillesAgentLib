# NVIDIA NIM Code Generation Benchmark Results

**Date:** 2026-03-17
**Benchmark:** `evalNvidiaCodeGenBenchmark.mjs`
**Skills tested:** hash-util (12 tests), schema-validator (13 tests), config-loader (17 tests) = 42 total
**Reference model:** claude-opus-4-6 (via soul_gateway)

## Summary

- **148 models tested** (all NIM models from soul.axiologic.dev + 1 reference)
- **26 models achieved 100%** (42/42 tests passed)
- **~80 models returned errors** (model_not_found / not activated on build.nvidia.com)
- Best nvidia model: `meta/llama-4-maverick-17b-128e-instruct` (100%, 4700ms avg)
- Reference baseline: `claude-opus-4-6` (100%, 9419ms avg)

## Results

### Tier 1: Perfect Score (42/42)

| Model | Tests | Syntax | AvgTime |
|-------|-------|--------|---------|
| meta/llama-4-maverick-17b-128e-instruct | 42/42 | 100% | 4700ms |
| openai/gpt-oss-120b | 42/42 | 100% | 6095ms |
| qwen/qwen3.5-122b-a10b | 42/42 | 100% | 7756ms |
| openai/gpt-oss-20b | 42/42 | 100% | 7874ms |
| qwen/qwen2.5-coder-32b-instruct | 42/42 | 100% | 8132ms |
| meta/llama-3.3-70b-instruct | 42/42 | 100% | 8853ms |
| **claude-opus-4-6** *(reference)* | 42/42 | 100% | 9419ms |
| openai/gpt-5.2-codex | 42/42 | 100% | 10044ms |
| moonshotai/kimi-k2-instruct | 42/42 | 100% | 10770ms |
| mistralai/mistral-nemotron | 42/42 | 100% | 12232ms |
| mistralai/mistral-medium-3-instruct | 42/42 | 100% | 14887ms |
| z-ai/glm5 | 42/42 | 100% | 15080ms |
| meta/llama-3.1-405b-instruct | 42/42 | 100% | 15595ms |
| mistralai/mistral-large-3-675b-instruct-2512 | 42/42 | 100% | 17134ms |
| meta/llama-3.2-90b-vision-instruct | 42/42 | 100% | 18138ms |
| minimaxai/minimax-m2.5 | 42/42 | 100% | 20437ms |
| mistralai/mistral-small-3.1-24b-instruct-2503 | 42/42 | 100% | 22048ms |
| mistralai/mistral-small-24b-instruct | 42/42 | 100% | 22161ms |
| minimaxai/minimax-m2.1 | 42/42 | 100% | 27430ms |
| deepseek-ai/deepseek-v3.1-terminus | 42/42 | 100% | 30570ms |
| qwen/qwen3.5-397b-a17b | 42/42 | 100% | 32850ms |
| abacusai/dracarys-llama-3.1-70b-instruct | 42/42 | 100% | 38360ms |
| nvidia/llama-3.1-nemotron-ultra-253b-v1 | 42/42 | 100% | 43015ms |
| qwen/qwen3-next-80b-a3b-thinking | 42/42 | 100% | 64134ms |
| qwen/qwen3-coder-480b-a35b-instruct | 42/42 | 100% | 86988ms |
| z-ai/glm4.7 | 42/42 | 100% | 96413ms |

### Tier 2: Near Perfect (67-99%)

| Model | Tests | Syntax | AvgTime | hash-util | schema-validator | config-loader |
|-------|-------|--------|---------|-----------|------------------|---------------|
| nvidia/nemotron-3-super-120b-a12b | 30/30 | 67% | 18413ms | ERROR | 13/13 | 17/17 |
| moonshotai/kimi-k2-instruct-0905 | 29/29 | 67% | 19206ms | 12/12 | ERROR | 17/17 |
| deepseek-ai/deepseek-v3.1 | 29/29 | 67% | 51980ms | 12/12 | ERROR | 17/17 |

### Tier 3: Partial Pass (33-66%)

| Model | Tests | Syntax | AvgTime | hash-util | schema-validator | config-loader |
|-------|-------|--------|---------|-----------|------------------|---------------|
| deepseek-ai/deepseek-r1-distill-llama-8b | 13/13 | 33% | 6555ms | ERROR | 13/13 | ERROR |
| nvidia/llama-3.3-nemotron-super-49b-v1 | 12/12 | 33% | 25405ms | 12/12 | ERROR | ERROR |
| sarvamai/sarvam-m | 17/17 | 33% | 26329ms | ERROR | ERROR | 17/17 |
| mistralai/magistral-small-2506 | 13/13 | 33% | 30597ms | ERROR | 13/13 | ERROR |
| deepseek-ai/deepseek-v3.2 | 12/12 | 33% | 34695ms | 12/12 | ERROR | ERROR |

### Tier 4: Some Tests Pass But Not All Skills

| Model | Tests | Syntax | AvgTime | hash-util | schema-validator | config-loader |
|-------|-------|--------|---------|-----------|------------------|---------------|
| meta/llama3-70b-instruct | 41/42 | 100% | 15127ms | 11/12 | 13/13 | 17/17 |
| mistralai/mamba-codestral-7b-v0.1 | 41/42 | 100% | 16200ms | 12/12 | 12/13 | 17/17 |
| institute-of-science-tokyo/llama-3.1-swallow-70b-instruct-v0.1 | 41/42 | 100% | 26679ms | 12/12 | 13/13 | 16/17 |
| google/gemma-2-27b-it | 40/41 | 100% | 14802ms | 10/11 | 13/13 | 17/17 |
| qwen/qwen3-next-80b-a3b-instruct | 40/41 | 100% | 26902ms | 10/11 | 13/13 | 17/17 |
| mistralai/mixtral-8x22b-instruct-v0.1 | 39/42 | 100% | 8751ms | 12/12 | 13/13 | 14/17 |
| meta/llama-3.1-70b-instruct | 39/42 | 100% | 9457ms | 12/12 | 10/13 | 17/17 |
| stepfun-ai/step-3.5-flash | 39/42 | 100% | 45258ms | 12/12 | 13/13 | 14/17 |
| speakleash/bielik-11b-v2.3-instruct | 15/17 | 33% | 26981ms | ERROR | ERROR | 15/17 |
| nvidia/nemotron-3-nano-30b-a3b | 20/24 | 67% | 4251ms | 3/7 | ERROR | 17/17 |
| mistralai/devstral-2-123b-instruct-2512 | 30/37 | 100% | 12697ms | 3/7 | 13/13 | 14/17 |
| nvidia/nvidia-nemotron-nano-9b-v2 | 30/37 | 100% | 44936ms | 3/7 | 13/13 | 14/17 |
| google/gemma-2-9b-it | 33/41 | 100% | 17397ms | 10/11 | 7/13 | 16/17 |
| meta/llama-3.2-11b-vision-instruct | 32/40 | 100% | 10697ms | 5/10 | 10/13 | 17/17 |
| mistralai/ministral-14b-instruct-2512 | 30/41 | 100% | 11972ms | 10/11 | 7/13 | 13/17 |
| institute-of-science-tokyo/llama-3.1-swallow-8b-instruct-v0.1 | 23/34 | 100% | 12662ms | 3/7 | 3/10 | 17/17 |
| meta/llama-3.1-8b-instruct | 24/36 | 100% | 5901ms | 4/9 | 3/10 | 17/17 |
| meta/llama3-8b-instruct | 13/20 | 67% | 11689ms | 3/7 | 10/13 | ERROR |
| qwen/qwen2.5-coder-7b-instruct | 19/30 | 100% | 11649ms | 3/7 | 13/13 | 3/10 |
| stockmark/stockmark-2-100b-instruct | 19/30 | 100% | 35214ms | 3/7 | 13/13 | 3/10 |
| nvidia/nemotron-nano-12b-v2-vl | 13/22 | 67% | 5511ms | 11/12 | ERROR | 2/10 |
| microsoft/phi-3-mini-4k-instruct | 7/13 | 33% | 3077ms | ERROR | 7/13 | ERROR |
| google/gemma-7b | 9/20 | 67% | 18764ms | 3/7 | 6/13 | ERROR |
| qwen/qwen2.5-7b-instruct | 13/30 | 100% | 13963ms | 3/7 | 7/13 | 3/10 |
| google/gemma-3n-e4b-it | 14/34 | 100% | 39918ms | 3/7 | 3/10 | 8/17 |
| mistralai/mistral-7b-instruct-v0.2 | 9/27 | 100% | 16213ms | 3/7 | 3/10 | 3/10 |
| mistralai/mistral-7b-instruct-v0.3 | 9/27 | 100% | 33411ms | 3/7 | 3/10 | 3/10 |
| google/gemma-3n-e2b-it | 6/20 | 100% | 37968ms | 0/0 | 3/10 | 3/10 |
| microsoft/phi-4-multimodal-instruct | 6/20 | 67% | 7602ms | ERROR | 3/10 | 3/10 |
| nvidia/llama-3.1-nemotron-nano-vl-8b-v1 | 3/10 | 33% | 7811ms | ERROR | ERROR | 3/10 |
| meta/llama-3.2-3b-instruct | 3/10 | 33% | 14438ms | ERROR | 3/10 | ERROR |
| upstage/solar-10.7b-instruct | 3/10 | 33% | 14756ms | ERROR | 3/10 | ERROR |
| mistralai/mixtral-8x7b-instruct-v0.1 | 2/10 | 33% | 16613ms | ERROR | ERROR | 2/10 |

### Tier 5: Generation Failures Only

Models that generated syntactically valid code but all tests failed, or couldn't generate code at all:

| Model | Syntax | AvgTime | Notes |
|-------|--------|---------|-------|
| igenius/italia_10b_instruct_16k | 67% | 5443ms | 0/0 across all skills |
| tiiuae/falcon3-7b-instruct | 67% | 12271ms | 0/0 across all skills |
| microsoft/phi-3-small-128k-instruct | 67% | 12822ms | 0/0 across all skills |
| nvidia/nemotron-mini-4b-instruct | 33% | 1152ms | 0/0 across all skills |
| mistralai/mathstral-7b-v0.1 | 33% | 25049ms | 0/13 on schema-validator |
| nvidia/llama-3.1-nemotron-nano-8b-v1 | 0% | 24206ms | ERROR on all skills |
| marin/marin-8b-instruct | 0% | 12434ms | ERROR on all skills |

### Not Activated (~60+ models)

Models returning `model_not_found` (0ms, ERROR on all skills) — need activation on build.nvidia.com. Includes: most google/gemma-3-*, ibm/granite-*, microsoft/phi-3.5-*, nvidia/llama3-chatqa-*, writer/palmyra-*, and many others.

## Recommendations

| Category | Model | Score | Avg Latency |
|----------|-------|-------|-------------|
| **Best Quality** | meta/llama-4-maverick-17b-128e-instruct | 42/42 (100%) | 4700ms |
| **Best Speed** | nvidia/nemotron-3-nano-30b-a3b | 20/24 (83%) | 4251ms |
| **Reference** | claude-opus-4-6 | 42/42 (100%) | 9419ms |
| **Best Value (free + fast)** | openai/gpt-oss-20b | 42/42 (100%) | 7874ms |
| **Best Small Model** | meta/llama-3.1-8b-instruct | 24/36 (67%) | 5901ms |

## Key Observations

1. **26 models match claude-opus-4-6** at 100% accuracy, with 6 of them being faster.
2. **meta/llama-4-maverick** is the fastest perfect-score model at 4.7s avg — 2x faster than claude-opus-4-6.
3. **Model size matters**: 70B+ models generally achieve 100%, while sub-8B models struggle with the hash-util skill (crypto module usage).
4. **hash-util is the hardest skill** — requires correct use of `node:crypto`, salt handling, and deterministic hashing. Many small models fail here.
5. **config-loader is the easiest** — pure JS type conversion, most models that generate valid syntax pass this.
6. **~60 models are not activated** on build.nvidia.com and return instant errors.
