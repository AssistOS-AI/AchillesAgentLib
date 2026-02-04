import assert from 'assert';
import { loadBacklogFile, saveBacklogFile, getHistoryPath, forceSave } from '../../BacklogManager/backlogIO.mjs';
import { writeFile, unlink } from 'fs/promises';

const testPath = 'io_test.backlog';
const historyPath = getHistoryPath(testPath);

console.log('Testing loadBacklogFile...');
await writeFile(testPath, `${JSON.stringify({
  tasks: [
    { description: 'Vision document', options: [], resolution: 'Approved' },
    { description: 'Backlog manager', options: ['Fix one'], resolution: '' }
  ]
}, null, 2)}\n`);
await writeFile(historyPath, `${JSON.stringify([
  { description: 'Old task', options: [], resolution: 'Done' }
], null, 2)}\n`);

const { tasks, history } = await loadBacklogFile(testPath);
assert.deepEqual(tasks[0], {
  description: 'Vision document',
  options: [],
  resolution: 'Approved'
});
assert.deepEqual(tasks[1], {
  description: 'Backlog manager',
  options: ['Fix one'],
  resolution: ''
});
assert.deepEqual(history[0], {
  description: 'Old task',
  options: [],
  resolution: 'Done'
});
console.log('loadBacklogFile tests passed.');

console.log('Testing saveBacklogFile...');
await saveBacklogFile(testPath, {
  tasks: [{ description: 'Updated', options: ['Option'], resolution: '' }],
  history: [{ description: 'Done task', options: [], resolution: 'Done' }]
});
await forceSave(testPath);
const afterSave = await loadBacklogFile(testPath);
assert.deepEqual(afterSave.tasks, [{ description: 'Updated', options: ['Option'], resolution: '' }]);
assert.deepEqual(afterSave.history, [{ description: 'Done task', options: [], resolution: 'Done' }]);
console.log('saveBacklogFile tests passed.');

console.log('All backlogIO tests passed!');

await unlink(testPath);
await unlink(historyPath);
