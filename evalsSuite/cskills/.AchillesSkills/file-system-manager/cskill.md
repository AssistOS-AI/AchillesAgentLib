# File System Manager

Provides a unified interface for performing common file and directory operations on the local file system.

## Summary
This skill acts as a secure and robust facade for a variety of file system tasks. It allows for creating, reading, and deleting files, as well as more complex operations like moving files and folders, batch-renaming files within a directory, and searching for content within files. All operations are exposed through a single, dynamic entry point that dispatches calls to the appropriate underlying service. This design simplifies interaction and ensures that file system access is managed consistently.

## Input Format
The skill is invoked via an `action` function that accepts a single object specifying the operation to be performed.

- **args** (Object): The container for the command.
  - `method` (string, mandatory): The exact name of the file system function to execute (e.g., `createFile`, `renameAllInFolder`).
  - `params` (array, optional): An array of arguments to be passed to the specified method. The number and type of elements must match the signature of the target method.

## Output Format
- **Type**: `any`
- **Description**: The output depends on the `method` invoked.
- **Success Examples**:
  - **readFile**: Returns a string containing the file's content.
  - **createFile**: Returns a success message like `"Successfully created file at /path/to/file.txt"`.
  - **findStringInFiles**: Returns an array of objects, where each object contains the file path and line number of a match. `[{ filePath: '/path/to/file1.txt', line: 10, match: '...' }]`.
  - **Void Operations** (`deleteFile`, `move`): Returns a success message, e.g., `"Successfully deleted /path/to/file.txt"`.
- **Error Example**: An error is thrown if the method does not exist or if an operation fails. Example: `"Error: Method 'nonExistentMethod' not found."` or `"Error: File not found at /path/to/nonexistent.txt"`.

## Constraints
- The `method` name must be a case-sensitive, exact match for an exposed method.
- The `params` array must provide all required arguments in the correct order and with the correct data types.
- The skill requires appropriate read/write/execute permissions for the paths it is instructed to operate on.
