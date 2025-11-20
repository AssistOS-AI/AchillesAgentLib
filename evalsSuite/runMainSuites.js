import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SUITES = [
    {
        name: 'onlySOPLangPlan',
        script: 'planning/evalPlanAndExecute.mjs',
        description: 'Single-shot LightSOPLang planning + local execution checks',
    },
    {
        name: 'startSOPLangAgentSession',
        script: 'planning/evalSOPLangPlanning.mjs',
        description: 'Structural equivalence tests for LightSOPLang plans (SOP sessions)',
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
            stdio: 'inherit',
        });
        child.on('exit', (code) => {
            if (code === 0) {
                // eslint-disable-next-line no-console
                console.log(`\n[runSuite] Suite ${label} finished with exit code 0.`);
            } else {
                // eslint-disable-next-line no-console
                console.log(`\n[runSuite] Suite ${label} finished with exit code ${code}.`);
            }
            resolve(code ?? 0);
        });
    });
}

async function main() {
    const args = process.argv.slice(2).map((a) => a.toLowerCase());

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

    let failures = 0;
    for (const suite of selectedSuites) {
        // eslint-disable-next-line no-await-in-loop
        const code = await runSuite(path.join(__dirname, suite.script), suite.name);
        if (code !== 0) {
            failures += 1;
        }
    }

    // eslint-disable-next-line no-console
    console.log('\n===== runSuite summary =====');
    // eslint-disable-next-line no-console
    console.log(`Suites run: ${selectedSuites.length}`);
    // eslint-disable-next-line no-console
    console.log(`Suites with non-zero exit: ${failures}`);

    process.exit(failures ? 1 : 0);
}

main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[runSuite] Fatal error:', err);
    process.exit(1);
});
