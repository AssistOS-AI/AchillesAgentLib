export function buildReminder(event, minutesBefore) {
    return {
        id: `${event.id}-reminder`,
        minutesBefore,
        title: `Reminder: ${event.title}`,
    };
}
