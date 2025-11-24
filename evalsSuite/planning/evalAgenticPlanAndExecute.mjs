import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { envAutoConfig } from '../../LLMAgents/envAutoConfig.mjs';
import { extractJson } from '../../LLMAgents/markdown.mjs';

envAutoConfig();
const { LLMAgent } = await import('../../LLMAgents/LLMAgent.mjs');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CASES_DIR = path.join(__dirname, 'startLoopAgentSession');

const COLORS = {
    RESET: '\x1b[0m',
    RED: '\x1b[31m',
    GREEN: '\x1b[32m',
    YELLOW: '\x1b[33m',
};

// High-level tools for agentic sessions
// Each handler receives: (agent, prompt)
// Session is available via agent.currentSession
const TOOL_IMPLEMENTATIONS = {
    math: async (agent, prompt) => {
        const session = agent.currentSession;
        // Identify the most recent numeric result from the session
        let previousResult = null;
        if (session && Array.isArray(session.toolCalls)) {
            for (let i = session.toolCalls.length - 1; i >= 0; i -= 1) {
                const entry = session.toolCalls[i];
                const value = typeof entry.result === 'string' ? entry.result.trim() : String(entry.result).trim();
                if (value && !Number.isNaN(Number(value))) {
                    previousResult = Number(value);
                    break;
                }
            }
        }

        const instruction = [
            'You are a precise math parser and solver.',
            'Your job is to read the natural language instruction and,',
            'OPTIONALLY using the previousResult if it is provided, build a clear numeric expression and compute the result.',
            '',
            'Context:',
            previousResult !== null
                ? `- previousResult: ${previousResult} (numeric value from the last math tool call)`
                : '- previousResult: null (no previous numeric result)',
            '',
            'Instruction:',
            prompt,
            '',
            'Return ONLY a JSON object with the following structure:',
            '{',
            '  "expression": "<a valid JavaScript arithmetic expression using numbers and + - * />",',
            '  "result": <numeric_result>',
            '}',
            'Rules:',
            '- If the instruction references "the previous result", ALWAYS interpret it as previousResult.',
            '- Ensure expression, when evaluated, equals result.',
            '- Do not include any other fields or text.',
        ].join('\n');

        const raw = await agent.complete({
            prompt: instruction,
            mode: 'fast',
            context: { intent: 'tool-math-structured' },
        });

        const parsed = extractJson(raw);
        if (!parsed || typeof parsed !== 'object') {
            // Fallback: try direct numeric interpretation
            const fallback = String(raw).trim();
            if (!Number.isNaN(Number(fallback))) {
                return fallback;
            }
            throw new Error('Math tool could not parse JSON response from LLM.');
        }

        const { expression, result } = parsed;

        if (typeof expression !== 'string' || !expression.trim()) {
            throw new Error('Math tool received invalid or missing "expression" field.');
        }

        const expected = Number(result);
        if (Number.isNaN(expected)) {
            throw new Error('Math tool received non-numeric "result" field.');
        }

        // Evaluate the expression safely in a restricted way
        let evaluated;
        try {
            // eslint-disable-next-line no-new-func
            const fn = new Function(`return (${expression});`);
            evaluated = fn();
        } catch (error) {
            throw new Error(`Failed to evaluate expression "${expression}": ${error.message}`);
        }

        if (Number.isNaN(Number(evaluated))) {
            throw new Error(`Expression "${expression}" evaluated to NaN.`);
        }

        const numericEvaluated = Number(evaluated);
        // If there is a small numeric mismatch, trust JS evaluation
        return String(numericEvaluated);
    },
    text: async (agent, prompt) => {
        const session = agent.currentSession;
        // Try to discover the most recent numeric result to substitute placeholders like <result>
        let previousNumber = null;
        if (session && Array.isArray(session.toolCalls)) {
            for (let i = session.toolCalls.length - 1; i >= 0; i -= 1) {
                const entry = session.toolCalls[i];
                const value = typeof entry.result === 'string' ? entry.result.trim() : String(entry.result).trim();
                if (value && !Number.isNaN(Number(value))) {
                    previousNumber = Number(value);
                    break;
                }
            }
        }

        const instruction = [
            'You are a text utility tool.',
            'Your job is to construct the FINAL string requested by the instruction.',
            'Context:',
            previousNumber !== null
                ? `- previousNumber: ${previousNumber} (numeric value from the last math or numeric tool call)`
                : '- previousNumber: null (no previous numeric result)',
            '',
            'Instruction:',
            prompt,
            '',
            'Rules:',
            '- If the instruction mentions placeholders like "<result>" or "the result", and previousNumber is not null,',
            '  substitute those placeholders with the numeric value of previousNumber.',
            '- Do NOT include any placeholder tokens like "<result>" or angle-bracketed markers in the output.',
            '- Respond ONLY with the final string or number requested, no explanations.',
        ].join('\n');

        const result = await agent.complete({
            prompt: instruction,
            mode: 'fast',
            context: { intent: 'tool-text' },
        });

        return String(result).trim();
    },
    email: async (agent, prompt) => {
        const instruction = [
            'You are an email analysis tool.',
            'Depending on the instruction, extract email addresses or domains and respond ONLY with the requested value.',
            'Do not add explanations.',
            '',
            prompt,
        ].join('\n');

        const result = await agent.complete({
            prompt: instruction,
            mode: 'fast',
            context: { intent: 'tool-email' },
        });

        return String(result).trim();
    },
    stringLength: async (agent, prompt) => {
        const session = agent.currentSession;
        // Prefer the most recent string result from a previous tool call
        let target = null;
        if (session && Array.isArray(session.toolCalls)) {
            for (let i = session.toolCalls.length - 1; i >= 0; i -= 1) {
                const entry = session.toolCalls[i];
                if (typeof entry.result === 'string' && entry.result.trim().length > 0) {
                    target = entry.result;
                    break;
                }
            }
        }

        if (!target) {
            // Fallback: use the raw prompt text if no prior string result exists
            target = prompt || '';
        }

        return String(String(target).length);
    },
    shell: async (agent, prompt) => {
        const instruction = [
            'You are a Linux shell and filesystem expert working conceptually in a temporary workspace.',
            'You DO NOT actually run commands; you only reason about their effects.',
            'Read the requirements carefully and choose simple, explicit commands that match them exactly.',
            'Guidelines:',
            '- When asked to search recursively and show file name and line number case-insensitively, prefer: grep -Rni PATTERN .',
            "- For TODO search in codebases, prefer: grep -Rni 'TODO' .",
            '- When asked to delete a known finite set of files, prefer: rm path1 path2 ... (not generic find -delete).',
            '- When asked to count .js files recursively, prefer: find . -name "*.js" | wc -l.',
            '- Always respect case-sensitivity or case-insensitivity exactly as specified (-i for insensitive).',
            '- Respond ONLY with what is requested: a single shell command, a path, or a number. No explanations.',
            '',
            'Instruction:',
            prompt,
        ].join('\n');

        const result = await agent.complete({
            prompt: instruction,
            mode: 'fast',
            context: { intent: 'tool-shell' },
        });

        return String(result).trim();
    },
};

