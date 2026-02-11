export function getInternalCommands() {
    return {
        assign: async (payload, responder) => {
            const args = Array.isArray(payload?.args) ? payload.args : [];
            const text = args.map((arg) => String(arg ?? '')).join(' ');
            return responder.success(text);
        },
    };
}

export function getInternalCommandNames() {
    return ['assign'];
}
