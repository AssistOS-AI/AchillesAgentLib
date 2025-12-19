# Specification for index.mjs - Event Emitter Task Queue

## Module Description
This module implements a task queue system with event-based processing capabilities. It supports enqueuing tasks, processing them with configurable concurrency, and managing queue state. The main export is an `action` function that provides access to the queue functionality.

## Dependencies
None (pure JavaScript implementation).

---

## Class: EventQueue

### Description
The `EventQueue` class implements the core task queue functionality with configurable concurrency. It manages a queue of tasks, processes them sequentially or in parallel, and provides status information.

### Constructor
- Initializes an empty queue array.
- Sets active task counter to 0.
- Sets initial running state to false.
- Sets default concurrency to 1 (sequential processing).

### Properties
- `queue`: Array storing pending tasks.
- `activeTasks`: Counter for currently executing tasks.
- `isRunning`: Boolean indicating if queue is processing.
- `concurrency`: Maximum number of concurrent tasks.

### Methods

#### enqueue(task)
- **Description**: Adds a task to the queue.
- **Input**: `task` (object) - Task object with id and function.
- **Output**: `{ success: true, taskId: string, queueSize: number }` - Enqueue confirmation.
- **Process**:
  1. Validates that task has an id.
  2. Adds task to the queue.
  3. Returns confirmation with task id and new queue size.

#### start(concurrency)
- **Description**: Starts processing tasks from the queue.
- **Input**: `concurrency` (number, optional) - Number of concurrent workers (default: 1).
- **Output**: `{ success: true, status: 'running' }` - Start confirmation.
- **Process**:
  1. Sets concurrency level.
  2. Sets running state to true.
  3. Processes tasks while queue has items and running state is true.
  4. For each task: executes function, handles errors, updates active task count.

#### stop()
- **Description**: Stops the queue processing.
- **Output**: `{ success: true, status: 'stopped' }` - Stop confirmation.
- **Process**:
  1. Sets running state to false.
  2. Returns confirmation.

#### getStatus()
- **Description**: Returns current queue status.
- **Output**: `{ status: string, queueSize: number, activeTasks: number }` - Queue status.
- **Process**:
  1. Returns current running status, queue size, and active task count.

---

## Function: action(args)

### Description
The main exported function and the designated entry point for execution. It acts as a dispatcher for the event queue functionality.

### Input
- `args` (Object):
  - `operation` (string): The operation to perform. Can be `enqueue`, `start`, `stop`, or `getStatus`.
  - `task` (object, optional): Task object for enqueue operation.
  - `concurrency` (number, optional): Concurrency level for start operation.

### Processing Logic
1. Destructures `operation`, `task`, and `concurrency` from the `args` object.
2. Validates that operation parameter is present.
3. **For `enqueue` operation**: Validates task is provided, then calls the `enqueue` method.
4. **For `start` operation**: Calls the `start` method with optional concurrency.
5. **For `stop` operation**: Calls the `stop` method.
6. **For `getStatus` operation**: Calls the `getStatus` method.
7. **For unknown operations**: Throws an error indicating the operation is not supported.

### Output
- **enqueue**: `{ success: true, taskId: string, queueSize: number }` - Enqueue confirmation.
- **start**: `{ success: true, status: 'running' }` - Start confirmation.
- **stop**: `{ success: true, status: 'stopped' }` - Stop confirmation.
- **getStatus**: `{ status: string, queueSize: number, activeTasks: number }` - Queue status.

---

## Module Usage

This module exports an `action` function that can be imported and called directly by the CodeSkillsSubsystem.

### Direct Import Usage
```javascript
import { action } from './index.mjs';

// Create a test task
const testTask = {
  id: 'task1',
  function: async (data) => {
    console.log('Processing:', data);
    return `Processed: ${data}`;
  },
  args: ['test_data']
};

// Enqueue the task
const enqueueResult = await action({
  operation: 'enqueue',
  task: testTask
});

console.log('Enqueue result:', enqueueResult);

// Start the queue
const startResult = await action({
  operation: 'start',
  concurrency: 2
});

console.log('Start result:', startResult);

// Get queue status
const statusResult = await action({
  operation: 'getStatus'
});

console.log('Status:', statusResult);
```

### Integration with CodeSkillsSubsystem
The CodeSkillsSubsystem will dynamically import this module and call the `action` function directly, eliminating the need for child process communication and improving performance and reliability.
