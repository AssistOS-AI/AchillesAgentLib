import { BaseSkillsSubsystem } from '../SkillsSubsystems/BaseSkillsSubsystem.mjs';

export class SimpleSkillsSubsystem extends BaseSkillsSubsystem {
    constructor({ type, skilledAgent, skilledAgentOptions } = {}) {
        super({ skilledAgent, skilledAgentOptions });
        this.type = type || 'general';
    }

    registerSkillDescriptor({ skillName, summary, filePath, skillDir, sections, body, title }) {
        const description = summary || title || `Skill ${skillName}`;

        const specs = {
            name: skillName,
            description,
            what: description,
            why: `Automatically registered ${this.type} skill originating from ${filePath}.`,
            arguments: {},
            requiredArguments: [],
            needConfirmation: false,
        };

        const action = async (_, { contextManager = null } = {}) => {
            const payload = {
                summary: description,
                details: body || '',
                type: this.type,
            };

            if (contextManager && typeof contextManager.appendToHistory === 'function') {
                try {
                    contextManager.appendToHistory({ user: 'system:skill-invocation', ai: JSON.stringify(payload) });
                } catch (error) {
                    // Ignore context errors
                }
            }

            return payload;
        };

        const roles = [this.type];
        const registeredName = this.skilledAgent.registerSkill({ specs, action, roles });
        const canonicalName = registeredName || skillName;

        this.recordMetadata(canonicalName, {
            type: this.type,
            filePath,
            skillDir,
            title,
            summary,
            body,
            sections,
        });

        return canonicalName;
    }
}
