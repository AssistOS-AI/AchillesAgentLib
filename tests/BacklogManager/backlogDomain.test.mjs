import assert from 'assert';
import { ChangeQueue } from '../../BacklogManager/backlogDomain.mjs';

console.log('Testing ChangeQueue...');
const queue = new ChangeQueue();
queue.enqueue('ref1', 'change1');
queue.enqueue('ref2', 'change2');
const changes = queue.drain();
assert.deepEqual(changes, [
  { taskRef: 'ref1', change: 'change1' },
  { taskRef: 'ref2', change: 'change2' }
]);
assert.deepEqual(queue.drain(), []);
console.log('ChangeQueue tests passed.');

console.log('All backlogDomain tests passed!');
