import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const { LLMAgent } = await import('../LLMAgents/LLMAgent.mjs');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILLS_DESC_PATH = path.join(__dirname, 'detectIntents', 'skillsDescription.json');
const CASES_DIR = path.join(__dirname, 'detectIntents');
const FAILURES_FILE_PATH = path.join(__dirname, 'detectIntents/.edi_failures');

const COLORS = {
    RESET: "\x1b[0m",
    RED: "\x1b[31m",
    GREEN: "\x1b[32m",
    YELLOW: "\x1b[33m",
};

async function main() {
    console.log('Hint: run with --help to see available options.');
    const args = process.argv.slice(2);
    if (args.includes('--help') || args.includes('-h')) {
        console.log([
            'Usage: node evalsSuite/evalDetectIntents.mjs [failures | <start> [end]]',
            '',
            'Options:',
            '  failures          Run only the last failed cases (from detectIntents/.edi_failures)',
            '  <start> [end]     Run case range by number (e.g., 1 5)',
            '  --help, -h        Show this help message',
        ].join('\n'));
        return;
    }

    console.log('Loading skills description...');
    let skillsDesc;
    try {
        skillsDesc = JSON.parse(await fs.readFile(SKILLS_DESC_PATH, 'utf8'));
    } catch (error) {
        console.error(`Failed to load skills description from ${SKILLS_DESC_PATH}:`, error);
        process.exit(1);
    }

    // Initialize Agent
    const agent = new LLMAgent({ name: 'Evaluator' });

    // Get cases
    console.log(`Reading cases from ${CASES_DIR}...`);
    const files = await fs.readdir(CASES_DIR);
    let cases = files.filter(f => f.endsWith('.json')).sort();

    // Filter cases based on arguments
    if (args.length > 0) {
        if (args[0] === 'failures') {
            console.log(`Reading failed cases from ${FAILURES_FILE_PATH}...`);
            try {
                const failuresData = await fs.readFile(FAILURES_FILE_PATH, 'utf8');
                const failures = JSON.parse(failuresData);
                const failedFiles = new Set(failures.map(f => f.file));
                cases = cases.filter(f => failedFiles.has(f));
            } catch (error) {
                if (error.code === 'ENOENT') {
                    console.log('No failures file found. Running all cases.');
                } else {
                    console.error('Error reading failures file:', error);
                    process.exit(1);
                }
            }
        } else {
            const start = parseInt(args[0], 10);
            const end = args.length > 1 ? parseInt(args[1], 10) : start;

            if (!isNaN(start)) {
                cases = cases.filter(f => {
                    const match = f.match(/case_(\d+)\.json/);
                    if (match) {
                        const num = parseInt(match[1], 10);
                        return num >= start && num <= end;
                    }
                    return false;
                });
            }
        }
    }

    let totalCases = 0;
    let totalExpectedIntents = 0;
    let matchedKeysCount = 0; // Key exists in both
    let semanticMatchScoreSum = 0; // Semantic match count
    let semanticChecksCount = 0; // Number of times we checked semantics (equals matchedKeysCount)
    const failedCases = [];

    console.log(`Found ${cases.length} test cases to run.`);

    for (const caseFile of cases) {
        const casePath = path.join(CASES_DIR, caseFile);
        const caseData = JSON.parse(await fs.readFile(casePath, 'utf8'));

        const { prompt, expected } = caseData;
        let caseFailed = false;
        const failureDetails = {
            file: caseFile,
            prompt: prompt,
            errors: []
        };

        let caseStatus = COLORS.GREEN;
        let caseLog = [];

        try {
            const actual = await agent.detectIntents(skillsDesc, prompt);

            // Compare Keys
            const expectedKeys = new Set(Object.keys(expected));
            const actualKeys = new Set(Object.keys(actual));

            const allKeys = new Set([...expectedKeys, ...actualKeys]);

            for (const key of allKeys) {
                const inExpected = expectedKeys.has(key);
                const inActual = actualKeys.has(key);

                if (inExpected && inActual) {
                    matchedKeysCount++;
                    semanticChecksCount++;

                    // Semantic Check
                    const expectedVal = expected[key];
                    const actualVal = actual[key];

                    const { match: isMatch, reason } = await checkSemanticMatch(agent, expectedVal, actualVal);
                    if (isMatch) {
                        semanticMatchScoreSum++;
                        caseLog.push(`  [${key}] ✅ Key Match & Semantic Match`);
                    } else {
                        if (caseStatus === COLORS.GREEN) caseStatus = COLORS.YELLOW; // Downgrade to Warning
                        caseLog.push(`  [${key}] ⚠️ Key Match but Semantic Mismatch`);

                        caseFailed = true; // Still counts as a fail for stats/file
                        failureDetails.errors.push({
                            type: 'semantic_mismatch',
                            key: key,
                            expected: expectedVal,
                            actual: actualVal,
                            reason: reason
                        });
                    }

                } else if (inExpected) {
                    caseStatus = COLORS.RED; // Downgrade to Error
                    caseLog.push(`  [${key}] ❌ Missing in Actual`);
                    caseFailed = true;
                    failureDetails.errors.push({
                        type: 'missing_key',
                        key: key,
                        expected: expected[key]
                    });
                } else {
                    caseStatus = COLORS.RED; // Downgrade to Error
                    caseLog.push(`  [${key}] ❌ Unexpected in Actual`);
                    caseFailed = true;
                    failureDetails.errors.push({
                        type: 'unexpected_key',
                        key: key,
                        actual: actual[key]
                    });
                }
            }

            if (caseFailed) {
                failedCases.push(failureDetails);
            }

            totalExpectedIntents += expectedKeys.size;
            totalCases++;

            // Print case result
            console.log(`${caseStatus}Processing ${caseFile}...${COLORS.RESET}`);
            // Only print details if not green
            if (caseStatus !== COLORS.GREEN) {
                caseLog.forEach(log => console.log(log));
                failureDetails.errors.forEach(err => {
                    if (err.type === 'semantic_mismatch') {
                        console.log(`${COLORS.YELLOW}    Expected: ${err.expected}${COLORS.RESET}`);
                        console.log(`${COLORS.YELLOW}    Actual:   ${err.actual}${COLORS.RESET}`);
                        if (err.reason) {
                            console.log(`${COLORS.YELLOW}    Reason:   ${err.reason}${COLORS.RESET}`);
                        }
                    } else if (err.type === 'missing_key') {
                        console.log(`${COLORS.RED}    Expected: ${err.expected}${COLORS.RESET}`);
                    } else if (err.type === 'unexpected_key') {
                        console.log(`${COLORS.RED}    Actual:   ${err.actual}${COLORS.RESET}`);
                    }
                });
                console.log(`${COLORS.RED}   Prompt: "${prompt}"${COLORS.RESET}`);
                console.log('');
            }


        } catch (err) {
            console.error(`${COLORS.RED}Error processing ${caseFile}:${COLORS.RESET}`, err);
            failedCases.push({
                file: caseFile,
                prompt: prompt,
                errors: [{ type: 'execution_error', message: err.message }]
            });
        }
    }

    // Summary
    console.log('\n=== Evaluation Summary ===');
    console.log(`Total Cases Processed: ${totalCases}`);
    console.log(`Total Expected Intents: ${totalExpectedIntents}`);

    const keyDetectionRate = totalExpectedIntents > 0 ? (matchedKeysCount / totalExpectedIntents) * 100 : 0;
    console.log(`Skill Detection Rate (Key Match): ${matchedKeysCount}/${totalExpectedIntents} (${keyDetectionRate.toFixed(1)}%)`);

    const semanticAccuracy = semanticChecksCount > 0 ? (semanticMatchScoreSum / semanticChecksCount) * 100 : 0;
    console.log(`Parameter Accuracy (Semantic Match on detected skills): ${semanticMatchScoreSum}/${semanticChecksCount} (${semanticAccuracy.toFixed(1)}%)`);

    // Overall Success = (Correctly Identified & Semantically Correct) / Total Expected
    const overallSuccessRate = totalExpectedIntents > 0 ? (semanticMatchScoreSum / totalExpectedIntents) * 100 : 0;
    console.log(`Overall Success Rate: ${overallSuccessRate.toFixed(1)}%`);
    console.log(`Failed Cases Count: ${failedCases.length}`);

    // Always update failures file with the results of this run
    try {
        await fs.writeFile(FAILURES_FILE_PATH, JSON.stringify(failedCases, null, 2));
        if (failedCases.length > 0) {
            console.log(`\nFailures saved to ${FAILURES_FILE_PATH}`);
        } else {
            console.log(`\nFailures file updated (0 failures).`);
        }
    } catch (error) {
        console.error(`\nFailed to save failures to ${FAILURES_FILE_PATH}:`, error);
    }
}

