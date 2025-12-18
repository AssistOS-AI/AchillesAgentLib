# DiskManager Class

This file describes a `DiskManager` class that encapsulates file system operations using Node.js's `fs/promises` module.

## Methods

### createFile(filePath, content)
- Asynchronously writes `content` to the specified `filePath`.
- Creates parent directories if they don't exist.
- Returns a success message.

### deleteFile(filePath)
- Asynchronously deletes the specified `filePath`.
- Returns a success message.

### createDir(dirPath)
- Asynchronously creates a directory at `dirPath`.
- Creates parent directories if they don't exist.
- Returns a success message.

### deleteDir(dirPath)
- Asynchronously and recursively deletes the directory at `dirPath`.
- Returns a success message.
