export default class MockLLMAgent {
    constructor(resolver = {}) {
        this.prompts = [];
        if (typeof resolver === 'function') {
            this.resolver = resolver;
            this.responses = null;
        } else {
            this.responses = new Map();
            Object.entries(resolver || {}).forEach(([key, value]) => {
                this.responses.set(String(key), value);
            });
        }
    }

    setPromptResponse(prompt, value) {
        if (!this.responses) {
            this.responses = new Map();
        }
        this.responses.set(String(prompt), value);
    }

    async executePrompt(prompt) {
        this.prompts.push(prompt);
        if (this.resolver) {
            return this.resolver(prompt);
        }
        const key = String(prompt);
        if (!this.responses.has(key)) {
            throw new Error(`MockLLMAgent has no response for prompt ${key}`);
        }
        const value = this.responses.get(key);
        this.responses.delete(key);
        if (value instanceof Error) {
            throw value;
        }
        if (typeof value === 'function') {
            return value(prompt);
        }
        return value;
    }
}
