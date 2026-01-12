import fs from 'fs/promises';
import path from 'path';
import { LLMAgent } from '../../LLMAgents/LLMAgent.mjs';
import { buildReviewPrompt } from './prompts.mjs';

export const specs = {
  name: 'review-specs',
  description: 'Review JS specs (.js.md or specs/) against JS sources and update specs_backlog.md',
  arguments: {
    targetDir: {
      description: 'Target directory to scan for specs and code',
      required: true,
      type: 'string',
      example: '.'
    }
  },
  exampleUsage: 'run review-specs .'
};

export const roles = [];

function toAbsolute(base, inputPath) {
  if (!inputPath) return base;
  return path.isAbsolute(inputPath) ? inputPath : path.join(base, inputPath);
}

async function pathExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function readIfExists(p) {
  try {
    return await fs.readFile(p, 'utf8');
  } catch {
    return null;
  }
}

function sortByRelativePath(entries) {
  return [...entries].sort((a, b) => a.relative.localeCompare(b.relative));
}

async function discoverSpecs(targetDir) {
  const specsDir = path.join(targetDir, 'specs');
  const results = [];

  // Co-located **/*.js.md
  async function walk(dir) {
    const items = await fs.readdir(dir, { withFileTypes: true });
    for (const item of items) {
      const full = path.join(dir, item.name);
      if (item.isDirectory()) {
        await walk(full);
      } else if (item.isFile() && item.name.endsWith('.js.md')) {
        const relative = path.relative(targetDir, full);
        const jsPath = full.slice(0, -3); // remove .md
        results.push({ specPath: full, codePath: jsPath, relative });
      }
    }
  }

  await walk(targetDir);

  // Mirrored specs/ directory
  if (await pathExists(specsDir)) {
    async function walkSpecs(dir) {
      const items = await fs.readdir(dir, { withFileTypes: true });
      for (const item of items) {
        const full = path.join(dir, item.name);
        if (item.isDirectory()) {
          await walkSpecs(full);
        } else if (item.isFile() && item.name.endsWith('.md')) {
          const relWithinSpecs = path.relative(specsDir, full);
          const codePath = path.join(targetDir, relWithinSpecs.replace(/\.md$/, ''));
          const relative = path.join('specs', relWithinSpecs);
          results.push({ specPath: full, codePath, relative });
        }
      }
    }
    await walkSpecs(specsDir);
  }

  return results;
}


function normalizeLLMResult(raw) {
  const fallback = { status: 'needs-info', issues: ['LLM response invalid'], proposedFixes: ['Retry with valid LLM output'] };
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

function renderSection(relative, evaluation) {
  const issues = evaluation.issues?.length ? evaluation.issues : ['none'];
  const fixes = evaluation.proposedFixes?.length ? evaluation.proposedFixes : ['none'];
  const lines = [
    `## ${relative}`,
    `- Status: ${evaluation.status}`,
    `- Issues:`,
    ...issues.map((i) => `  - ${i}`),
    `- Proposed fixes:`,
    ...fixes.map((f) => `  - ${f}`),
    '',
  ];
  return lines.join('\n');
}

function mergeBacklog(existingContent, updates) {
  const sections = new Map();
  const lines = (existingContent || '').split(/\r?\n/);
  let current = null;
  for (const line of lines) {
    const headingMatch = line.startsWith('## ');
    if (headingMatch) {
      current = line.slice(3).trim();
      sections.set(current, [line]);
      continue;
    }
    if (current) {
      sections.get(current).push(line);
    }
  }

  for (const { relative, evaluation } of updates) {
    sections.set(relative, renderSection(relative, evaluation).split('\n'));
  }

  const ordered = sortByRelativePath(Array.from(sections.entries()).map(([relative, linesArr]) => ({ relative, content: linesArr })));
  const outputLines = [];
  for (const entry of ordered) {
    outputLines.push(...entry.content);
  }
  return outputLines.join('\n');
}

async function writeBacklog(targetDir, updates, noSpecsNote = false) {
  const backlogPath = path.join(targetDir, 'docs', 'specs_backlog.md');
  await fs.mkdir(path.dirname(backlogPath), { recursive: true });
  const existing = await readIfExists(backlogPath);
  let content;

  if (noSpecsNote) {
    const header = '# specs_backlog\n- Note: no spec files found\n';
    content = existing ? `${header}\n${existing}` : `${header}\n`;
  } else {
    content = mergeBacklog(existing, updates);
  }

  await fs.writeFile(backlogPath, content, 'utf8');
  return backlogPath;
}

async function evaluateSpec(llmAgent, { specPath, codePath, relative }) {
  const specContent = await fs.readFile(specPath, 'utf8');
  let codeContent = null;
  if (await pathExists(codePath)) {
    codeContent = await fs.readFile(codePath, 'utf8');
  }

  const prompt = buildReviewPrompt({ specContent, codeContent, relativePath: relative });
  const raw = await llmAgent.executePrompt(prompt, { responseShape: 'json' });
  const evaluation = normalizeLLMResult(raw);
  if (!codeContent) {
    evaluation.issues = [...(evaluation.issues || []), 'Associated JS file missing'];
    evaluation.status = evaluation.status === 'ok' ? 'needs-info' : evaluation.status;
  }
  return { relative, evaluation };
}

export async function action(args, context) {
  const repoRoot = context?.repoRoot || process.cwd();
  const targetDir = toAbsolute(repoRoot, args?.targetDir);
  if (!targetDir) {
    throw new Error('missing targetDir');
  }
  const exists = await pathExists(targetDir);
  if (!exists) {
    throw new Error('Directory not found');
  }

  const llmAgent = new LLMAgent({ name: 'review-specs' });

  const discovered = await discoverSpecs(targetDir);
  if (!discovered.length) {
    await writeBacklog(targetDir, [], true);
    return 'review-specs: no specs found (see docs/specs_backlog.md)';
  }

  const evaluations = [];
  for (const spec of discovered) {
    try {
      const evalResult = await evaluateSpec(llmAgent, spec);
      evaluations.push(evalResult);
    } catch (error) {
      evaluations.push({
        relative: spec.relative,
        evaluation: {
          status: 'needs-info',
          issues: [error.message || 'LLM error'],
          proposedFixes: ['Retry evaluation or fix file read issues'],
        },
      });
    }
  }

  const backlogPath = await writeBacklog(targetDir, evaluations, false);
  return `review-specs: processed ${evaluations.length} specs, wrote docs/specs_backlog.md`;
}
