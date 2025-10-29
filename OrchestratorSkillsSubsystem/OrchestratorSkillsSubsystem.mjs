import { SimpleSkillsSubsystem } from '../SimpleSkillsSubsystem/SimpleSkillsSubsystem.mjs';

export class OrchestratorSkillsSubsystem extends SimpleSkillsSubsystem {
    constructor(options = {}) {
        super({ ...options, type: 'orchestrator' });
    }
}
