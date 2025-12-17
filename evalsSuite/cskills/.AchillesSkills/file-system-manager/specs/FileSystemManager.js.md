# Specification for FileSystemManager.js

## Module Description
This module provides the `FileSystemManager` class, the central orchestrator for all file system operations. It combines functionality from more granular modules (`FileOperations`, `BulkOperations`) and provides higher-level methods like moving paths. It is designed to work with asynchronous, promise-based file system APIs.

## Dependencies
-   `node:fs/promises`: For core file system operations like `rename` and `rm`.
-   `node:path`: For path manipulation.
-   `./FileOperations.mjs`: Imports `readFile`, `createFile`.
-   `./BulkOperations.mjs`: Imports `renameAllInFolder`, `findStringInFiles`.

---

## Class: FileSystemManager

### `constructor()`
-   **Description**: Initializes the manager. This is a simple constructor that may be extended later to support configuration (e.g., workspace root, permissions).

### `readFile(filePath)`
-   **Description**: Reads the content of a file. This is a direct pass-through to the `readFile` function in `FileOperations`.
-   **Input**: `filePath` (string).
-   **Output**: (Promise<string>): A promise that resolves with the file content.

### `createFile(filePath, content)`
-   **Description**: Creates a new file with the given content. This is a direct pass-through to the `createFile` function in `FileOperations`.
-   **Input**: `filePath` (string), `content` (string).
-   **Output**: (Promise<void>): A promise that resolves when the file is created.

### `deletePath(path)`
-   **Description**: Deletes a file or an entire directory recursively.
-   **Input**: `path` (string).
-   **Process**:
    1.  Uses `fs.rm(path, { recursive: true, force: true })`. The `force` option prevents an error if the path doesn't exist, and `recursive` allows deletion of non-empty directories.
-   **Output**: (Promise<void>).

### `movePath(sourcePath, destinationPath)`
-   **Description**: Moves a file or directory from a source to a destination.
-   **Input**: `sourcePath` (string), `destinationPath` (string).
-   **Process**:
    1.  Uses `fs.rename(sourcePath, destinationPath)` to perform the move. This is atomic on most file systems.
-   **Output**: (Promise<void>).

### `renameAllInFolder(directoryPath, renameMapping)`
-   **Description**: Renames multiple files within a single directory. This is a direct pass-through to the `renameAllInFolder` function in `BulkOperations`.
-   **Input**: `directoryPath` (string), `renameMapping` (Array<Object>): An array where each object is `{ oldName: string, newName: string }`.
-   **Output**: (Promise<void>).

### `findStringInFiles(directoryPath, query)`
-   **Description**: Searches for a string within all files in a directory. This is a direct pass-through to the `findStringInFiles` function in `BulkOperations`.
-   **Input**: `directoryPath` (string), `query` (string).
-   **Output**: (Promise<Array<Object>>): A promise resolving to an array of match objects.
