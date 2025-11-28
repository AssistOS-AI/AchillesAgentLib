#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';
import { SkillManagerCli } from './SkillManagerCli.mjs';
import { HistoryManager } from './HistoryManager.mjs';
import { CommandSelector, showCommandSelector, showSkillSelector, buildCommandList } from './CommandSelector.mjs';
import { SlashCommandHandler } from './SlashCommandHandler.mjs';
import { REPLSession } from './REPLSession.mjs';
import { summarizeResult, formatSlashResult } from './ResultFormatter.mjs';
import { printHelp as printREPLHelp, showHistory, searchHistory } from './HelpPrinter.mjs';

// Re-export classes and functions for library usage
export {
    // Main class
    SkillManagerCli,
    // REPL components
    REPLSession,
    SlashCommandHandler,
    // UI components
    CommandSelector,
    showCommandSelector,
    showSkillSelector,
    buildCommandList,
    // History
    HistoryManager,
    // Utilities
    summarizeResult,
    formatSlashResult,
    printREPLHelp,
    showHistory,
    searchHistory,
};

// CLI entry point when run directly
async function main() {
    const args = process.argv.slice(2);

    // Parse options
    let workingDir = process.cwd();
    let prompt = null;
    let verbose = false;
    let debug = false;
    let mode = 'deep';

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--dir' || arg === '-d') {
            workingDir = path.resolve(args[i + 1] || process.cwd());
            i += 1;
        } else if (arg === '--help' || arg === '-h') {
            printHelp();
            process.exit(0);
        } else if (arg === '--verbose' || arg === '-v') {
            verbose = true;
        } else if (arg === '--debug') {
            debug = true;
        } else if (arg === '--fast') {
            mode = 'fast';
        } else if (arg === '--deep') {
            mode = 'deep';
        } else if (arg === '--version') {
            console.log('skill-manager v3.0.0');
            process.exit(0);
        } else if (!arg.startsWith('-')) {
            // Collect remaining args as the prompt
            prompt = args.slice(i).join(' ');
            break;
        }
    }

    // Configure logger based on verbose flag
    const logger = {
        log: verbose ? (msg) => console.log(`[LOG] ${msg}`) : () => {},
        warn: (msg) => console.warn(`[WARN] ${msg}`),
        error: (msg) => console.error(`[ERROR] ${msg}`),
    };

    // Initialize CLI
    const agent = new SkillManagerCli({
        workingDir,
        logger,
        debug,
    });

    if (prompt) {
        // Single-shot mode: execute prompt and exit
        try {
            if (verbose) {
                console.log(`Processing: "${prompt}"\n`);
            }
            const result = await agent.processPrompt(prompt, { mode });
            console.log(result);
        } catch (error) {
            console.error('Error:', error.message);
            if (verbose) {
                console.error(error.stack);
            }
            process.exit(1);
        }
    } else {
        // REPL mode
        await agent.startREPL();
    }
}

function printHelp() {
    console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║                    Skill Manager Agent CLI v3.0                       ║
║        Manage, generate, and test skill definition files              ║
╚══════════════════════════════════════════════════════════════════════╝

USAGE:
  skill-manager [options] [prompt]

OPTIONS:
  -d, --dir <path>   Working directory containing .AchillesSkills (default: cwd)
  -v, --verbose      Enable verbose logging
  --debug            Show full JSON output (orchestrator plans, executions)
  --fast             Use fast LLM mode (cheaper, quicker)
  --deep             Use deep LLM mode (default, more capable)
  -h, --help         Show this help message
  --version          Show version

MODES:
  REPL Mode          Run without a prompt to enter interactive mode
  Single-shot Mode   Pass a prompt as arguments to execute and exit

HISTORY:
  Command history is stored per working directory in .skill-manager-history
  Use ↑/↓ arrows to navigate history, "history" command to view/search

BUILT-IN SKILLS:
  list-skills        List all registered skills
  read-skill         Read a skill definition file
  write-skill        Create or update a skill file
  delete-skill       Remove a skill directory
  validate-skill     Validate skill against schema
  get-template       Get blank template for skill type
  update-section     Update a specific section
  preview-changes    Show diff before applying
  generate-code      Generate .mjs from tskill
  test-code          Test generated code
  skill-manager      Orchestrator for routing requests
  skill-refiner      Iterative improvement loop

SKILL TYPES:
  tskill   Database table (fields, validators, presenters)
  cskill   Code skill (LLM-generated code execution)
  iskill   Interactive (commands, user prompts)
  oskill   Orchestrator (routes to other skills)
  mskill   MCP tool integration

EXAMPLES:
  # Start interactive REPL
  skill-manager
  skill-manager --dir /path/to/project

  # Single-shot commands
  skill-manager "list all skills"
  skill-manager "read the equipment skill"
  skill-manager "create a tskill called inventory for tracking stock"
  skill-manager "validate the area skill"
  skill-manager "generate code for equipment"
  skill-manager "test the generated code for equipment"
  skill-manager "refine equipment until all tests pass"
  skill-manager --fast "list skills"

ENVIRONMENT:
  ANTHROPIC_API_KEY    API key for Claude (required)
  OPENAI_API_KEY       Alternative: API key for OpenAI

For more information, see the README.md in the SkillManagerAgent directory.
`);
}

/**
 * Check if this module is being run directly (cross-platform safe)
 */
function isRunDirectly() {
    try {
        const scriptPath = realpathSync(process.argv[1]);
        const modulePath = realpathSync(fileURLToPath(import.meta.url));
        return scriptPath === modulePath;
    } catch {
        // Fallback for edge cases
        return import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));
    }
}

// Run if executed directly
if (isRunDirectly()) {
    main().catch((error) => {
        console.error('Fatal error:', error.message);
        process.exit(1);
    });
}
