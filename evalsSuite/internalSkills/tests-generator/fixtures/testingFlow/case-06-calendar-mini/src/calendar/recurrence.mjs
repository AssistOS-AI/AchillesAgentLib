export function expandRecurrence(event, count) {
    const items = [];
    for (let i = 0; i < count; i += 1) {
        items.push({
            ...event,
            id: `${event.id}-${i + 1}`,
        });
    }
    return items;
}
