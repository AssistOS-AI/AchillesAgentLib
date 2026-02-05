/**
 * Environment setup helper for tests.
 * Loads environment variables from .env files before running tests.
 */

import { envAutoConfig } from '../LLMAgents/envAutoConfig.mjs';

// Run env auto-config synchronously on import
const result = envAutoConfig();

if (result.loaded) {
    // console.log(`[AchillesAgentsLib] Environment auto-config applied ${Object.keys(result.variables).length} key(s).`);
}

export { result };
