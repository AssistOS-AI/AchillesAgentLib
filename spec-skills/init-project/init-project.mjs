import fs from 'fs/promises';
import path from 'path';
import { LLMAgent } from '../../LLMAgents/LLMAgent.mjs';
import { buildInitPrompt } from './prompts.mjs';

export const specs = {
  name: 'init-project',
  description: 'Initialize project docs/spec backlogs and ask for missing spec details',
  arguments: {
    targetDir: {
      description: 'Target directory to initialize',
      required: true,
      type: 'string',
      example: '.'
    },
    prompt: {
      description: 'Optional project blueprint/description to guide questions',
      required: false,
      type: 'string',
      example: 'A todo app with auth'
    }
  },
  exampleUsage: 'run init-project . "A todo app with auth"'
};

export const roles = [];

function toAbsolute(base, inputPath) {
  if (!inputPath) return base;
  return path.isAbsolute(inputPath) ? inputPath : path.join(base, inputPath);
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function pathExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function toTextEntries(values, fallbackValue) {
  if (!Array.isArray(values) || values.length === 0) return [fallbackValue];
  return values.map((value) => {
    if (value === null || value === undefined) return fallbackValue;
    if (typeof value === 'string') return value;
    try {
      const json = JSON.stringify(value);
      return json === '{}' ? fallbackValue : json;
    } catch {
      return String(value);
    }
  });
}

function renderBacklogSection(relative, evaluation) {
  const issues = toTextEntries(evaluation.issues, 'none');
  const fixes = toTextEntries(evaluation.proposedFixes, 'none');
  const lines = [
    `## ${relative}`,
    `- Status: ${evaluation.status}`,
    `- Issues:`,
    ...issues.map((i) => `  - ${i}`),
    `- Proposed fixes:`,
    ...fixes.map((f) => `  - ${f}`),
    ''
  ];
  return lines.join('\n');
}

function normalizeLLMResult(raw) {
  const fallback = { status: 'needs-info', issues: ['LLM response invalid'], proposedFixes: ['Provide missing project details'] };
  if (!raw || typeof raw !== 'object') return fallback;
  const status = typeof raw.status === 'string' ? raw.status.toLowerCase() : 'needs-info';
  const issues = Array.isArray(raw.issues) ? raw.issues : [];
  const proposedFixes = Array.isArray(raw.proposedFixes) ? raw.proposedFixes : [];
  return {
    status: ['ok', 'needs-info', 'broken'].includes(status) ? status : 'needs-info',
    issues,
    proposedFixes,
  };
}

async function writeSpecsBacklog(targetDir, evaluation) {
  const backlogPath = path.join(targetDir, 'docs', 'specs_backlog.m');
  await ensureDir(path.dirname(backlogPath));
  const content = renderBacklogSection('project-questions', evaluation);
  await fs.writeFile(backlogPath, content, 'utf8');
  return backlogPath;
}

async function writeDocsBacklog(targetDir) {
  const docsBacklogPath = path.join(targetDir, 'docs', 'docs_backlog');
  await ensureDir(path.dirname(docsBacklogPath));
  const content = 'Here will be backlog for docs\n';
  await fs.writeFile(docsBacklogPath, content, 'utf8');
  return docsBacklogPath;
}

async function createDirectories(targetDir) {
  const dirs = [
    path.join(targetDir, 'docs'),
    path.join(targetDir, 'docs', 'specs'),
    path.join(targetDir, 'docs', 'gamp'),
    path.join(targetDir, 'docs', 'specs', 'src'),
    path.join(targetDir, 'docs', 'specs', 'tests'),
  ];
  for (const dir of dirs) {
    await ensureDir(dir);
  }
}

export async function action(args, context) {
  const repoRoot = context?.repoRoot || process.cwd();
  const targetDir = toAbsolute(repoRoot, args?.targetDir);
  if (!targetDir) {
    throw new Error('missing targetDir');
  }

  const existed = await pathExists(targetDir);
  if (!existed) {
    await ensureDir(targetDir);
    process.stdout.write(`Created directory ${targetDir}\n`);
  }

  await createDirectories(targetDir);

  const llmAgent = new LLMAgent({ name: 'init-project' });
  const prompt = buildInitPrompt(args?.prompt || '');
  let evaluation;
  try {
    // Allow stubbed/mocked LLMAgent by honoring a flag
    const raw = await llmAgent.executePrompt(prompt, { responseShape: 'json' });
    evaluation = normalizeLLMResult(raw);
  } catch (error) {
    evaluation = {
      status: 'needs-info',
      issues: [error.message || 'LLM error'],
      proposedFixes: ['Provide project details manually'],
    };
  }

  const specsBacklogPath = await writeSpecsBacklog(targetDir, evaluation);
  const docsBacklogPath = await writeDocsBacklog(targetDir);

  return `init-project: initialized docs, wrote ${path.relative(targetDir, specsBacklogPath)} and ${path.relative(targetDir, docsBacklogPath)}`;
}
