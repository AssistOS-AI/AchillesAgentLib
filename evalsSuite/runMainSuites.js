import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SUITES = [
    {
        name: 'onlySOPLangPlan',
        script: 'planning/evalPlanAndExecute.mjs',
        description: 'Plan-only LightSOPLang generation compared to expected templates',
    },
    {
        name: 'startSOPLangAgentSession',
        script: 'planning/evalSOPLangPlanning.mjs',
        description: 'Full SOP session execution with the test command registry',
    },
    {
        name: 'startLoopAgentSession',
        script: 'planning/evalAgenticPlanAndExecute.mjs',
        description: 'Agentic multi-turn sessions over tools (Loop Session)',
    },
];

function runSuite(scriptPath, label) {
    return new Promise((resolve) => {
        // eslint-disable-next-line no-console
        console.log(`\n===== Running suite: ${label} =====`);

        const child = spawn('node', [scriptPath], {
            cwd: __dirname,
            stdio: ['ignore', 'pipe', 'pipe'], // Capture stdout/stderr
        });

        let output = '';
        let errorOutput = '';

        child.stdout.on('data', (data) => {
            const chunk = data.toString();
            output += chunk;
            process.stdout.write(chunk);
        });

        child.stderr.on('data', (data) => {
            const chunk = data.toString();
            errorOutput += chunk;
            process.stderr.write(chunk);
        });

        child.on('exit', (code) => {
            const failedCases = [];
            const lines = output.split('\n');
            const failureRegex = /❌\s+(case_[a-zA-Z0-9._-]+)/;
            lines.forEach((line) => {
                const match = line.match(failureRegex);
                if (match) {
                    failedCases.push(match[1]);
                }
            });

            if (code === 0) {
                // eslint-disable-next-line no-console
                console.log(`\n[runSuite] Suite ${label} finished with exit code 0.`);
            } else {
                // eslint-disable-next-line no-console
                console.log(`\n[runSuite] Suite ${label} finished with exit code ${code}.`);
            }
            resolve({ code: code ?? 0, failedCases });
        });
    });
}

async function main() {
    // eslint-disable-next-line no-console
    console.log('Hint: run with --help to see available options.');
    const argsRaw = process.argv.slice(2);
    if (argsRaw.includes('--help') || argsRaw.includes('-h')) {
        const suiteDescriptions = SUITES.map((suite) => `  - ${suite.name}: ${suite.description}`).join('\n');
        // eslint-disable-next-line no-console
        console.log([
            'Usage: node evalsSuite/runMainSuites.js [suiteNameOrFilter ...]',
            '',
            'Options:',
            '  <suiteNameOrFilter>  Run suites whose names include the provided text.',
            '                       You can pass multiple filters to run several suites at once.',
            '  --help, -h           Show this help message.',
            '',
            'Available suites:',
            suiteDescriptions,
            '',
            'Each suite exercises a different workflow:',
            '  • onlySOPLangPlan          – Generates LightSOPLang plans (planOnly mode) and compares them to expected plan templates.',
            '  • startSOPLangAgentSession – Runs LightSOPLang sessions with the interpreter to validate actual execution output.',
            '  • startLoopAgentSession    – Runs the multi-turn agentic loop tests with tool execution.',
        ].join('\n'));
        return;
    }
    const args = argsRaw.map((a) => a.toLowerCase());

    const selectedSuites = args.length
        ? SUITES.filter((s) => args.some((a) => s.name.toLowerCase().includes(a)))
        : SUITES;

    if (!selectedSuites.length) {
        // eslint-disable-next-line no-console
        console.log('[runSuite] No suites matched the provided filters. Available suites:');
        SUITES.forEach((s) => {
            // eslint-disable-next-line no-console
            console.log(`- ${s.name}: ${s.description}`);
        });
        process.exit(1);
    }

    // eslint-disable-next-line no-console
    console.log('[runSuite] Planning-related evaluation suites to run:');
    selectedSuites.forEach((s) => {
        // eslint-disable-next-line no-console
        console.log(`- ${s.name} (${s.script}) – ${s.description}`);
    });

    let totalFailures = 0;
    const suiteResults = [];

    for (const suite of selectedSuites) {
        // eslint-disable-next-line no-await-in-loop
        const { code, failedCases } = await runSuite(path.join(__dirname, suite.script), suite.name);
        if (code !== 0 || failedCases.length > 0) {
            totalFailures += 1;
        }
        suiteResults.push({ name: suite.name, code, failedCases });
    }

    // eslint-disable-next-line no-console
    console.log('\n===== runSuite summary =====');
    // eslint-disable-next-line no-console
    console.log(`Suites run: ${selectedSuites.length}`);

    suiteResults.forEach((res) => {
        if (res.failedCases.length > 0) {
            console.log(`\nSuite: ${res.name} (Failed)`);
            console.log(`  Failed Cases (${res.failedCases.length}):`);
            res.failedCases.forEach(c => console.log(`    - ${c}`));
        } else if (res.code !== 0) {
            console.log(`\nSuite: ${res.name} (Failed with exit code ${res.code}, no specific cases detected)`);
        } else {
            console.log(`\nSuite: ${res.name} (Passed)`);
        }
    });

    process.exit(totalFailures ? 1 : 0);
}

main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[runSuite] Fatal error:', err);
    process.exit(1);
});
