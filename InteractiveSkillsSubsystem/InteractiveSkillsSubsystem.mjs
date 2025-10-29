import { SimpleSkillsSubsystem } from '../SimpleSkillsSubsystem/SimpleSkillsSubsystem.mjs';

export class InteractiveSkillsSubsystem extends SimpleSkillsSubsystem {
    constructor(options = {}) {
        super({ ...options, type: 'interactive' });
    }
}
