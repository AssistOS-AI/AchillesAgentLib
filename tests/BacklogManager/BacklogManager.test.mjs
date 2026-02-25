import assert from 'assert';
import { getTask, getApprovedTasks, getNewTasks, updateTask, addTask, loadBacklog, markDone, addOptionsFromText, approveTask } from '../../BacklogManager/BacklogManager.mjs';
import { flush } from '../../BacklogManager/BacklogManager.mjs';

console.log('Setting up BacklogManager tests...');

(async () => {
  const testFilePath = 'specs.backlog';
  const historyFilePath = 'specs.history';
  const testContent = JSON.stringify({
    tasks: [
      {
        description: 'Test',
        options: ['First option'],
        resolution: ''
      }
    ]
  }, null, 2);

  try {
    const fs = await import('fs/promises');
    await fs.writeFile(testFilePath, `${testContent}\n`);
    await fs.writeFile(historyFilePath, '[]\n');
    console.log('Test backlog file created.');

    await loadBacklog('specs');

    console.log('Testing getTask...');
    const section = await getTask('specs', 1);
    assert(section && section.description === 'Test');
    console.log('getTask tests passed.');

    console.log('Testing addOptionsFromText...');
    const optionsText = `1. First option\n2. Second option\n- Third option`;
    const updatedFromText = await addOptionsFromText('specs', 1, optionsText);
    assert(updatedFromText.options.length >= 2);
    assert(updatedFromText.options[updatedFromText.options.length - 2] === 'First option');
    assert(updatedFromText.options[updatedFromText.options.length - 1] === 'Second option\n- Third option');
    console.log('addOptionsFromText tests passed.');

    console.log('Testing approveOption...');
    const updatedRes = await approveTask('specs', 1, 'First option');
    assert(updatedRes.resolution === 'First option');
    assert(updatedRes.options.length === 0);
    console.log('approveOption tests passed.');

    console.log('Testing getApprovedTasks...');
    const approvedTasks = await getApprovedTasks('specs');
    assert(approvedTasks.some((task) => task.description === 'Test' && task.index === 1));
    console.log('getApprovedTasks tests passed.');

    console.log('Testing getNewTasks...');
    const newTasks = await getNewTasks('specs');
    assert(newTasks.length === 1);
    assert(newTasks.some((task) => task.description === 'Test' && task.index === 1));
    console.log('getNewTasks tests passed.');

    console.log('Testing markDone...');
    await updateTask('specs', 1, { resolution: 'First option' });
    await markDone('specs', 1);
    const removedTask = await getTask('specs', 1);
    assert(removedTask === null);
    const afterDone = await loadBacklog('specs');
    assert(afterDone.history.length === 1);
    console.log('markDone tests passed.');

    console.log('Testing addTask...');
    const addedTaskId = await addTask('specs', 'Second task');
    const afterAppend = await loadBacklog('specs');
    const appendedTask = afterAppend.tasks.find((task) => task.description === 'Second task');
    assert(appendedTask);
    assert.strictEqual(addedTaskId, afterAppend.tasks.length);
    console.log('addTask tests passed.');

    console.log('Testing updateTask...');
    const appendedIndex = afterAppend.tasks.findIndex((task) => task.description === 'Second task');
    await updateTask('specs', appendedIndex + 1, { description: 'Updated' });
    const updatedTask = await getTask('specs', appendedIndex + 1);
    assert(updatedTask.description === 'Updated');
    console.log('updateTask tests passed.');

    console.log('Testing markDone for updated task...');
    await updateTask('specs', appendedIndex + 1, { resolution: 'Executed' });
    await markDone('specs', appendedIndex + 1);
    const afterMarkDone = await loadBacklog('specs');
    assert(afterMarkDone.history.length === 2);
    assert(afterMarkDone.history[1].resolution === 'Executed');
    console.log('markDone for updated task tests passed.');

    console.log('All BacklogManager tests passed!');
  } catch (e) {
    console.error('Test failed:', e);
  } finally {
    try {
      const fs = await import('fs/promises');
      await flush(testFilePath);
      await fs.unlink(testFilePath);
      await fs.unlink(historyFilePath);
      console.log('Test backlog file deleted.');
    } catch (cleanupError) {
      console.error('Failed to delete test file:', cleanupError);
    }
  }
})();
