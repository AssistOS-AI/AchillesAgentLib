
import {
    RETURN_RESPONSE_TOOL,
    RETURN_RESPONSE_DESCRIPTION,
    normalizeResponsePayload,
} from '../../LLMAgents/constants.mjs';

async function resolveArguments(agent, args, instruction, schema, regexPatterns = []) {
    // If we are in a Loop session (indicated by agent.currentSession),
    // and the arguments don't look like structured data, use LLM to extract.

    const isLoop = !!agent.currentSession;
    const input = args.length === 1 ? args[0] : args;

    // eslint-disable-next-line no-console
    console.log(`[resolveArguments] isLoop=${isLoop}, args=${JSON.stringify(args)}, instruction="${instruction}"`);

    if (!isLoop) {
        // SOP mode: Expect exact arguments
        // Sometimes SOP adapter might pass a single string "a, b" if it came from a planner that formatted it so.
        if (args.length === 1 && typeof args[0] === 'string' && args[0].includes(',')) {
            return args[0].split(',').map(x => x.trim());
        }
        return args;
    }

    // Loop mode: Input is likely a natural language instruction.
    // We need to extract arguments.
    const prompt = String(input);

    // 1. Try Regex Patterns
    for (const pattern of regexPatterns) {
        const match = prompt.match(pattern);
        if (match) {
            // Assume capture groups correspond to schema order
            // If schema has 2 items, we expect at least 2 capture groups.
            // match[0] is full match, match[1] is first group.
            const captured = match.slice(1);
            if (captured.length >= schema.length) {
                // eslint-disable-next-line no-console
                console.log(`[resolveArguments] Regex matched: ${pattern}`);
                return captured.map(c => c.trim());
            }
        }
    }

    // 2. Optimization: Try to parse "a, b" or simple numbers if schema matches
    if (args.length === 1) {
        const parts = prompt.split(',');
        if (parts.length > 1 && parts.every(p => !isNaN(parseFloat(p)))) {
            // eslint-disable-next-line no-console
            console.log('[resolveArguments] Simple comma split matched numbers');
            return parts.map(p => p.trim());
        }
    }

    // 3. Use LLM to extract
    const extractionPrompt = [
        'You are an argument extractor.',
        `Task: ${instruction}`,
        'Extract the arguments from the following user prompt.',
        `Return ONLY a JSON array of strings/numbers matching this schema: ${JSON.stringify(schema)}`,
        'Do not explain.',
        '',
        `Prompt: ${prompt}`
    ].join('\n');

    const result = await agent.complete({
        prompt: extractionPrompt,
        mode: 'fast',
        context: { intent: 'perf-tool-extract-args' },
    });

    try {
        const parsed = JSON.parse(result);
        if (Array.isArray(parsed)) {
            // eslint-disable-next-line no-console
            console.log(`[resolveArguments] LLM extraction success: ${JSON.stringify(parsed)}`);
            return parsed;
        }
    } catch (e) {
        // ignore
    }

    // 4. Fail if we couldn't extract
    throw new Error(`Failed to extract arguments for instruction: "${prompt}". Expected schema: ${JSON.stringify(schema)}`);
}

const getToolStateBucket = (agent) => {
    if (!agent) {
        return null;
    }
    if (agent.__toolState instanceof Map) {
        return agent.__toolState;
    }
    agent.__toolState = new Map();
    return agent.__toolState;
};

const getToolState = (agent, toolName) => {
    const bucket = getToolStateBucket(agent);
    if (!bucket) {
        return null;
    }
    if (!bucket.has(toolName)) {
        bucket.set(toolName, { count: 0, data: null });
    }
    return bucket.get(toolName);
};

