/**
 * Skill file type definitions mapping file extensions to skill types.
 * Each entry maps a skill descriptor filename to its corresponding subsystem type.
 */
export const SKILL_FILE_TYPES = {
    'SKILL.md': { type: 'claude' },
    'dcgskill.md': { type: 'dynamic-code-generation' },
    'cskill.md': { type: 'cskill' },
    'mskill.md': { type: 'mcp' },
    'oskill.md': { type: 'orchestrator' },
    'tskill.md': { type: 'dbtable' },
};

/**
 * List of valid skill definition filenames.
 * Used for scanning directories to discover skills.
 */
export const SKILL_FILE_NAMES = Object.keys(SKILL_FILE_TYPES);
