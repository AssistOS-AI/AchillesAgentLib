# Event Emitter Task Queue

Manages a queue of tasks with event-based processing.

## Summary
This skill implements a task queue system that processes tasks sequentially or in parallel with configurable concurrency. It supports enqueuing tasks, starting/stopping the queue, and provides event-based notifications. All operations are exposed through a single, dynamic entry point.

## Input Format
The skill is invoked via an `action` function that accepts a single object specifying the operation to be performed.

- **args** (Object): The container for the command.
  - `operation` (string, mandatory): The operation to perform. Can be `enqueue`, `start`, `stop`, or `getStatus`.
  - `task` (object, mandatory for enqueue): The task to enqueue.
  - `concurrency` (number, optional for start): Number of concurrent workers.

## Output Format
- **Type**: `object`
- **Description**: The output depends on the operation invoked.
- **Success Examples**:
  - **enqueue**: Returns `{ success: true, taskId: string, queueSize: number }`.
  - **start**: Returns `{ success: true, status: 'running' }`.
  - **stop**: Returns `{ success: true, status: 'stopped' }`.
  - **getStatus**: Returns `{ status: string, queueSize: number, activeTasks: number }`.
- **Error Example**: An error is thrown if required parameters are missing.

## Constraints
- Tasks must have a unique ID.
- Concurrency must be a positive integer.
- Task functions must be async or return promises.
