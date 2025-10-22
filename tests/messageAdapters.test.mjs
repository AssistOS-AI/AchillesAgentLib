import test from 'node:test';
import assert from 'node:assert/strict';

import { LLMAgent } from '../LLMAgents/LLMAgent.mjs';
import { listModelsFromCache, loadModelsConfiguration } from '../utils/LLMClient.mjs'; // loadModelsConfiguration is needed to ensure models are loaded

import { toAnthropicMessages } from '../utils/LLMProviders/messageAdapters/anthropicMessages.mjs';
import { toGeminiPayload } from '../utils/LLMProviders/messageAdapters/googleGemini.mjs';
import { toHuggingFacePrompt } from '../utils/LLMProviders/messageAdapters/huggingFaceConversational.mjs';
import { toOpenAIChatMessages } from '../utils/LLMProviders/messageAdapters/openAIChat.mjs';

// Ensure models are loaded before tests run
loadModelsConfiguration();

const sampleHistory = [
    { role: 'system', message: 'You are a helpful assistant.' },
    { role: 'user', message: 'This is a test to see if the text is transformed to providers message format for their APIs' },
    { role: 'assistant', message: 'I will help with that.' },
];

test('LLMAgent.complete uses correct message adapter for each configured model (mocked)', async () => {
    const llmAgent = new LLMAgent();

    // Override the complete method for this test
    llmAgent.complete = async (options = {}) => {
        const { history = [], model = null } = options; // prompt is now empty

        if (!model) {
            throw new Error('Model must be specified for mocked complete.');
        }

        const { fast, deep } = listModelsFromCache();
        const allModels = [...fast, ...deep];
        const modelRecord = allModels.find(m => m.name === model);

        if (!modelRecord) {
            throw new Error(`Model ${model} not found in cache.`);
        }

        const providerKey = modelRecord.providerKey;
        let convertedContext;

        // Use history directly, as it now contains the full conversation
        switch (providerKey) {
            case 'anthropic':
                convertedContext = toAnthropicMessages(history);
                break;
            case 'google':
                convertedContext = toGeminiPayload(history);
                break;
            case 'huggingface':
                convertedContext = toHuggingFacePrompt(history);
                break;
            case 'openai':
                convertedContext = toOpenAIChatMessages(history);
                break;
            default:
                throw new Error(`Unknown provider key: ${providerKey}`);
        }
        return JSON.stringify(convertedContext);
    };

    const { fast, deep } = listModelsFromCache();
    const allModels = [...fast, ...deep];

    for (const modelRecord of allModels) {
        const modelName = modelRecord.name;
        const providerKey = modelRecord.providerKey;

        // Skip models that don't have a direct message adapter or are not relevant for this test
        if (!['anthropic', 'google', 'huggingface', 'openai'].includes(providerKey)) {
            continue;
        }

        const response = await llmAgent.complete({
            prompt: '', // No separate prompt, as fullHistory is passed
            history: sampleHistory, // Pass the full sampleHistory
            model: modelName,
        });

        const convertedContext = JSON.parse(response); // Parse the mocked response

        switch (providerKey) {
            case 'anthropic': {
                const { system, messages } = convertedContext;
                assert.equal(system, 'You are a helpful assistant.', `Anthropic: Should extract system message for ${modelName}`);
                assert.equal(messages.length, 2, `Anthropic: Should have two messages for ${modelName}`);
                assert.equal(messages[0].role, 'user', `Anthropic: First message role should be user for ${modelName}`);
                assert.equal(messages[0].content[0].text, 'This is a test to see if the text is transformed to providers message format for their APIs', `Anthropic: First message content should match for ${modelName}`);
                assert.equal(messages[1].role, 'assistant', `Anthropic: Second message role should be assistant for ${modelName}`);
                assert.equal(messages[1].content[0].text, 'I will help with that.', `Anthropic: Second message content should match for ${modelName}`);
                break;
            }
            case 'google': {
                const { contents, systemInstruction } = convertedContext;
                assert.deepStrictEqual(systemInstruction, { role: 'system', parts: [{ text: 'You are a helpful assistant.' }] }, `Gemini: Should extract system instruction for ${modelName}`);
                assert.equal(contents.length, 2, `Gemini: Should have two contents for ${modelName}`);
                assert.equal(contents[0].role, 'user', `Gemini: First content role should be user for ${modelName}`);
                assert.ok(contents[0].parts, `Gemini: First content should have parts for ${modelName}`);
                assert.equal(contents[0].parts[0].text, 'This is a test to see if the text is transformed to providers message format for their APIs', `Gemini: First content text should match for ${modelName}`);
                assert.equal(contents[1].role, 'model', `Gemini: Second content role should be model for ${modelName}`);
                assert.ok(contents[1].parts, `Gemini: Second content should have parts for ${modelName}`);
                assert.equal(contents[1].parts[0].text, 'I will help with that.', `Gemini: Second content text should match for ${modelName}`);
                break;
            }
            case 'huggingface': {
                const promptString = convertedContext;
                assert.ok(promptString.includes('System: You are a helpful assistant.'), `HuggingFace: Should include system message for ${modelName}`);
                assert.ok(promptString.includes('User: This is a test to see if the text is transformed to providers message format for their APIs'), `HuggingFace: Should include user message for ${modelName}`);
                assert.ok(promptString.includes('Assistant: I will help with that.'), `HuggingFace: Should include assistant message for ${modelName}`);
                break;
            }
            case 'openai': {
                const messages = convertedContext;
                assert.equal(messages.length, 3, `OpenAI: Should have three messages for ${modelName}`);
                assert.equal(messages[0].role, 'system', `OpenAI: First message role should be system for ${modelName}`);
                assert.equal(messages[0].content, 'You are a helpful assistant.', `OpenAI: First message content should match for ${modelName}`);
                assert.equal(messages[1].role, 'user', `OpenAI: Second message role should be user for ${modelName}`);
                assert.equal(messages[1].content, 'This is a test to see if the text is transformed to providers message format for their APIs', `OpenAI: Second message content should match for ${modelName}`);
                assert.equal(messages[2].role, 'assistant', `OpenAI: Third message role should be assistant for ${modelName}`);
                assert.equal(messages[2].content, 'I will help with that.', `OpenAI: Third message content should match for ${modelName}`);
                break;
            }
        }
    }
});
