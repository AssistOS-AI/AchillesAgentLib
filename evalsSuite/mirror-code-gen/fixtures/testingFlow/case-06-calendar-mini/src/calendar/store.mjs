const events = [];

export function addEvent(event) {
    events.push({ ...event });
}

export function listEvents() {
    return [...events];
}

export function clearEvents() {
    events.length = 0;
}
