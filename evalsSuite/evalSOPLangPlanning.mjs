import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LLMAgent } from '../LLMAgents/LLMAgent.mjs';
import { envAutoConfig } from '../LLMAgents/envAutoConfig.mjs';

// Load environment variables
envAutoConfig();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CASES_DIR = path.join(__dirname, 'SOPLangPlanning');

const COLORS = {
    RESET: "\x1b[0m",
    RED: "\x1b[31m",
    GREEN: "\x1b[32m",
    YELLOW: "\x1b[33m",
};

async function main() {
    // Initialize Agent
    const agent = new LLMAgent({ name: 'Evaluator' });
    
    // Get cases
    console.log(`Reading cases from ${CASES_DIR}...`);
    const files = await fs.readdir(CASES_DIR);
    let cases = files.filter(f => f.endsWith('.json')).sort();

    // Filter logic (same as detectIntents)
    const args = process.argv.slice(2);
    if (args.length > 0) {
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
    
    let totalCases = 0;
    let passedCases = 0;
    const failedCases = [];

    console.log(`Found ${cases.length} test cases to run.`);

    for (const caseFile of cases) {
        const casePath = path.join(CASES_DIR, caseFile);
        const caseData = JSON.parse(await fs.readFile(casePath, 'utf8'));
        
        const { prompt, tools, expectedPlan } = caseData;
        
        try {
            const actualPlan = await agent.createSOPLangPlan(tools, prompt, { useInterpreter: true });
            
            const isMatch = await checkCodeEquivalence(agent, expectedPlan, actualPlan);
            
            totalCases++;
            
            if (isMatch) {
                passedCases++;
                console.log(`${COLORS.GREEN}Processing ${caseFile}... ✅ Passed${COLORS.RESET}`);
            } else {
                console.log(`${COLORS.RED}Processing ${caseFile}... ❌ Failed${COLORS.RESET}`);
                console.log(`${COLORS.YELLOW}Prompt: "${prompt}"${COLORS.RESET}`);
                console.log(`${COLORS.YELLOW}Expected:\n${expectedPlan}${COLORS.RESET}`);
                console.log(`${COLORS.RED}Actual:\n${actualPlan}${COLORS.RESET}`);
                console.log('');
                
                failedCases.push({
                    file: caseFile,
                    prompt,
                    expected: expectedPlan,
                    actual: actualPlan
                });
            }
            
        } catch (err) {
            console.error(`${COLORS.RED}Error processing ${caseFile}:${COLORS.RESET}`, err);
            failedCases.push({
                file: caseFile,
                prompt,
                error: err.message
            });
            totalCases++;
        }
    }
    
    // Summary
    console.log('\n=== Evaluation Summary ===');
    console.log(`Total Cases: ${totalCases}`);
    console.log(`Passed: ${passedCases}`);
    console.log(`Failed: ${failedCases.length}`);
    
    const successRate = totalCases > 0 ? (passedCases / totalCases) * 100 : 0;
    console.log(`Success Rate: ${successRate.toFixed(1)}%`);
}

function parseDeclarations(code) {
    const lines = code.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#'));
    const declarations = [];

    for (const line of lines) {
        const match = line.match(/^@(\w+)\s+(\w+)(?:\s+(.*))?$/);
        if (match) {
            const [, varName, command, args] = match;
            const argList = args ? args.split(/\s+/) : [];
            
            // Extract dependencies from anywhere in the arguments (handling "$var" inside strings)
            const dependencies = [];
            if (args) {
                const depRegex = /\$([a-zA-Z0-9_]+)/g;
                let depMatch;
                while ((depMatch = depRegex.exec(args)) !== null) {
                    dependencies.push(depMatch[1]);
                }
            }

            declarations.push({
                varName,
                command,
                args: argList,
                dependencies
            });
        }
    }

    return declarations;
}

function sortByDeps(decls) {
    const result = [];
    const processed = new Set();
    const nameToDecl = new Map(decls.map(d => [d.varName, d]));

    while (result.length < decls.length) {
        const candidates = decls.filter(decl =>
            !processed.has(decl.varName) &&
            decl.dependencies.every(dep => {
                // Dependency is satisfied if it's external (not in decls) or already processed
                return !nameToDecl.has(dep) || processed.has(dep);
            })
        );
        
        if (candidates.length === 0) return null; // Cycle
        
        // Sort candidates by varName for deterministic order
        candidates.sort((a, b) => a.varName.localeCompare(b.varName));
        result.push(candidates[0]);
        processed.add(candidates[0].varName);
    }
    return result;
}

function normalizeDeclarations(declarations) {
    const varMap = new Map();
    const commandCounters = new Map();

    const normalized = declarations.map(decl => {
        if (!varMap.has(decl.varName)) {
            const counter = commandCounters.get(decl.command) || 0;
            commandCounters.set(decl.command, counter + 1);
            varMap.set(decl.varName, `${decl.command}${counter + 1}`);
        }
        const newVarName = varMap.get(decl.varName);
        const newDependencies = decl.dependencies.map(dep => varMap.get(dep) || dep);
        return {
            varName: newVarName,
            command: decl.command,
            dependencies: newDependencies
        };
    });

    return normalized;
}

function compareDeclarations(norm1, norm2) {
    if (norm1.length !== norm2.length) return false;

    const sorted1 = sortByDeps(norm1);
    const sorted2 = sortByDeps(norm2);

    if (!sorted1 || !sorted2 || sorted1.length !== sorted2.length) return false;

    for (let i = 0; i < sorted1.length; i++) {
        const d1 = sorted1[i];
        const d2 = sorted2[i];
        if (d1.command !== d2.command) return false;
        if (d1.dependencies.length !== d2.dependencies.length) return false;
        // Dependencies should match in order
        for (let j = 0; j < d1.dependencies.length; j++) {
            if (d1.dependencies[j] !== d2.dependencies[j]) return false;
        }
    }

    return true;
}

async function checkCodeEquivalence(agent, expected, actual) {
    try {
        const decls1 = parseDeclarations(expected);
        const decls2 = parseDeclarations(actual);

        const norm1 = normalizeDeclarations(decls1);
        const norm2 = normalizeDeclarations(decls2);

        if (compareDeclarations(norm1, norm2)) {
            return true;
        }
    } catch (error) {
        console.warn('Error during structural check:', error.message);
        return false;
    }

    // Fallback to LLM check
    const prompt = `Compare the following two LightSOPLang scripts.

Script 1 (Expected):
${expected}

Script 2 (Actual):
${actual}

Are these two scripts functionally equivalent?
- Variable names can differ.
- The sequence of operations and dependencies must be the same.
- The logic must achieve the same goal.

Respond with exactly "YES" or "NO".`;

    try {
        const response = await agent.complete({
            prompt,
            mode: 'fast',
            context: { intent: 'eval-code-match' }
        });
        return response.trim().toUpperCase().includes('YES');
    } catch (error) {
        console.warn('Error during semantic check:', error.message);
        return false;
    }
}

main().catch(console.error);
