import { SimpleSkillsSubsystem } from '../SimpleSkillsSubsystem/SimpleSkillsSubsystem.mjs';

export class MCPSkillsSubsystem extends SimpleSkillsSubsystem {
    constructor(options = {}) {
        super({ ...options, type: 'mcp' });
    }
}
