import {
    createSuccessValue,
    createFailValue,
    createRootCanceledValue,
} from './valueHelpers.mjs';
import { cancelEuristic } from './cancelHeuristic.mjs';
import { normalizeCancelReason } from './valueHelpers.mjs';

export function createCommandResponder(variableName, options = {}) {
    const {
        commandName = null,
        autoCancel = false,
        heuristic = cancelEuristic,
    } = options;
    let lastValue = null;
    const wrapCancel = (reason, origin = 'command', info = null) => {
        const value = createRootCanceledValue(variableName, reason, origin, {
            command: commandName,
            heuristic: info,
            source: origin,
        });
        return value;
    };
    const applyAutoCancel = (data) => {
        if (!autoCancel || typeof heuristic !== 'function') {
            return null;
        }
        const info = heuristic(data);
        if (!info) {
            return null;
        }
        const reason = normalizeCancelReasonForAuto(info.reason ?? data);
        const value = wrapCancel(reason, 'heuristic', info);
        value.autoCanceled = true;
        value.autoCancelInfo = info;
        return value;
    };

    const api = {
        success(data = '') {
            const auto = applyAutoCancel(data);
            if (auto) {
                lastValue = auto;
                return lastValue;
            }
            lastValue = createSuccessValue(data, 'command');
            return lastValue;
        },
        fail(reason = '') {
            lastValue = createFailValue(reason, 'command');
            return lastValue;
        },
        cancel(reason = '') {
            lastValue = wrapCancel(reason, 'command');
            lastValue.manualCancel = true;
            return lastValue;
        },
    };

    return {
        api,
        getLastValue: () => lastValue,
    };
}

function normalizeCancelReasonForAuto(reason) {
    const normalised = normalizeCancelReason(reason);
    const stripped = normalised.replace(/^cancel(?:led|ed|ation)?[:\s-]*/i, '').trim();
    return stripped || normalised || 'auto-cancelled';
}
