import { DynamicCodeGenerationSubsystem } from '../../DynamicCodeGenerationSubsystem/index.mjs';
import { CodeSkillsSubsystem } from '../../CodeSkillsSubsystem/index.mjs';
import { AnthropicSkillsSubsystem } from '../../AnthropicSkillsSubsystem/index.mjs';
import { MCPSkillsSubsystem } from '../../MCPSkillsSubsystem/index.mjs';
import { OrchestratorSkillsSubsystem } from '../../OrchestratorSkillsSubsystem/index.mjs';
import { DBTableSkillsSubsystem } from '../../DBTableSkillsSubsystem/index.mjs';

const SUBSYSTEM_REGISTRY = new Map([
    ['dynamic-code-generation', DynamicCodeGenerationSubsystem],
    ['cskill', CodeSkillsSubsystem],
    ['mcp', MCPSkillsSubsystem],
    ['orchestrator', OrchestratorSkillsSubsystem],
    ['dbtable', DBTableSkillsSubsystem],
    ['anthropic', AnthropicSkillsSubsystem],
]);

export class SubsystemFactory {
    constructor({ llmAgent = null, modelConfig = null } = {}) {
        this.llmAgent = llmAgent;
        this.modelConfig = modelConfig;
        this.instances = new Map();
    }

    get(type) {
        if (this.instances.has(type)) {
            return this.instances.get(type);
        }

        const SubsystemClass = SUBSYSTEM_REGISTRY.get(type);
        if (!SubsystemClass) {
            throw new Error(`Unknown subsystem type: ${type}`);
        }

        const instance = this._createInstance(type, SubsystemClass);
        this.instances.set(type, instance);
        return instance;
    }

    _createInstance(type, SubsystemClass) {
        if (type === 'anthropic') {
            return new SubsystemClass({ modelConfig: this.modelConfig });
        }

        return new SubsystemClass({ llmAgent: this.llmAgent, modelConfig: this.modelConfig });
    }

    has(type) {
        return this.instances.has(type);
    }

    clear() {
        this.instances.clear();
    }

    setLLMAgent(llmAgent) {
        this.llmAgent = llmAgent;
    }

    static register(type, SubsystemClass) {
        SUBSYSTEM_REGISTRY.set(type, SubsystemClass);
    }

    static getRegisteredTypes() {
        return Array.from(SUBSYSTEM_REGISTRY.keys());
    }
}