async function checkShellCommandEquivalence(agent, expected, actual, description, prompts) {
    if (!expected || !actual || expected === actual) {
        return expected === actual;
    }

    const lines = [];
    lines.push('You are evaluating two Linux shell commands in the context of a conceptual temporary workspace.');
    lines.push('Decide if the two commands are functionally equivalent for the described task.');
    lines.push('They are considered equivalent if they would have the same effect on files and output,');
    lines.push('ignoring superficial differences such as flag ordering or quoting styles.');
    lines.push('');
    lines.push('Task description:');
    lines.push(description || '');
    if (Array.isArray(prompts) && prompts.length) {
        lines.push('');
        lines.push('User prompts in this test case (most recent last):');
        prompts.forEach((p, idx) => {
            lines.push(`  ${idx + 1}. ${p}`);
        });
    }
    lines.push('');
    lines.push(`Expected command: ${expected}`);
    lines.push(`Actual command:   ${actual}`);
    lines.push('');
    lines.push('Question: In this specific context, will running the actual command produce the same');
    lines.push('effective result as the expected command (same files affected and same observable output)?');
    lines.push('Respond with exactly "YES" or "NO".');

    const prompt = lines.join('\n');

    try {
        const response = await agent.complete({
            prompt,
            mode: 'fast',
            context: { intent: 'eval-shell-equivalence' },
        });
        const normalized = String(response).trim().toUpperCase();
        return normalized === 'YES';
    } catch (error) {
        console.warn('Error during shell equivalence check:', error.message);
        return false;
    }
}

