import { SimpleSkillsSubsystem } from '../SimpleSkillsSubsystem/SimpleSkillsSubsystem.mjs';

export class CloudeSkillsSubsystem extends SimpleSkillsSubsystem {
    constructor(options = {}) {
        super({ ...options, type: 'claude' });
    }
}
