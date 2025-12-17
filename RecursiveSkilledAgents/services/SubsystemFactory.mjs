import { CodeGenerationSkillsSubsystem } from '../../CodeSkillsSubsystem/CodeSkillsSubsystem.mjs';
import { CodeSpecsSkillsSubsystem } from '../../CodeSpecsSkillsSubsystem/CodeSpecsSkillsSubsystem.mjs';
import { InteractiveSkillsSubsystem } from '../../InteractiveSkillsSubsystem/InteractiveSkillsSubsystem.mjs';
import { ClaudeSkillsSubsystem } from '../../ClaudeSkillsSubsystem/ClaudeSkillsSubsystem.mjs';
import { MCPSkillsSubsystem } from '../../MCPSkillsSubsystem/MCPSkillsSubsystem.mjs';
import { OrchestratorSkillsSubsystem } from '../../OrchestratorSkillsSubsystem/OrchestratorSkillsSubsystem.mjs';
import { DBTableSkillsSubsystem } from '../../DBTableSkillsSubsystem/DBTableSkillsSubsystem.mjs';

/**
 * Registry of subsystem types to their class constructors.
 * Can be extended via SubsystemFactory.register() for custom subsystem types.
 */
const SUBSYSTEM_REGISTRY = new Map([
    ['code-generation', CodeGenerationSkillsSubsystem],
    ['csskill', CodeSpecsSkillsSubsystem],
    ['interactive', InteractiveSkillsSubsystem],
    ['mcp', MCPSkillsSubsystem],
    ['orchestrator', OrchestratorSkillsSubsystem],
    ['dbtable', DBTableSkillsSubsystem],
    ['claude', ClaudeSkillsSubsystem],
]);

/**
 * Factory for creating and caching skill subsystem instances.
 * Implements lazy instantiation with singleton pattern per type.
 * Follows Open/Closed principle - new types can be registered without modifying factory code.
 */
export class SubsystemFactory {
    /**
     * Create a new SubsystemFactory.
     * @param {Object} options - Factory options
     * @param {Object} [options.llmAgent] - LLM agent instance for subsystems that require it
     * @param {Object} [options.dbAdapter] - Database adapter for DBTableSkillsSubsystem
     */
    constructor({ llmAgent = null, dbAdapter = null } = {}) {
        this.llmAgent = llmAgent;
        this.dbAdapter = dbAdapter;
        this.instances = new Map();
    }

    /**
     * Get or create a subsystem instance of the specified type.
     * Subsystems are cached and reused on subsequent calls.
     *
     * @param {string} type - The subsystem type ('code-generation', 'csskill', 'interactive', 'mcp', 'orchestrator', 'dbtable', 'claude')
     * @returns {Object} The subsystem instance
     * @throws {Error} If the subsystem type is not registered
     */
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

    /**
     * Create a new instance of a subsystem class with appropriate options.
     * @private
     * @param {string} type - The subsystem type
     * @param {Function} SubsystemClass - The constructor class
     * @returns {Object} New subsystem instance
     */
    _createInstance(type, SubsystemClass) {
        if (type === 'dbtable') {
            return new SubsystemClass({
                llmAgent: this.llmAgent,
                dbAdapter: this.dbAdapter,
            });
        }

        if (type === 'claude') {
            return new SubsystemClass();
        }

        return new SubsystemClass({ llmAgent: this.llmAgent });
    }

    /**
     * Check if a subsystem instance exists for the given type.
     * @param {string} type - The subsystem type to check
     * @returns {boolean} True if instance exists
     */
    has(type) {
        return this.instances.has(type);
    }

    /**
     * Clear all cached subsystem instances.
     * Useful for testing or when reconfiguring the factory.
     */
    clear() {
        this.instances.clear();
    }

    /**
     * Update the LLM agent for all future subsystem instances.
     * Does not update already-created instances.
     * @param {Object} llmAgent - The new LLM agent
     */
    setLLMAgent(llmAgent) {
        this.llmAgent = llmAgent;
    }

    /**
     * Update the database adapter for future DBTableSkillsSubsystem instances.
     * Does not update already-created instances.
     * @param {Object} dbAdapter - The new database adapter
     */
    setDbAdapter(dbAdapter) {
        this.dbAdapter = dbAdapter;
    }

    /**
     * Register a new subsystem type.
     * Allows extending the factory with custom subsystem implementations.
     *
     * @param {string} type - The subsystem type identifier
     * @param {Function} SubsystemClass - The constructor class for the subsystem
     */
    static register(type, SubsystemClass) {
        SUBSYSTEM_REGISTRY.set(type, SubsystemClass);
    }

    /**
     * Get all registered subsystem types.
     * @returns {string[]} Array of registered type names
     */
    static getRegisteredTypes() {
        return Array.from(SUBSYSTEM_REGISTRY.keys());
    }
}
