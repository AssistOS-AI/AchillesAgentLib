import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { LLMAgent } from '../../../LLMAgents/index.mjs';
import { RecursiveSkilledAgent } from '../../../RecursiveSkilledAgents/RecursiveSkilledAgent.mjs';

function createDefaultMatchers(additionalMatchers = []) {
    const baseMatchers = [
        { key: 'project_code', regex: /project code (?:is|should be|set to|=)\s+([a-zA-Z0-9\- _]+)/i },
        { key: 'location', regex: /location (?:is|should be|set to|=)\s+([a-zA-Z0-9\- _]+)/i },
        { key: 'start_date', regex: /start(?: date)? (?:is|should be|set to|on|=)\s+([a-zA-Z0-9\- ,]+)/i },
        { key: 'start_date', regex: /we start on\s+([a-zA-Z0-9\- ,]+)/i },
        { key: 'end_date', regex: /end(?: date)? (?:is|should be|set to|on|=)\s+([a-zA-Z0-9\- ,]+)/i },
        { key: 'end_date', regex: /wrap(?: up)?(?: on)?\s+([a-zA-Z0-9\- ,]+)/i },
        { key: 'supervisor', regex: /(?:^|\b)supervisor (?:is|should be|set to|=)\s+([a-zA-Z0-9\- ']+?)(?:(?:\sand\b)|[.!?,]|$)/i },
        { key: 'supervisor', regex: /make\s+supervisor\s+([a-zA-Z0-9\- ']+?)(?:(?:\sand\b)|[.!?,]|$)/i },
        { key: 'backup_supervisor', regex: /(?:^|\b)backup supervisor (?:is|should be|set to|=|add)\s+([a-zA-Z0-9\- ']+?)(?:[.!?,]|$)/i },
        { key: 'backup_supervisor', regex: /add\s+backup supervisor\s+([a-zA-Z0-9\- ']+?)(?:[.!?,]|$)/i },
        { key: 'priority', regex: /priority (?:is|should be|set to|=)\s+([a-zA-Z0-9\- ]+)/i },
        { key: 'priority', regex: /set\s+priority\s+to\s+([a-zA-Z0-9\- ]+)/i },
        { key: 'severity', regex: /severity (?:is|should be|set to|=)\s+([a-zA-Z0-9\- ]+)/i },
        { key: 'region_code', regex: /region(?: code)? (?:is|should be|set to|=)\s+([a-zA-Z0-9\- ]+)/i },
        { key: 'region_code', regex: /region should be\s+([a-zA-Z0-9\- ]+)/i },
        { key: 'quantity', regex: /(?:quantity|units|need)\s*(?:is|should be|set to|=)?\s*([0-9]+)/i },
        { key: 'target_warehouse_id', regex: /target warehouse (?:is|should be|set to|=)\s+([a-zA-Z0-9\- ']+)/i },
        { key: 'source_warehouse_id', regex: /source warehouse (?:is|should be|set to|=)\s+([a-zA-Z0-9\- ']+)/i },
        { key: 'destination_warehouse_id', regex: /destination(?: warehouse)? (?:is|should be|set to|=)\s+([a-zA-Z0-9\- ']+)/i },
        { key: 'destination_warehouse_id', regex: /destination should be\s+([a-zA-Z0-9\- ']+)/i },
        { key: 'sku_id', regex: /(?:sku|item|product) (?:is|should be|set to|=)\s+([a-zA-Z0-9\- ']+)/i },
        { key: 'sku_id', regex: /transfer the\s+([a-zA-Z0-9\- ']+)/i },
        { key: 'item_name', regex: /item name (?:is|should be|set to|=)\s+([a-zA-Z0-9\- ']+)/i },
        { key: 'amount', regex: /amount (?:is|should be|set to|=)\s*([$a-zA-Z0-9., ]+)/i },
        { key: 'incident_title', regex: /incident title (?:is|should be|set to|=)\s+([a-zA-Z0-9\- ']+)/i },
        { key: 'assigned_team', regex: /assigned team (?:is|should be|set to|=)\s+([a-zA-Z0-9\- ']+)/i },
        { key: 'machine_name', regex: /machine name (?:is|should be|set to|=)\s+([a-zA-Z0-9\- ']+)/i },
        { key: 'window_start', regex: /window start (?:is|should be|set to|=)\s+([a-zA-Z0-9\- ,]+)/i },
        { key: 'window_start', regex: /keep\s+window start\s+([a-zA-Z0-9\- ,]+)/i },
        { key: 'window_start', regex: /set\s+window start\s+to\s+([a-zA-Z0-9\- ,]+)/i },
        { key: 'window_end', regex: /window end (?:is|should be|set to|=)\s+([a-zA-Z0-9\- ,]+)/i },
        { key: 'window_end', regex: /set\s+window end\s+to\s+([a-zA-Z0-9\- ,]+)/i },
        { key: 'item_id', regex: /item id (?:is|should be|set to|=)\s+([a-zA-Z0-9\-]+)/i },
        { key: 'new_name', regex: /new name (?:is|should be|set to|=)\s+([a-zA-Z0-9 \-]+)/i },
        { key: 'query', regex: /search for\s+([a-zA-Z0-9\- ]+)/i },
    ];
    return [...baseMatchers, ...additionalMatchers];
}

function extractWithMatchers(message, matchers) {
    const updates = {};
    for (const { key, regex } of matchers) {
        const match = message.match(regex);
        if (match && match[1]) {
            updates[key] = match[1].toString().trim().replace(/[.!]+$/, '');
        }
    }
    return updates;
}

const MISSING_KEY_MARKERS = ['missing api key', 'api key', 'unauthorized'];

function deriveLLMErrorReason(error) {
    const attempts = Array.isArray(error?.attempts) ? error.attempts : [];
    if (attempts.length) {
        const allMissing = attempts.every((attempt) => {
            const message = String(attempt?.error?.message || attempt?.error || '').toLowerCase();
            return MISSING_KEY_MARKERS.some(marker => message.includes(marker));
        });
        if (allMissing) {
            return 'Interactive skills require an LLM API key (e.g., OPENAI_API_KEY).';
        }
    }
    const message = String(error?.message || '').trim();
    return message || 'LLM invocation failed.';
}

export async function runInteractiveSkillScenario({
    testDir,
    skillName,
    taskDescription,
    responses = [],
    agentName = 'InteractiveScenarioAgent',
    additionalMatchers = [],
    manualSkillOverrides = null,
    manualResultsInspector = null,
}) {
    if (!testDir) {
        throw new Error('runInteractiveSkillScenario requires a testDir.');
    }
    const normalizedTestDir = path.resolve(testDir);

    const llmAgent = new LLMAgent({ name: agentName });

    // Short-circuit executePrompt for deterministic testing
    llmAgent.executePrompt = async () => 'OK';

    try {
        await llmAgent.executePrompt('Return OK.', { mode: 'fast' });
    } catch (error) {
        return {
            skipReason: deriveLLMErrorReason(error),
        };
    }

    const matchers = createDefaultMatchers(additionalMatchers);
    const originalComplete = llmAgent.complete.bind(llmAgent);
    const originalInterpret = llmAgent.interpretMessage?.bind(llmAgent) || null;

    llmAgent.complete = async (options = {}) => {
        const intent = options?.context?.intent || '';

        if (intent === 'skill-argument-extraction') {
            const history = Array.isArray(options.history) ? options.history : [];
            const systemMessages = history
                .filter(({ role }) => role === 'system')
                .map(({ message }) => message)
                .join(' ');
            const lastUserMessage = [...history].reverse().find(({ role }) => role === 'user');
            const messageToInspect = lastUserMessage?.message || systemMessages || '';
            const extracted = extractWithMatchers(messageToInspect, matchers);
            if (Object.keys(extracted).length) {
                return Object.entries(extracted)
                    .map(([key, value]) => `- ${key}: ${value}`)
                    .join('\n');
            }
            return '- result: none';
        }

        if (intent === 'action-explanation') {
            return 'Proceed with the planned operation using the confirmed parameters.';
        }

        if (typeof originalComplete === 'function') {
            try {
                return await originalComplete(options);
            } catch (error) {
                return String(error?.message || 'LLM error');
            }
        }

        return 'OK';
    };

    if (originalInterpret) {
        llmAgent.interpretMessage = async (message, interpretOptions = {}) => {
            const trimmed = typeof message === 'string' ? message.trim() : '';
            if (!trimmed) {
                const result = await originalInterpret(message, interpretOptions);
                if (result && result.intent && result.intent !== 'unknown') {
                    return result;
                }
                return result || { intent: 'unknown' };
            }
            const lower = trimmed.toLowerCase();
            if (lower.includes('cancel')) {
                return { intent: 'cancel' };
            }
            if (lower.includes('accept')) {
                return { intent: 'accept' };
            }
            const updates = extractWithMatchers(trimmed, matchers);
            if (Object.keys(updates).length) {
                return { intent: 'update', updates };
            }
            const fallbackUpdates = extractWithMatchers(trimmed, matchers);
            if (Object.keys(fallbackUpdates).length) {
                return { intent: 'update', updates: fallbackUpdates };
            }
            if (lower.includes('cancel')) {
                return { intent: 'cancel' };
            }
            if (lower.includes('accept')) {
                return { intent: 'accept' };
            }

            if (typeof originalInterpret === 'function') {
                try {
                    const result = await originalInterpret(message, interpretOptions);
                    if (result && result.intent && result.intent !== 'unknown') {
                        return result;
                    }
                } catch (error) {
                    return { intent: 'unknown' };
                }
            }

            return { intent: 'unknown' };
        };
    }

    const consoleLog = console.log;
    const capturedLogs = [];
    const prompts = [];
    const transcript = [];
    const actionCalls = [];

    console.log = (...args) => {
        capturedLogs.push(args.join(' '));
    };

    const replies = Array.isArray(responses) ? responses.slice() : [];
    let promptCount = 0;
    const MAX_PROMPTS = 100;

    const promptReader = async (promptMessage) => {
        prompts.push(promptMessage);
        promptCount += 1;
        if (promptCount > MAX_PROMPTS) {
            throw new Error(`Exceeded maximum simulated prompt count (${MAX_PROMPTS}).`);
        }
        const reply = replies.length ? replies.shift() : '';
        transcript.push({ prompt: promptMessage, reply });
        if (!reply && !replies.length && promptCount > 1) {
            throw new Error(`Scenario responses exhausted. Last prompt: "${promptMessage.slice(0, 160)}"`);
        }
        return reply;
    };

    const recursiveAgent = new RecursiveSkilledAgent({
        llmAgent,
        promptReader,
        startDir: normalizedTestDir,
        skillFilter: ({ type }) => type === 'interactive',
    });

    try {
        const interactiveSkills = Array.from(recursiveAgent.skillCatalog.values())
            .filter((record) => record.type === 'interactive');

        if (!interactiveSkills.length) {
            throw new Error(`No interactive skills discovered under ${path.join(normalizedTestDir, '.AchillesSkills')}`);
        }

        const resolveSkillRecord = (identifier) => {
            if (!identifier) {
                return null;
            }
            const direct = recursiveAgent.getSkillRecord(identifier);
            if (direct) {
                return direct;
            }
            return recursiveAgent.skillCatalog.get(identifier) || null;
        };

        const targetRecord = resolveSkillRecord(skillName)
            || (skillName ? null : interactiveSkills[0]);

        if (!targetRecord) {
            const available = interactiveSkills.map((record) => record.shortName || record.name);
            throw new Error(`Skill "${skillName}" not discovered. Available: ${available.join(', ')}`);
        }

        const invocationName = skillName || targetRecord.shortName || targetRecord.name;

        let executionResult = null;
        let executionError = null;
        try {
            executionResult = await recursiveAgent.executePrompt(taskDescription, {
                skillName: invocationName,
            });
        } catch (error) {
            executionError = error;
        }

        if (typeof manualResultsInspector === 'function') {
            manualResultsInspector({
                result: executionResult,
                error: executionError,
                recursiveAgent,
                discoveredSkills: interactiveSkills,
            });
        }

        const resolvedRecord = executionResult
            ? resolveSkillRecord(executionResult.skill) || targetRecord
            : targetRecord;

        const shortSkillName = resolvedRecord?.shortName
            || skillName
            || executionResult?.skill;

        return {
            result: executionResult?.result,
            skill: shortSkillName,
            metadata: executionResult?.metadata || resolvedRecord?.metadata || null,
            error: executionError,
            logs: capturedLogs,
            prompts,
            transcript,
            actionCalls,
            remainingResponses: replies,
        };
    } finally {
        console.log = consoleLog;
    }
}

export function resolveTestDir(meta) {
    if (!meta?.url) {
        throw new Error('resolveTestDir requires an import.meta.url reference.');
    }
    const filename = fileURLToPath(meta.url);
    return path.dirname(filename);
}

export function isConfirmationPrompt(prompt = '') {
    if (typeof prompt !== 'string') {
        return false;
    }
    const normalized = prompt.trim();
    if (!normalized) {
        return false;
    }
    return /📋\s+About to (?:perform|apply)/i.test(normalized)
        || /About to apply/i.test(normalized)
        || /Confirm by replying\s+"accept"/i.test(normalized);
}