async function checkSemanticMatch(agent, expected, actual) {
    const prompt = `Compare the following two descriptions of a software tool parameter/action.
    
Description 1 (Expected): "${expected}"
Description 2 (Actual): "${actual}"

Do these two descriptions convey essentially the same meaning and intent?
Treat all acronyms/abbreviations as matches to their expanded forms (e.g., NFS = Non Functional Specification, API = Application Programming Interface, DS = Design Specification). If an acronym matches in syntax with the extended form wherever they might be in the 2 strings, treat it as a match.
Ignore minor phrasing differences. Focus on whether the core action and key details (IDs, priorities, specific texts) are preserved. If the actual text includes extra clarifications but does not contradict the expected action, treat it as a match.

Respond with exactly "YES" or "NO" and  a reason if "NO".`;

    try {
        const response = await agent.complete({
            prompt,
            tier: null,
            context: { intent: 'eval-semantic-match' }
        });
        const trimmed = response.trim();
        const normalized = trimmed.toUpperCase();
        const match = normalized.includes('YES');
        return {
            match,
            reason: match ? '' : `LLM response: ${trimmed || ''}`,
        };
    } catch (error) {
        console.warn('Error during semantic check:', error.message);
        return {
            match: false,
            reason: `semantic check error: ${error.message}`,
        };
    }
}

main().catch(console.error);