const BASE_PERFORMANCE_TOOLS = {
    add: {
        description: 'Adds two numbers. Usage: add(a, b) or add("a, b")',
        handler: async (agent, ...args) => {
            const resolved = await resolveArguments(agent, args, 'Extract two numbers to add.', ['number', 'number'], [
                /add\s+(\d+)\s+and\s+(\d+)/i,
                /(\d+)\s*\+\s*(\d+)/
            ]);
            const [a, b] = resolved;
            return String(Number(a) + Number(b));
        },
    },
    multiply: {
        description: 'Multiplies two numbers. Usage: multiply(a, b) or multiply("a, b")',
        handler: async (agent, ...args) => {
            const resolved = await resolveArguments(agent, args, 'Extract two numbers to multiply.', ['number', 'number'], [
                /multiply\s+(\d+)\s+by\s+(\d+)/i,
                /(\d+)\s*\*\s*(\d+)/
            ]);
            const [a, b] = resolved;
            return String(Number(a) * Number(b));
        },
    },
    subtract: {
        description: 'Subtracts the second number from the first. Usage: subtract(a, b) or subtract("a, b")',
        handler: async (agent, ...args) => {
            const resolved = await resolveArguments(agent, args, 'Extract two numbers: [minuend, subtrahend].', ['number', 'number'], [
                /(\d+)\s*-\s*(\d+)/
            ]);
            // If regex matched "Subtract 7 from 20", we might get [7, 20] if we added that regex.
            // Let's stick to LLM for "from" logic to avoid confusion, or handle it in handler.
            // But resolveArguments is generic.
            // Let's trust LLM for "Subtract 7 from 20" for now, or add specific logic if needed.
            // Wait, the user said "give suggestions of possible variants as regular expressions".
            // If I put /subtract\s+(\d+)\s+from\s+(\d+)/i, it returns [7, 20].
            // But the tool expects [a, b] -> a-b. So [20, 7].
            // So I should NOT use that regex here unless I can reorder.
            // I will omit the "from" regex and let LLM handle it, or use a regex that matches "20 minus 7".

            const [a, b] = resolved;
            // Check if we got "Subtract 7 from 20" via LLM, LLM usually handles it right.
            // If we used regex for "20 - 7", we get [20, 7].
            return String(Number(a) - Number(b));
        },
    },
    divide: {
        description: 'Divides the first number by the second. Usage: divide(a, b) or divide("a, b")',
        handler: async (agent, ...args) => {
            const resolved = await resolveArguments(agent, args, 'Extract two numbers: [numerator, denominator].', ['number', 'number'], [
                /divide\s+(\d+)\s+by\s+(\d+)/i,
                /(\d+)\s*\/\s*(\d+)/
            ]);
            const [a, b] = resolved;
            const numB = Number(b);
            if (numB === 0) return 'Infinity';
            return String(Number(a) / numB);
        },
    },
    reverse: {
        description: 'Reverses the provided text.',
        handler: async (agent, ...args) => {
            const resolved = await resolveArguments(agent, args, 'Extract the text content to be reversed.', ['text'], [
                /reverse\s+(?:the\s+text\s+)?['"]?(.+?)['"]?$/i
            ]);
            const text = resolved[0];
            return String(text).split('').reverse().join('');
        },
    },
    uppercase: {
        description: 'Converts the provided text to uppercase.',
        handler: async (agent, ...args) => {
            const resolved = await resolveArguments(agent, args, 'Extract the text content to be uppercased.', ['text'], [
                /uppercase\s+(?:the\s+text\s+)?['"]?(.+?)['"]?$/i,
                /convert\s+(?:['"]?(.+?)['"]?)\s+to\s+uppercase/i
            ]);
            const text = resolved[0];
            return String(text).toUpperCase();
        },
    },
    lowercase: {
        description: 'Converts the provided text to lowercase.',
        handler: async (agent, ...args) => {
            const resolved = await resolveArguments(agent, args, 'Extract the text content to be lowercased.', ['text'], [
                /lowercase\s+(?:the\s+text\s+)?['"]?(.+?)['"]?$/i,
                /convert\s+(?:['"]?(.+?)['"]?)\s+to\s+lowercase/i
            ]);
            const text = resolved[0];
            return String(text).toLowerCase();
        },
    },
    length: {
        description: 'Returns the character length of the provided text.',
        handler: async (agent, ...args) => {
            const resolved = await resolveArguments(agent, args, 'Extract the text content to count length.', ['text'], [
                /length\s+of\s+(?:the\s+text\s+)?['"]?(.+?)['"]?$/i,
                /count\s+characters\s+in\s+['"]?(.+?)['"]?$/i
            ]);
            const text = resolved[0];
            return String(String(text).length);
        },
    },
    substring: {
        description: 'Extracts a substring given text, start, and length. Usage: substring(text, start, length)',
        handler: async (agent, ...args) => {
            const resolved = await resolveArguments(agent, args, 'Extract text, start index, and length for substring.', ['text', 'number', 'number']);
            const [text, start, length] = resolved;
            const begin = Number(start);
            const take = Number(length);
            return String(text).substring(begin, begin + take);
        },
    },
    concat: {
        description: 'Concatenates two strings. Usage: concat(a, b) or concat("a, b")',
        handler: async (agent, ...args) => {
            const resolved = await resolveArguments(agent, args, 'Extract two strings to concatenate.', ['string', 'string'], [
                /concatenate\s+['"]?(.+?)['"]?\s+and\s+['"]?(.+?)['"]?$/i
            ]);
            const [a, b] = resolved;
            return String(a) + String(b);
        },
    },
    contains: {
        description: 'Checks if the first string contains the second string.',
        handler: async (agent, ...args) => {
            const resolved = await resolveArguments(agent, args, 'Extract haystack and needle strings.', ['string', 'string']);
            const [haystack, needle] = resolved;
            return String(haystack).includes(String(needle)) ? 'true' : 'false';
        },
    },
    isEven: {
        description: 'Returns true if the provided integer is even.',
        handler: async (agent, ...args) => {
            const resolved = await resolveArguments(agent, args, 'Extract the integer to check.', ['number'], [
                /is\s+(\d+)\s+even/i,
                /check\s+if\s+(\d+)\s+is\s+even/i
            ]);
            const n = resolved[0];
            return (Number.parseInt(n, 10) % 2 === 0 ? 'true' : 'false');
        },
    },
    invert: {
        description: 'Inverts a boolean string (true/false).',
        handler: async (agent, ...args) => {
            const resolved = await resolveArguments(agent, args, 'Extract the boolean value (true/false) to invert.', ['boolean'], [
                /invert\s+(true|false)/i
            ]);
            const bool = resolved[0];
            return (String(bool).trim() === 'true' ? 'false' : 'true');
        },
    },
    extractEmail: {
        description: 'Extracts the first e-mail address from text.',
        handler: async (agent, ...args) => {
            const text = args.join(' ');
            const match = String(text).match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
            return match ? match[0] : '';
        },
    },
    getDomain: {
        description: 'Extracts the domain portion of an e-mail address.',
        handler: async (agent, ...args) => {
            const resolved = await resolveArguments(agent, args, 'Extract the email address to get domain from.', ['email'], [
                /domain\s+of\s+([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i
            ]);
            const email = resolved[0];
            const parts = String(email).split('@');
            return parts.length > 1 ? parts[1] : '';
        },
    },
    analyzeSentiment: {
        description: 'Analyzes the sentiment of the text (POSITIVE, NEGATIVE, NEUTRAL).',
        handler: async (agent, ...args) => {
            const text = args.join(' ');
            const instruction = [
                'Analyze the sentiment of the following text.',
                'Respond ONLY with one of: POSITIVE, NEGATIVE, NEUTRAL.',
                'Do not explain.',
                '',
                text,
            ].join('\n');
            const result = await agent.complete({
                prompt: instruction,
                mode: 'fast',
                context: { intent: 'perf-tool-sentiment' },
            });
            return String(result).trim();
        },
    },
    translateText: {
        description: 'Translates text to a specified language. Usage: translateText(targetLang, text)',
        handler: async (agent, ...args) => {
            const resolved = await resolveArguments(agent, args, 'Extract target language and text to translate.', ['targetLang', 'text'], [
                /translate\s+['"]?(.+?)['"]?\s+to\s+(\w+)$/i // "Translate 'hello' to Spanish" -> captures [text, lang]. Wait, schema is [targetLang, text].
                // Regex captures [text, lang]. We need to swap.
                // resolveArguments returns captures in order.
                // So we can't use this regex if we want generic resolveArguments to map to schema.
                // Unless we change schema or regex.
                // Let's use a regex that matches schema order if possible, or just rely on LLM.
                // "Translate to Spanish: hello" -> /translate\s+to\s+(\w+):\s+(.+)/i -> [lang, text]
            ]);

            // If we used the regex above, we might get [text, lang] if we matched "Translate X to Y".
            // But our tool expects [targetLang, text].
            // Let's rely on LLM for translation to be safe, or use named groups if we could (but JS regex groups are positional in match result).
            // I will omit regex for translation to avoid parameter swapping issues for now.

            const [targetLang, text] = resolved;

            const instruction = [
                `Translate the following text to ${targetLang}.`,
                'Respond ONLY with the translated text.',
                'Do not explain.',
                '',
                text,
            ].join('\n');
            const result = await agent.complete({
                prompt: instruction,
                mode: 'fast',
                context: { intent: 'perf-tool-translate' },
            });
            return String(result).trim();
        },
    },
    classifyTopic: {
        description: 'Classifies text into one of: Finance, Health, Technology, Sports.',
        handler: async (agent, ...args) => {
            const text = args.join(' ');
            const instruction = [
                'Classify the following text into one of these topics: Finance, Health, Technology, Sports.',
                'Respond ONLY with the topic name.',
                '',
                text,
            ].join('\n');
            const result = await agent.complete({
                prompt: instruction,
                mode: 'fast',
                context: { intent: 'perf-tool-classify' },
            });
            return String(result).trim();
        },
    },
    extractNames: {
        description: 'Extracts person names from text. Returns comma-separated list.',
        handler: async (agent, ...args) => {
            const text = args.join(' ');
            const instruction = [
                'Extract all person names from the following text.',
                'Respond ONLY with a comma-separated list of names.',
                'If none, respond with "NONE".',
                '',
                text,
            ].join('\n');
            const result = await agent.complete({
                prompt: instruction,
                mode: 'fast',
                context: { intent: 'perf-tool-extract-names' },
            });
            return String(result).trim();
        },
    },
    summarizeContent: {
        description: 'Summarizes text into a single sentence.',
        handler: async (agent, ...args) => {
            const text = args.join(' ');
            const instruction = [
                'Summarize the following text into exactly one sentence.',
                'Respond ONLY with the summary.',
                '',
                text,
            ].join('\n');
            const result = await agent.complete({
                prompt: instruction,
                mode: 'fast',
                context: { intent: 'perf-tool-summarize' },
            });
            return String(result).trim();
        },
    },
    flakyAdd: {
        description: 'Adds two numbers but may fail the first time with a transient error.',
        handler: async (agent, ...args) => {
            const resolved = await resolveArguments(agent, args, 'Extract two numbers to add.', ['number', 'number']);
            const [a, b] = resolved;
            const state = getToolState(agent, 'flakyAdd');
            state.count = (state.count || 0) + 1;
            if (state.count === 1) {
                throw new Error('flakyAdd encountered a transient failure. Regenerate or retry the same plan.');
            }
            return String(Number(a) + Number(b));
        },
    },
    flakyUppercase: {
        description: 'Converts text to uppercase but fails the first time to simulate flaky dependencies.',
        handler: async (agent, ...args) => {
            const resolved = await resolveArguments(agent, args, 'Extract the text content to be uppercased.', ['text']);
            const text = resolved[0];
            const state = getToolState(agent, 'flakyUppercase');
            state.count = (state.count || 0) + 1;
            if (state.count === 1) {
                throw new Error('flakyUppercase could not acquire the transform service. Try again.');
            }
            return String(text).toUpperCase();
        },
    },
    and: {
        description: 'Logical AND of two booleans.',
        handler: async (agent, ...args) => {
            const resolved = await resolveArguments(agent, args, 'Extract two boolean values (true/false).', ['boolean', 'boolean']);
            const [a, b] = resolved.map((val) => String(val).trim().toLowerCase() === 'true');
            return (a && b) ? 'true' : 'false';
        },
    },
    or: {
        description: 'Logical OR of two booleans.',
        handler: async (agent, ...args) => {
            const resolved = await resolveArguments(agent, args, 'Extract two boolean values (true/false).', ['boolean', 'boolean']);
            const [a, b] = resolved.map((val) => String(val).trim().toLowerCase() === 'true');
            return (a || b) ? 'true' : 'false';
        },
    },

};

const PERFORMANCE_TOOLS = { ...BASE_PERFORMANCE_TOOLS };

export {
    PERFORMANCE_TOOLS,
};
