/**
 * RecursiveSkilledAgents module exports.
 *
 * Primary export is RecursiveSkilledAgent for backward compatibility.
 * Individual services are also exported for advanced use cases.
 */

// Main facade class
export { RecursiveSkilledAgent, SKILL_FILE_TYPES, SKILL_FILE_NAMES } from './RecursiveSkilledAgent.mjs';

// Constants
export { SKILL_FILE_TYPES as SkillFileTypes, SKILL_FILE_NAMES as SkillFileNames } from './constants/skillFileTypes.mjs';

// Utilities
export { isReadableFile, isDirectory } from './utils/fileUtils.mjs';
export { createSectionKey, parseSkillDocument } from './utils/skillDocumentParser.mjs';

// Services
export { SubsystemFactory } from './services/SubsystemFactory.mjs';
export { SkillRegistry } from './services/SkillRegistry.mjs';
export { SkillDiscoveryService } from './services/SkillDiscoveryService.mjs';
export { SkillSelector } from './services/SkillSelector.mjs';
export { SkillExecutor } from './services/SkillExecutor.mjs';

// Default export for convenience
export { RecursiveSkilledAgent as default } from './RecursiveSkilledAgent.mjs';
