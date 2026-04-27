export class SecuritySupervisor {
    constructor({ logger = console } = {}) {
        this.logger = logger;
    }

    async approve(toolChoice) {
        return 'approve';
    }

    getOutputWriter() {
        return { write: async (message) => {} };
    }
}
