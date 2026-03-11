import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

import { RecursiveSkilledAgent } from '../../RecursiveSkilledAgents/RecursiveSkilledAgent.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
    const webRoot = path.join(tempRoot, 'web');
    ensureDir(workspace);
    ensureDir(webRoot);

    const indexHtml = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Lite Site</title></head>
  <body>
    <h1>Hello Lite</h1>
    <p>Status: OK</p>
  </body>
</html>`;
    writeFile(path.join(webRoot, 'index.html'), indexHtml);

    const csvInput = path.join(workspace, 'input.csv');
    writeFile(csvInput, 'Item,Amount\nAlpha,10\nBeta,5\n');

    const skillsRoot = path.join(__dirname, 'skills');
    const agent = new RecursiveSkilledAgent({
        startDir: __dirname,
        searchUpwards: false,
        additionalSkillRoots: [skillsRoot],
    });

    const port = 45000 + Math.floor(Math.random() * 2000);
    const cases = [
        {
            id: 'webapp-testing-lite',
            skillName: 'webapp-testing-lite-claude',
            prompt: `Run the webapp-testing-lite smoke check with no follow-up questions. Web root: ${webRoot}. Port: ${port}. Required keywords: "Hello Lite" and "Status: OK". Report path: ${path.join(workspace, 'smoke.txt')}. Use run-script with: bash scripts/smoke_check.sh "${webRoot}" ${port} "Hello Lite,Status: OK" "${path.join(workspace, 'smoke.txt')}". Return PASS/FAIL in your response.`,
            expectedFiles: [path.join(workspace, 'smoke.txt')],
            expectedContains: ['pass'],
        },
        {
            id: 'xlsx-lite',
            skillName: 'xlsx-lite-claude',
            prompt: `Process the CSV with no follow-up questions. Input: ${csvInput}. Column to total: Amount. Output: ${path.join(workspace, 'output.csv')}. Use run-script with: python3 scripts/sum_column.py "${csvInput}" "${path.join(workspace, 'output.csv')}" Amount. Return only the total number in your response.`,
            expectedFiles: [path.join(workspace, 'output.csv')],
            expectedContains: ['15'],
            validateFile: (content) => content.includes('Totals') && content.includes('15'),
        },
        {
            id: 'docx-lite',
            skillName: 'docx-lite-claude',
            prompt: 'Use docx-lite with no follow-up questions. Title: Project Update. Summary: This release closes the onboarding gaps. Customer satisfaction improved after the fixes. Action items: Share the rollout note with stakeholders; Schedule a follow-up review. Use get-resource to read resources/doc_template.txt and return the filled template only.',
            expectedContains: ['Title:', 'Project Update', 'Action Items'],
        },
        {
            id: 'pdf-lite',
            skillName: 'pdf-lite-claude',
            prompt: 'Use pdf-lite with no follow-up questions. Use get-resource to read resources/checklist.md. Here is the PDF text:\nTitle: Q1 Review\nOverview: This quarter focused on onboarding.\nFindings: Customer satisfaction improved.\nConclusion: Continue the program.\n\nOutput PASS/FAIL per checklist item and a one-line summary.',
            expectedContains: ['Title: PASS', 'Overview: PASS', 'Findings: PASS', 'Conclusion: PASS'],
        },
        {
            id: 'pptx-lite',
            skillName: 'pptx-lite-claude',
            prompt: 'Use pptx-lite with no follow-up questions. Topic: Remote Work Guidelines. Slide count: 3. Slide intents: Slide 1 title slide, Slide 2 policy overview, Slide 3 next steps. Use the required slide format exactly.',
            expectedContains: ['Slide 1', 'Slide 2', 'Slide 3', 'Remote Work'],
        },
    ];

    let failures = 0;

    try {
        for (const testCase of cases) {
            const result = await agent.executePrompt(testCase.prompt, {
                skillName: testCase.skillName,
                context: { sessionId: testCase.id },
            });

            const text = coerceResultToText(result?.result ?? result);
            let caseFailed = false;

            for (const filePath of testCase.expectedFiles || []) {
                if (!fs.existsSync(filePath)) {
                    console.error(`[${testCase.id}] Missing expected file: ${filePath}`);
                    caseFailed = true;
                } else if (testCase.validateFile) {
                    const fileContent = fs.readFileSync(filePath, 'utf8');
                    if (!testCase.validateFile(fileContent)) {
                        console.error(`[${testCase.id}] File validation failed: ${filePath}`);
                        caseFailed = true;
                    }
                }
            }

            for (const fragment of testCase.expectedContains || []) {
                if (!assertContains(text, fragment)) {
                    console.error(`[${testCase.id}] Missing expected text fragment: ${fragment}`);
                    caseFailed = true;
                }
            }

            if (caseFailed) {
                failures += 1;
                console.error(`[${testCase.id}] FAIL`);
            } else {
                console.log(`[${testCase.id}] PASS`);
            }
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
