export const action = (input) => {
    const text = typeof input === 'string' ? input.trim() : '';
    if (!text) {
        return '- Milestone: No content provided.\n- Milestone: Awaiting details.';
    }
    return [
        `- Milestone: Kick-off — derived from "${text.slice(0, 30)}"`,
        '- Milestone: Delivery — prepare final hand-off.',
    ].join('\n');
};
