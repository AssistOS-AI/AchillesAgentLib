import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

import { RecursiveSkilledAgent } from '../../RecursiveSkilledAgents/RecursiveSkilledAgent.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const COLORS = {
    red: '\x1b[31m',
    green: '\x1b[32m',
    reset: '\x1b[0m',
};

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

function writeFile(filePath, content) {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, content, 'utf8');
}

function coerceResultToText(result) {
    if (result == null) {
        return '';
    }
    if (typeof result === 'string') {
        return result;
    }
    if (typeof result === 'object') {
        if (typeof result.text === 'string') {
            return result.text;
        }
        if (typeof result.output === 'string') {
            return result.output;
        }
        if (typeof result.result === 'string') {
            return result.result;
        }
        try {
            return JSON.stringify(result);
        } catch (error) {
            return String(result);
        }
    }
    return String(result);
}

function assertContains(text, fragment) {
    return text.toLowerCase().includes(fragment.toLowerCase());
}

async function run() {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-skills-'));
    const workspace = path.join(tempRoot, 'workspace');
    ensureDir(workspace);

    const csvInput = path.join(workspace, 'input.csv');
    writeFile(csvInput, 'Item,Amount\nAlpha,10\nBeta,5\n');

    const skillsRoot = path.join(__dirname, 'skills');
    const agent = new RecursiveSkilledAgent({
        startDir: __dirname,
        searchUpwards: false,
        additionalSkillRoots: [skillsRoot],
    });

    const cases = [
        {
            id: 'xlsx-lite',
            skillName: 'xlsx-lite-claude',
            prompt: `I have a CSV at ${csvInput}. Please add a Totals row for the Amount column and save the updated file to ${path.join(workspace, 'output.csv')}. Reply with just the total value.`,
            expectedFiles: [path.join(workspace, 'output.csv')],
            expectedContains: ['15'],
            validateFile: (content) => content.includes('Totals') && content.includes('15'),
        },
        {
            id: 'docx-lite',
            skillName: 'docx-lite-claude',
            prompt: 'Draft a short memo titled "Project Update". Summary: This release closes the onboarding gaps. Customer satisfaction improved after the fixes. Action items: Share the rollout note with stakeholders; Schedule a follow-up review; Monitor adoption metrics. Return the memo text only.',
            expectedContains: ['Title:', 'Project Update', 'Action Items'],
        },
        {
            id: 'pdf-lite',
            skillName: 'pdf-lite-claude',
            prompt: 'Here is the PDF text:\nTitle: Q1 Review\nOverview: This quarter focused on onboarding.\nFindings: Customer satisfaction improved.\nConclusion: Continue the program.\n\nPlease check it against your checklist and output PASS/FAIL per item with a one-line summary.',
            expectedContains: ['Title: PASS', 'Overview: PASS', 'Findings: PASS', 'Conclusion: PASS'],
        },
        {
            id: 'pptx-lite',
            skillName: 'pptx-lite-claude',
            prompt: 'Create a 3-slide outline about "Remote Work Guidelines". Slide 1 should be the title slide, slide 2 a policy overview, and slide 3 next steps. Use the required slide format exactly.',
            expectedContains: ['Slide 1', 'Slide 2', 'Slide 3', 'Remote Work'],
        },
    ];

    let failures = 0;
    let index = 0;

    try {
        for (const testCase of cases) {
            index += 1;
            const label = `Case ${index}: ${testCase.id} (skill: ${testCase.skillName})`;
            console.log(label);

            const result = await agent.executePrompt(testCase.prompt, {
                skillName: testCase.skillName,
                context: { sessionId: testCase.id },
            });

            const text = coerceResultToText(result?.result ?? result);
            let caseFailed = false;

            for (const filePath of testCase.expectedFiles || []) {
                if (!fs.existsSync(filePath)) {
                    console.error(`[${label}] Missing expected file: ${filePath}`);
                    caseFailed = true;
                } else if (testCase.validateFile) {
                    const fileContent = fs.readFileSync(filePath, 'utf8');
                    if (!testCase.validateFile(fileContent)) {
                        console.error(`[${label}] File validation failed: ${filePath}`);
                        caseFailed = true;
                    }
                }
            }

            for (const fragment of testCase.expectedContains || []) {
                if (!assertContains(text, fragment)) {
                    console.error(`[${label}] Missing expected text fragment: ${fragment}`);
                    caseFailed = true;
                }
            }

            if (caseFailed) {
                failures += 1;
                console.error(`${COLORS.red}[${label}] FAIL${COLORS.reset}`);
            } else {
                console.log(`${COLORS.green}[${label}] PASS${COLORS.reset}`);
            }
            console.log('');
        }
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }

    if (failures > 0) {
        process.exitCode = 1;
    }
}

run().catch((error) => {
    console.error(`Runner failed: ${error.message}`);
    process.exitCode = 1;
});
