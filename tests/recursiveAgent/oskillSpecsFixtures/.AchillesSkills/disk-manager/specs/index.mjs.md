# Entry Point

This is the main entry point for the skill. It should parse the user's prompt to determine which disk operation to perform and then call the appropriate method from the `DiskManager` class.

The prompt will be in the format: `[command] [arg1] [arg2] ...`

Valid commands are:
- `createFile [filePath] [content]`
- `deleteFile [filePath]`
- `createDir [dirPath]`
- `deleteDir [dirPath]`

The action should return a JSON object indicating success or failure.
Example: `{ "status": "success", "operation": "createFile", "path": "/path/to/file" }`
