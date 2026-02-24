import { addEvent, listEvents } from './store.mjs';
import { validateEvent } from './validator.mjs';
import { formatEvent } from './formatter.mjs';

export function createEvent(event) {
    const validated = validateEvent(event);
    addEvent(validated);
    return formatEvent(validated);
}

export function listFormattedEvents() {
    return listEvents().map(formatEvent);
}
