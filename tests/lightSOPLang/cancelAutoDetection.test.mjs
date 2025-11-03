import test from 'node:test';
import assert from 'node:assert/strict';

import LightSOPLangInterpreter, {
    DefaultExecutionMonitor,
    cancelEuristic,
} from '../../lightSOPLang/index.mjs';
import { createRegistry } from './helpers.mjs';

test('Auto cancel is disabled by default and respects enableAutoCancel', async () => {
    const history = [];
    const registry = createRegistry(async (input, response) => {
        history.push(input);
        if (input.startsWith('produce')) {
            return response.success('Canceled: maintenance window');
        }
        throw new Error(`Unexpected command ${input}`);
    }, [{ name: 'produce', description: 'Produce a string' }]);

    const code = '@result produce value';
    const interpreter = new LightSOPLangInterpreter(code, registry);
    await interpreter.ready;

    assert.equal(interpreter.getVarValue('result'), 'Canceled: maintenance window');

    interpreter.enableAutoCancel(true);
    interpreter.updateCode('@result produce value2');
    await interpreter.ready;

    assert.equal(
        interpreter.getVarValue('result'),
        'canceled:command produce canceled (Canceled: maintenance window)',
    );
});

test('Auto cancel heuristic converts structured responses to cancel', async () => {
    let mode = 0;
    const registry = createRegistry(async (input, response) => {
        if (input.startsWith('task')) {
            if (mode === 0) {
                mode = 1;
                return response.success({ status: 'cancel', reason: 'quota exceeded' });
            }
            return response.success('done');
        }
        return response.success('noop');
    }, [
        { name: 'task', description: 'Perform task' },
    ]);

    const monitor = new DefaultExecutionMonitor({ failureLimit: 50 });
    const code = '@job task start';
    const interpreter = new LightSOPLangInterpreter(code, registry, { executionMonitor: monitor });
    interpreter.enableAutoCancel(true);

    await interpreter.ready;
    assert.equal(
        interpreter.getVarValue('job'),
        'canceled:command task canceled (quota exceeded)',
    );

    interpreter.updateCode(code);
    await interpreter.ready;
    assert.equal(interpreter.getVarValue('job'), 'done');
});

test('cancelEuristic detects multiple cancel formats', () => {
    const stringResult = cancelEuristic('Cancel: maintenance window');
    assert.equal(stringResult.reason, 'maintenance window');

    const objectResult = cancelEuristic({ status: 'cancelled', reason: 'quota exceeded' });
    assert.equal(objectResult.reason, 'quota exceeded');

    const noMatch = cancelEuristic('all good');
    assert.equal(noMatch, null);
});
