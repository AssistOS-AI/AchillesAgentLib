import fs from 'node:fs';
import path from 'node:path';

import { isDirectory, isReadableFile } from '../utils/fileUtils.mjs';
import { SKILL_FILE_TYPES } from '../constants/skillFileTypes.mjs';
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
 * Service for discovering skill definitions in the filesystem.
 * Scans directories for skills folders and parses skill files.
 */
export class SkillDiscoveryService {
    /**
     * Create a new SkillDiscoveryService.
     * @param {Object} options - Service options
     * @param {Object} [options.logger] - Logger instance (defaults to console)
     * @param {Object} [options.debugLogger] - Debug logger instance
     * @param {boolean} [options.searchUpwards=true] - Search upwards through parent directories
     */
    constructor({ logger = console, debugLogger = null, searchUpwards = true } = {}) {
        this.logger = logger;
        this.debugLogger = debugLogger;
        this.searchUpwards = searchUpwards;
    }

    /**
     * Find all skills root directories from the given start directories.
     * @param {string[]} startDirs - Directories to start searching from
     * @param {string[]} [additionalRoots=[]] - Additional root directories to include
     * @returns {string[]} Array of discovered skills directories
     */
    findRoots(startDirs = [], additionalRoots = []) {
        const roots = [];
        const discovered = new Set();
        const directionLabel = this.searchUpwards ? 'up' : 'down';

        const registerCandidate = (candidate, source = null) => {
            if (!candidate || discovered.has(candidate)) {
                return;
            }
            discovered.add(candidate);
            this.debugLogger?.log('SkillDiscoveryService:discoveredRoot', {
                candidate,
                direction: directionLabel,
                source,
            });
            roots.push(candidate);
        };

        if (!this.searchUpwards) {
            this._collectDownward(startDirs, registerCandidate);
        } else {
            this._collectUpward(startDirs, registerCandidate);
        }

        // Add additional roots
        for (const root of additionalRoots) {
            if (isDirectory(root)) {
                registerCandidate(root, 'additional');
            }
        }

        return roots;
    }

    /**
     * Collect skill roots by searching upward through parent directories.
     * @private
     */
    _collectUpward(startDirs, registerCandidate) {
        const visitedAscending = new Set();

        const collectAscending = (startDir) => {
            if (!startDir) {
                return;
            }
            let current = path.resolve(startDir);
            const { root } = path.parse(current);

            while (!visitedAscending.has(current)) {
                visitedAscending.add(current);
                const candidate = path.join(current, 'skills');
                if (isDirectory(candidate)) {
                    registerCandidate(candidate, 'ascend');
                }
                if (current === root) {
                    break;
                }
                current = path.dirname(current);
            }
        };

        startDirs.forEach((dir) => collectAscending(dir));
    }

    /**
     * Collect skill roots by searching downward, starting from a "repos" directory.
     * @private
     */
    _collectDownward(startDirs, registerCandidate) {
        let reposRoot = null;
        for (const dir of startDirs) {
            reposRoot = this._findReposRoot(dir);
            if (reposRoot) {
                break;
            }
        }

        if (!reposRoot) {
            this.debugLogger?.log('[SkillDiscoveryService] No "repos" directory found during downward discovery.');
            return;
        }

        this.debugLogger?.log('SkillDiscoveryService:reposRoot', { reposRoot });
        this._collectSkillsDescending(reposRoot, registerCandidate);
    }

    /**
     * Find a "repos" directory by searching downward.
     * @private
     */
    _findReposRoot(startDir) {
        if (!startDir) {
            return null;
        }
        const queue = [path.resolve(startDir)];
        const visited = new Set();

        for (let index = 0; index < queue.length; index += 1) {
            const current = queue[index];
            if (visited.has(current)) {
                continue;
            }
            visited.add(current);

            const baseName = path.basename(current).toLowerCase();
            if (baseName === 'repos') {
                return current;
            }

            let entries = [];
            try {
                entries = fs.readdirSync(current, { withFileTypes: true });
            } catch (error) {
                this.logger?.warn?.(`[SkillDiscoveryService] Failed to inspect directory ${current}: ${error.message}`);
                continue;
            }

            for (const entry of entries) {
                if (!entry.isDirectory()) {
                    continue;
                }
                if (entry.name === '.' || entry.name === '..') {
                    continue;
                }
                if (entry.name === 'node_modules') {
                    continue;
                }
                if (typeof entry.isSymbolicLink === 'function' && entry.isSymbolicLink()) {
                    continue;
                }
                const nextPath = path.join(current, entry.name);
                queue.push(nextPath);
            }
        }
        return null;
    }