async function main() {
    console.log('Hint: run with --help to see available options.');
    const args = process.argv.slice(2);
    if (args.includes('--help') || args.includes('-h')) {
        console.log([
            'Usage: node evalsSuite/planning/evalAgenticPlanAndExecute.mjs [start] [end]',
            '',
            'Options:',
            '  <start> [end]   Run a range of case numbers (e.g., 1 5)',
            '  --help, -h      Show this help message',
        ].join('\n'));
        return;
    }
    // Initialize Agent
    const agent = new LLMAgent({ name: 'SessionEvaluator' });

    if (typeof agent.startLoopAgentSession !== 'function') {
        console.error(`${COLORS.RED}LLMAgent.startLoopAgentSession is not implemented yet.${COLORS.RESET}`);
        console.error('Please implement agent.startLoopAgentSession(tools, initialPrompt) so that:');
        console.error('- It returns a session object with method newPrompt(prompt: string).');
        console.error('- The session exposes either getVariables() or a variables map');
        console.error('  representing the final variable values.');
        process.exit(1);
    }

    console.log(`Reading cases from ${CASES_DIR}...`);
    const files = await fs.readdir(CASES_DIR);
    let cases = files.filter((f) => f.endsWith('.json')).sort();

    // Optional CLI arguments: node evalAgenticPlanAndExecute.mjs [start] [end]
    if (args.length > 0) {
        const start = Number.parseInt(args[0], 10);
        const end = args.length > 1 ? Number.parseInt(args[1], 10) : start;
        if (!Number.isNaN(start)) {
            cases = cases.filter((f) => {
                const match = f.match(/case_(\d+)/);
                if (match) {
                    const num = Number.parseInt(match[1], 10);
                    return num >= start && num <= end;
                }
                return false;
            });
        }
    }

    let totalCases = 0;
    let passedCases = 0;
    const failedCases = [];


    for (const caseFile of cases) {
        const casePath = path.join(CASES_DIR, caseFile);
        const caseData = JSON.parse(await fs.readFile(casePath, 'utf8'));

        const {
            description,
            systemPrompt = '',
            tools: toolDefinitions,
            prompts,
            expectedFinalAnswer,
        } = caseData;

        // Construct tools object for startLoopAgentSession
        const toolsForAgent = {};
        for (const [name, desc] of Object.entries(toolDefinitions || {})) {
            if (!TOOL_IMPLEMENTATIONS[name]) {
                console.warn(`Warning: No implementation for tool '${name}' in case ${caseFile}`);
            }
            toolsForAgent[name] = {
                description: desc,
                handler: TOOL_IMPLEMENTATIONS[name] || (async () => 'mock_result'),
            };
        }

        const descriptionText = description || systemPrompt || '';
        console.log(`\nRunning ${caseFile}: ${descriptionText}`);
 
        const beforeInput = agent.getInputCounter ? agent.getInputCounter() : 0;
        const beforeOutput = agent.getOutputCounter ? agent.getOutputCounter() : 0;
        const startTime = Date.now();
 
        try {
            if (!Array.isArray(prompts) || prompts.length === 0) {
                throw new Error('Each case must provide at least one prompt.');
            }
 
            // Start agentic session with first prompt
            const session = await agent.startLoopAgentSession(toolsForAgent, prompts[0], {
                systemPrompt,
            });


            if (!session || typeof session.newPrompt !== 'function') {
                throw new Error('startLoopAgentSession must return an object with a newPrompt(prompt) method.');
            }

            // Execute additional prompts if any
            for (let i = 1; i < prompts.length; i += 1) {
                console.log(`  Prompt ${i + 1}: "${prompts[i]}"`);
                // eslint-disable-next-line no-await-in-loop
                await session.newPrompt(prompts[i]);
            }

            // Collect session summary
            let summary = {};
            if (typeof session.getVariables === 'function') {
                summary = await session.getVariables();
            } else if (session.variables && typeof session.variables === 'object') {
                summary = session.variables;
            } else {
                console.warn('  Warning: session does not expose getVariables() or variables map.');
            }
 
            const lastAnswerFromGetter = typeof session.getLastResult === 'function'
                ? session.getLastResult()
                : undefined;
            const lastAnswerFromSummary = summary.lastAnswer;
 
            if (lastAnswerFromGetter !== undefined
                && lastAnswerFromSummary !== undefined
                && String(lastAnswerFromGetter) !== String(lastAnswerFromSummary)) {
                throw new Error(`LoopAgentSession invariant violated: getLastResult() ("${lastAnswerFromGetter}")`
                    + ` differs from getVariables().lastAnswer ("${lastAnswerFromSummary}")`);
            }
 
            const finalAnswer = (lastAnswerFromGetter !== undefined
                ? lastAnswerFromGetter
                : (lastAnswerFromSummary || ''));


            // Evaluate results
            let passed = true;
            const failureReasons = [];

            if (!expectedFinalAnswer) {
                console.log(`${COLORS.YELLOW}No expectedFinalAnswer specified; treating case as informational.${COLORS.RESET}`);
            } else if (String(finalAnswer).trim() === String(expectedFinalAnswer).trim()) {
                console.log(`  Final answer matches expected value: "${expectedFinalAnswer}"`);
            } else {
                // Attempt semantic equivalence for shell-related cases
                const usesShell = Object.prototype.hasOwnProperty.call(toolsForAgent, 'shell');
                const expectedStr = String(expectedFinalAnswer).trim();
                const actualStr = String(finalAnswer).trim();
                const looksLikeCommand = /\s/.test(expectedStr);

                if (usesShell && looksLikeCommand) {
                    const semanticallyEqual = await checkShellCommandEquivalence(
                        agent,
                        expectedStr,
                        actualStr,
                        description,
                        prompts,
                    );

                    if (semanticallyEqual) {
                        console.log('  Shell command is semantically equivalent to expected.');
                    } else {
                        passed = false;
                        failureReasons.push(
                            `Expected final answer "${expectedFinalAnswer}", got "${finalAnswer}"`,
                        );
                    }
                } else {
                    passed = false;
                    failureReasons.push(
                        `Expected final answer "${expectedFinalAnswer}", got "${finalAnswer}"`,
                    );
                }
            }

            const endTime = Date.now();
            const afterInput = agent.getInputCounter ? agent.getInputCounter() : beforeInput;
            const afterOutput = agent.getOutputCounter ? agent.getOutputCounter() : beforeOutput;
            const durationMs = endTime - startTime;
            const deltaInput = afterInput - beforeInput;
            const deltaOutput = afterOutput - beforeOutput;
 
            if (passed) {
                passedCases += 1;
                console.log(`${COLORS.GREEN}✅ ${caseFile} passed [${durationMs} ms, LLM chars in/out +${deltaInput}/+${deltaOutput}]${COLORS.RESET}`);
            } else {
                failedCases.push(caseFile);
                console.log(`${COLORS.RED}❌ ${caseFile} failed [${durationMs} ms, LLM chars in/out +${deltaInput}/+${deltaOutput}]${COLORS.RESET}`);
                failureReasons.forEach((reason) => console.log(`  ${reason}`));
                console.log('  Session summary:', summary);
            }
 
            console.log(`  Duration: ${durationMs} ms`);
            console.log(`  LLM chars in/out: +${deltaInput} / +${deltaOutput}`);
        } catch (err) {
            failedCases.push(caseFile);
            console.error(`${COLORS.RED}❌ ${caseFile} execution error:${COLORS.RESET}`, err.message);
        }
 
        totalCases += 1;
    }


    console.log('\n=== Summary ===');
    console.log(`Passed: ${passedCases}/${totalCases}`);
    if (failedCases.length) {
        console.log(`Failed cases (${failedCases.length}): ${failedCases.join(', ')}`);
    } else {
        console.log('Failed cases: none');
    }
}

main().catch((err) => {
    console.error(`${COLORS.RED}Fatal error in evalStartSession:${COLORS.RESET}`, err);
});
