export class CloudeSkillsSubsystem {
    constructor() {
        this.type = 'claude';
    }

    prepareSkill(skillRecord) {
        const { descriptor } = skillRecord;
        skillRecord.metadata = {
            type: this.type,
            title: descriptor?.title || null,
            summary: descriptor?.summary || null,
            body: descriptor?.body || null,
            sections: descriptor?.sections || {},
        };
    }

    async executeSkillPrompt({ skillRecord }) {
        const { metadata } = skillRecord;
        return {
            skill: skillRecord.name,
            metadata,
            result: {
                summary: metadata?.summary || metadata?.title || `Skill ${skillRecord.name}`,
                details: metadata?.body || '',
                type: this.type,
            },
            sessionMemory: null,
        };
    }
}