    /**
     * Collect skills directories by searching downward from a root.
     * @private
     */
    _collectSkillsDescending(startDir, registerCandidate) {
        if (!startDir) {
            return;
        }
        const queue = [path.resolve(startDir)];
        const visited = new Set();

        for (let index = 0; index < queue.length; index += 1) {
            const current = queue[index];
            if (visited.has(current)) {
                continue;
            }
            visited.add(current);

            const candidate = path.join(current, 'skills');
            if (isDirectory(candidate)) {
                registerCandidate(candidate, startDir);
            }

            let entries = [];
            try {
                entries = fs.readdirSync(current, { withFileTypes: true });
            } catch (error) {
                this.logger?.warn?.(`[SkillDiscoveryService] Failed to inspect directory ${current}: ${error.message}`);
                continue;
            }

            for (const entry of entries) {
                if (!entry.isDirectory()) {
                    continue;
                }
                if (entry.name === '.' || entry.name === '..') {
                    continue;
                }
                if (entry.name === 'node_modules') {
                    continue;
                }
                if (typeof entry.isSymbolicLink === 'function' && entry.isSymbolicLink()) {
                    continue;
                }
                const nextPath = path.join(current, entry.name);
                if (!visited.has(nextPath)) {
                    queue.push(nextPath);
                }
            }
        }
    }

    /**
     * Discover skills from a root directory.
     * Scans immediate subdirectories for skill definition files.
     * @param {string} rootDir - The skills root directory
     * @returns {Object[]} Array of discovered skill records
     */
    discoverFromRoot(rootDir) {
        const skills = [];
        let entries = [];
        try {
            entries = fs.readdirSync(rootDir, { withFileTypes: true });
        } catch (error) {
            this.logger?.warn?.(`[SkillDiscoveryService] Failed to read skills directory ${rootDir}: ${error.message}`);
            return skills;
        }

        for (const entry of entries) {
            if (!entry.isDirectory()) {
                continue;
            }
            const skillDir = path.join(rootDir, entry.name);
            const discovered = this.discoverFromDirectory(skillDir);
            skills.push(...discovered);
        }

        return skills;
    }

    /**
     * Discover skill(s) from a specific directory.
     * Checks for skill definition files, or recurses into subdirectories.
     * @param {string} skillDir - The directory to scan
     * @returns {Object[]} Array of discovered skill records
     */
    discoverFromDirectory(skillDir) {
        const skills = [];
        let descriptorFound = false;

        for (const [filename, descriptor] of Object.entries(SKILL_FILE_TYPES)) {
            const filePath = path.join(skillDir, filename);
            if (!isReadableFile(filePath)) {
                continue;
            }

            descriptorFound = true;
            const skillRecord = this._createSkillRecord({ filePath, type: descriptor.type, skillDir });
            if (skillRecord) {
                skills.push(skillRecord);
            }
        }

        if (descriptorFound) {
            return skills;
        }

        // No descriptor found, recurse into subdirectories
        let entries = [];
        try {
            entries = fs.readdirSync(skillDir, { withFileTypes: true });
        } catch (error) {
            this.logger?.warn?.(`[SkillDiscoveryService] Failed to inspect nested skill folder ${skillDir}: ${error.message}`);
            return skills;
        }

        for (const entry of entries) {
            if (!entry.isDirectory()) {
                continue;
            }
            const nestedDir = path.join(skillDir, entry.name);
            const nested = this.discoverFromDirectory(nestedDir);
            skills.push(...nested);
        }

        return skills;
    }

    /**
     * Create a skill record from a skill file.
     * @private
     * @param {Object} options
     * @param {string} options.filePath - Path to the skill file
     * @param {string} options.type - Skill type
     * @param {string} options.skillDir - Skill directory
     * @returns {Object} The skill record
     */
    _createSkillRecord({ filePath, type, skillDir }) {
        const shortName = path.basename(skillDir);
        const baseName = sanitiseName(shortName);
        const canonicalName = sanitiseName(`${baseName}-${type}`) || sanitiseName(`${shortName}-${type}`);

        return {
            name: canonicalName,
            type,
            descriptor: null,
            filePath,
            skillDir,
            shortName,
            preparedConfig: null,
        };
    }
}
