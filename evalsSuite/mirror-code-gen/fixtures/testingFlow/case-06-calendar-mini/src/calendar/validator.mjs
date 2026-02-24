import { buildEvent } from './event.mjs';

export function validateEvent(event) {
    if (!event.id || !event.title) {
        throw new Error('Missing required event fields');
    }
    return buildEvent({
        id: String(event.id),
        title: String(event.title),
        date: String(event.date || ''),
        durationMinutes: Number(event.durationMinutes || 0),
    });
}
