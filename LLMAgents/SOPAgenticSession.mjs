class SOPAgenticSession {
    constructor({ agent, skillsDescription, options = {} }) {
        if (!agent) {
            throw new Error('SOPAgenticSession requires an LLMAgent instance.');
        }
        if (!skillsDescription || typeof skillsDescription !== 'object') {
            throw new Error('SOPAgenticSession requires a skillsDescription object.');
        }

        this.agent = agent;
        this.skillsDescription = skillsDescription;
        this.options = {
            mode: options.mode || 'deep',
            model: options.model || null,
        };

        this.history = [];
        this.currentPlan = '';
    }

    async newPrompt(userPrompt) {
        if (!userPrompt || typeof userPrompt !== 'string') {
            throw new Error('newPrompt requires a prompt string.');
        }

        // eslint-disable-next-line no-console
        console.log(`[SOPAgenticSession] New prompt: "${userPrompt}"`);

        const englishInstructions = this._buildEnglishInstructions(userPrompt);

        const plan = await this.agent.generateSOPLangPlan(
            this.skillsDescription,
            englishInstructions,
            {
                mode: this.options.mode,
                model: this.options.model,
            },
        );

        this.currentPlan = plan || '';
        this.history.push({
            prompt: userPrompt,
            plan: this.currentPlan,
        });

        return { plan: this.currentPlan };
    }

    async getVariables() {
        return {
            lastPlan: this.currentPlan,
        };
    }

    async getPlan() {
        return this.currentPlan;
    }

    _buildEnglishInstructions(userPrompt) {
        if (!this.currentPlan) {
            // First turn: just use the user instructions directly
            return userPrompt;
        }

        const lines = [];
        lines.push('You are updating an existing LightSOPLang plan.');
        lines.push('');
        lines.push('Current plan:');
        lines.push(this.currentPlan.trim());
        lines.push('');
        lines.push('New user requirement:');
        lines.push(userPrompt.trim());
        lines.push('');
        lines.push('Instructions:');
        lines.push('- Extend or adjust the existing plan so that it satisfies BOTH the previous requirements and the new requirement.');
        lines.push('- Prefer to keep existing variables and declarations whenever possible.');
        lines.push('- For clearly new behaviour, introduce NEW variables instead of overwriting old ones.');
        lines.push('- If the new requirement changes the behaviour of an existing step, you may update that step\'s declaration.');
        lines.push('- When you update declarations, the runtime will automatically recalculate the affected variables based on dependencies.');
        lines.push('- Avoid deleting existing steps unless they are clearly obsolete for all requirements.');
        lines.push('');
        lines.push('Emit ONLY valid LightSOPLang code for the updated plan, with all steps needed for the combined behaviour.');

        return lines.join('\n');
    }
}

export {
    SOPAgenticSession,
};
