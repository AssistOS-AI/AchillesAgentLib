# Specification for BulkOperations.js

## Module Description
This module provides functions for performing operations across multiple files, such as batch renaming and searching for content. These functions are designed to be robust and handle directory traversal and file stream processing.

## Dependencies
-   `node:fs/promises`: For reading directories and renaming files.
-   `node:fs`: For creating read streams to efficiently search large files.
-   `node:path`: For joining paths.
-   `node:readline`: For reading files line-by-line during search operations.

---

## Function: renameAllInFolder(directoryPath, renameMapping)

### Description
Renames a list of files within a specified directory in a single batch operation.

### Input
-   `directoryPath` (string): The absolute path to the directory containing the files.
-   `renameMapping` (Array<Object>): An array of objects, where each object must have `oldName` and `newName` string properties.

### Process
1.  Iterates through the `renameMapping` array.
2.  For each item in the array:
    a. Constructs the full source path by joining `directoryPath` and `item.oldName`.
    b. Constructs the full destination path by joining `directoryPath` and `item.newName`.
    c. Calls `fs.rename(source, destination)`.
3.  All rename operations are wrapped in `Promise.all` so they can run in parallel and the function will resolve only when all of them are complete.

### Output
-   (Promise<void>): A promise that resolves when all rename operations are finished.

---

## Function: findStringInFiles(directoryPath, query)

### Description
Recursively searches for a given string in all files within a directory and returns the locations of all matches.

### Input
-   `directoryPath` (string): The path to the directory to search.
-   `query` (string): The string to search for.

### Process
1.  Initializes an empty array, `matches`, to store results.
2.  Uses `fs.readdir(directoryPath, { withFileTypes: true })` to list all entries in the directory.
3.  Iterates through each directory entry:
    a. If it's a directory, it makes a recursive call to itself with the new path.
    b. If it's a file, it proceeds to search the file.
4.  **File Search Logic**:
    a. Creates a `readline` interface for the file to read it line-by-line, which is memory-efficient for large files.
    b. For each line, it checks if `line.includes(query)`.
    c. If a match is found, it pushes an object to the `matches` array: `{ filePath: <path>, line: <line_number>, content: <line_content> }`.
5.  After iterating through all entries, it returns the `matches` array.

### Output
-   (Promise<Array<Object>>): A promise that resolves to an array of match objects.
