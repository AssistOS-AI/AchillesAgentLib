import { Sanitiser } from '../../utils/Sanitiser.mjs';

/**
 * Normalize a skill identifier using the Sanitiser utility.
 * @param {string} value - The value to sanitize
 * @returns {string} Sanitized name
 */
function sanitiseName(value) {
    return Sanitiser.sanitiseName(value);
}

/**
 * Registry for skill records with alias resolution.
 * Maintains a catalog of skills and provides lookup by canonical name or alias.
 */
export class SkillRegistry {
    /**
     * Create a new SkillRegistry.
     * @param {Object} options - Registry options
     * @param {Function} [options.skillFilter] - Filter function for skill inclusion
     * @param {Object} [options.debugLogger] - Debug logger instance
     */
    constructor({ skillFilter = null, debugLogger = null } = {}) {
        this.catalog = new Map();
        this.aliases = new Map();
        this.skillToSubsystem = new Map();
        this.skillFilter = typeof skillFilter === 'function' ? skillFilter : () => true;
        this.debugLogger = debugLogger;
    }

    /**
     * Register a skill record with its aliases.
     * @param {Object} skillRecord - The skill record to register
     * @param {string} skillRecord.name - Canonical skill name
     * @param {string} skillRecord.type - Skill type (code, interactive, etc.)
     * @param {string} skillRecord.shortName - Short name for the skill
     * @param {Object} skillRecord.descriptor - Parsed skill descriptor
     * @returns {boolean} True if registration was successful (passed filter)
     */
    register(skillRecord) {
        const { name, type, shortName, descriptor, filePath, skillDir } = skillRecord;

        const shouldInclude = this.skillFilter({
            type,
            filePath,
            skillDir,
            title: descriptor?.title,
            summary: descriptor?.summary,
            sections: descriptor?.sections,
        });

        if (!shouldInclude) {
            return false;
        }

        const baseName = sanitiseName(descriptor?.title || shortName);
        const aliases = new Set([
            name,
            sanitiseName(name),
            shortName,
            sanitiseName(shortName),
            baseName,
        ].filter(Boolean));

        this.debugLogger?.log('SkillRegistry:register', {
            name,
            type,
            aliases: Array.from(aliases),
        });

        this.catalog.set(name, skillRecord);

        aliases.forEach((alias) => {
            this.aliases.set(alias, skillRecord);
            this.skillToSubsystem.set(alias, type);
        });

        return true;
    }

    /**
     * Get a skill record by name or alias.
     * @param {string} identifier - Skill name or alias
     * @returns {Object|null} The skill record, or null if not found
     */
    get(identifier) {
        if (!identifier || typeof identifier !== 'string') {
            return null;
        }
        const normalized = sanitiseName(identifier);
        const record = this.aliases.get(normalized) || null;
        this.debugLogger?.log('SkillRegistry:get', {
            identifier,
            normalized,
            resolved: record?.name || null,
        });
        return record;
    }

    /**
     * List skills filtered by type.
     * @param {string} type - The skill type to filter by
     * @returns {Object[]} Array of skill records matching the type
     */
    listByType(type) {
        return Array.from(this.catalog.values()).filter((record) => record.type === type);
    }

    /**
     * Get all registered skills.
     * @returns {Object[]} Array of all skill records
     */
    getAll() {
        return Array.from(this.catalog.values());
    }

    /**
     * Get the subsystem type for a skill.
     * @param {string} identifier - Skill name or alias
     * @returns {string|undefined} The subsystem type, or undefined if not found
     */
    getSubsystemType(identifier) {
        const normalized = sanitiseName(identifier);
        return this.skillToSubsystem.get(normalized);
    }

    /**
     * Get user skills (excluding those from built-in roots).
     * @param {string|null} builtInRoot - The built-in skills root path to exclude
     * @returns {Object[]} Array of user skill records
     */
    getUserSkills(builtInRoot) {
        if (!builtInRoot) {
            return this.getAll();
        }
        return this.getAll().filter((s) => !s.skillDir?.startsWith(builtInRoot));
    }

    /**
     * Check if a skill is a built-in skill.
     * @param {Object} skillRecord - The skill record to check
     * @param {string|null} builtInRoot - The built-in skills root path
     * @returns {boolean} True if the skill is built-in
     */
    isBuiltIn(skillRecord, builtInRoot) {
        if (!builtInRoot) return false;
        return skillRecord?.skillDir?.startsWith(builtInRoot) ?? false;
    }

    /**
     * Get the number of registered skills.
     * @returns {number} Count of skills in the catalog
     */
    get size() {
        return this.catalog.size;
    }

    /**
     * Clear all registered skills.
     */
    clear() {
        this.catalog.clear();
        this.aliases.clear();
        this.skillToSubsystem.clear();
    }

    /**
     * Check if a skill exists by name or alias.
     * @param {string} identifier - Skill name or alias
     * @returns {boolean} True if the skill exists
     */
    has(identifier) {
        if (!identifier || typeof identifier !== 'string') {
            return false;
        }
        const normalized = sanitiseName(identifier);
        return this.aliases.has(normalized);
    }
}
