# Specification for FileOperations.js

## Module Description
This module provides low-level, promise-based utility functions for basic file operations. It directly wraps functions from Node.js's `fs/promises` module to provide a consistent, asynchronous API for reading, creating, and deleting individual files.

## Dependencies
-   `node:fs/promises`: For all core file system functionality.
-   `node:path`: For extracting the directory name from a file path.

---

## Function: readFile(filePath)

### Description
Asynchronously reads the entire content of a file.

### Input
-   `filePath` (string): The path to the file to read.

### Process
1.  Calls `fs.readFile(filePath, 'utf-8')`.
2.  If the file does not exist or cannot be read, the promise will reject with an error.

### Output
-   (Promise<string>): A promise that resolves to a string containing the file's contents.

---

## Function: createFile(filePath, content)

### Description
Asynchronously creates a new file, including any necessary parent directories. If the file already exists, it will be overwritten.

### Input
-   `filePath` (string): The full path of the file to create.
-   `content` (string): The content to write to the file.

### Process
1.  Determines the directory of the file path using `path.dirname(filePath)`.
2.  Calls `fs.mkdir(dir, { recursive: true })` to ensure the target directory exists.
3.  Calls `fs.writeFile(filePath, content, 'utf-8')` to write the content.

### Output
-   (Promise<void>): A promise that resolves when the file has been successfully written.

---

## Function: deleteFile(filePath)

### Description
Asynchronously deletes a single file.

### Input
-   `filePath` (string): The path to the file to delete.

### Process
1.  Calls `fs.unlink(filePath)`.
2.  If the path does not exist, the promise will reject with an "ENOENT" error.

### Output
-   (Promise<void>): A promise that resolves when the file has been deleted.
