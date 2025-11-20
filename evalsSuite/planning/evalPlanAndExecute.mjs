import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LLMAgent } from '../../LLMAgents/LLMAgent.mjs';
import { LightSOPLangInterpreter } from '../../lightSOPLang/index.mjs';
import { envAutoConfig } from '../../LLMAgents/envAutoConfig.mjs';

// Load environment variables
envAutoConfig();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CASES_DIR = path.join(__dirname, 'onlySOPLangPlan');

const COLORS = {
    RESET: '\x1b[0m',
    RED: '\x1b[31m',
    GREEN: '\x1b[32m',
    YELLOW: '\x1b[33m',
};

// Local tool implementations that mimic the production commands used in the plan
const TOOL_IMPLEMENTATIONS = {
    // Math
    add: async (...args) => {
        const [a, b] = args;
        return String(Number(a) + Number(b));
    },
    multiply: async (...args) => {
        const [a, b] = args;
        return String(Number(a) * Number(b));
    },
    subtract: async (a, b) => {
        return String(Number(a) - Number(b));
    },
    divide: async (a, b) => {
        const numB = Number(b);
        if (numB === 0) return 'Infinity';
        return String(Number(a) / Number(b));
    },
    // Text
    reverse: async (...args) => {
        const [text] = args;
        return text.split('').reverse().join('');
    },
    uppercase: async (...args) => {
        const [text] = args;
        return text.toUpperCase();
    },
    lowercase: async (text) => {
        return text.toLowerCase();
    },
    length: async (text) => {
        return String(text.length);
    },
    concat: async (str1, str2) => {
        return str1 + str2;
    },
    substring: async (text, start, len) => {
        return text.substring(Number(start), Number(start) + Number(len));
    },
    contains: async (haystack, needle) => {
        return haystack.includes(needle) ? 'true' : 'false';
    },
    // Logic
    isEven: async (...args) => {
        const [num] = args;
        return (parseInt(num, 10) % 2 === 0) ? 'true' : 'false';
    },
    invert: async (...args) => {
        const [bool] = args;
        return (bool.trim() === 'true') ? 'false' : 'true';
    },
    and: async (a, b) => {
        const boolA = a.trim() === 'true';
        const boolB = b.trim() === 'true';
        return (boolA && boolB) ? 'true' : 'false';
    },
    or: async (a, b) => {
        const boolA = a.trim() === 'true';
        const boolB = b.trim() === 'true';
        return (boolA || boolB) ? 'true' : 'false';
    },
    // Extraction
    extractEmail: async (...args) => {
        const [text] = args;
        const match = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
        return match ? match[0] : '';
    },
    getDomain: async (...args) => {
        const [email] = args;
        const parts = email.split('@');
        return parts.length > 1 ? parts[1] : '';
    },
};

function buildSkillDescriptions(toolDefinitions) {
    return Object.entries(toolDefinitions).reduce((acc, [name, desc]) => {
        acc[name] = desc;
        return acc;
    }, {});
}

async function executePlanLocally(planSource, toolDefinitions) {
    const registry = {
        async executeCommand(payload, response) {
            const { command, args } = payload;
            const handler = TOOL_IMPLEMENTATIONS[command];
            if (!handler) {
                return response.fail(`Unknown command: ${command}`);
            }
            try {
                const value = await handler(...(args ?? []));
                return response.success(value);
            } catch (error) {
                return response.fail(error.message || String(error));
            }
        },
        listCommands: () => Object.entries(toolDefinitions).map(([name, desc]) => ({
            name,
            description: desc,
        })),
    };

    const interpreter = new LightSOPLangInterpreter(planSource, registry);
    await interpreter.ready;

    const variables = {};
    for (const [varName] of interpreter.variables) {
        variables[varName] = interpreter.getVarValue(varName);
    }
    return variables;
}

async function main() {
    const agent = new LLMAgent({ name: 'Executor' });

    console.log(`Reading cases from ${CASES_DIR}...`);
    const files = await fs.readdir(CASES_DIR);
    const cases = files.filter((f) => f.endsWith('.json')).sort();

    let totalCases = 0;
    let passedCases = 0;

    for (const caseFile of cases) {
        const casePath = path.join(CASES_DIR, caseFile);
        const caseData = JSON.parse(await fs.readFile(casePath, 'utf8'));
        const { prompt, tools: toolDefinitions, expectedOutput } = caseData;
        const skillDescriptions = buildSkillDescriptions(toolDefinitions);

        console.log(`\nRunning ${caseFile}...`);
        console.log(`Prompt: "${prompt}"`);

        try {
            const session = await agent.startSOPLangAgentSession(skillDescriptions, prompt, { planOnly: true });
            const plan = await session.getSOPLangPlan();
            console.log(`${COLORS.YELLOW}Generated Plan:\n${plan}${COLORS.RESET}`);

            const variables = await executePlanLocally(plan, toolDefinitions);

            let passed = false;
            const expectedKey = Object.keys(expectedOutput)[0];
            const expectedVal = expectedOutput[expectedKey];

            const foundEntry = Object.entries(variables).find(([, value]) => value === expectedVal);

            if (foundEntry) {
                passed = true;
                console.log(`${COLORS.GREEN}✅ Passed!${COLORS.RESET} Found "${expectedVal}" in variable @${foundEntry[0]}`);
            } else {
                console.log(`${COLORS.RED}❌ Failed${COLORS.RESET}`);
                console.log(`Expected value: "${expectedVal}"`);
                console.log('Actual variables:', variables);
            }

            if (passed) {
                passedCases += 1;
            }
        } catch (error) {
            console.error(`${COLORS.RED}Execution Error:${COLORS.RESET}`, error);
        }

        totalCases += 1;
    }

    console.log('\n=== Summary ===');
    console.log(`Passed: ${passedCases}/${totalCases}`);
}

main().catch(console.error);
