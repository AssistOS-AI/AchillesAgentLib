# Achilles Agents Reusable Library

Utility library for orchestrating LLM-powered agents, skills, and operator workflows. The package exposes the public API from `AgentLib.mjs` and can be consumed from both ESM (`import`) and CommonJS (`require`) projects.

## Installation

```bash
npm install ploinky-agent-lib
```

For local development against the repository:

```bash
npm install
npm run build
```

This creates the bundled outputs in `dist/` that get published with the package.

## Usage

### ESM / TypeScript

```js
import { Agent, doTask, registerLLMAgent } from 'ploinky-agent-lib';
```

### CommonJS

```js
const { Agent, doTask, registerLLMAgent } = require('ploinky-agent-lib');
```

All exports are forwarded from `AgentLib.mjs`, including helpers such as

- `Agent`
- `registerLLMAgent`
- `registerDefaultLLMAgent`
- `doTask`, `doTaskWithReview`, `doTaskWithHumanReview`
- `brainstorm`
- `registerOperator`, `chooseOperator`, `callOperator`
- `cancelTasks`, `listAgents`

## Model & Provider Configuration

The library expects an LLM configuration file named `LLMConfig.json` at the package root. You can override the path via the `LLM_MODELS_CONFIG_PATH` environment variable. Providers may require API keys; check the following environment variables:

- `OPENAI_API_KEY`
- `GEMINI_API_KEY`
- `ANTHROPIC_API_KEY`
- `MISTRAL_API_KEY`
- `OPENROUTER_API_KEY`
- `DEEPSEEK_API_KEY`
- `HUGGINGFACE_API_KEY`

Set `LLMAgentClient_DEBUG=true` to log configuration warnings during startup.

## Development Scripts

- `npm run build` – builds both ESM and CJS bundles with esbuild.
- `npm run build:esm` / `npm run build:cjs` – run individual bundle targets.

Before publishing, run the full build to ensure `dist/` contains the latest artifacts.

## License
(C) Axiologic Research. This code was created as part of Achilles Research Project https://www.achilles-project.eu/ 
Licsend under MIT license
Copyright 2025 (C) Axiologic Research.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the “Software”), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
