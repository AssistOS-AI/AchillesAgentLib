# Specification for index.js

## Module Description
This module is the main entry point for the File System Manager skill. It follows a facade pattern to expose a clean, unified API for a set of more specialized, underlying modules. The main export is an `action` function that dynamically dispatches calls to the appropriate methods on the facade.

## Dependencies
-   `./FileSystemManager.mjs`: Imports the `FileSystemManager` class.

---

## Class: FileSystemFacade

### Description
The `FileSystemFacade` instantiates and orchestrates all the services related to file system operations. It binds their public methods directly to its own instance, allowing a caller to access any method (e.g., `createFile`) as if it were a method of the facade itself.

### Constructor Logic
1.  An instance of `FileSystemManager` is created and stored.
2.  A `bindMethods` helper is called to attach all public methods from the `FileSystemManager` instance to the facade instance.

### Method Binding (`bindMethods`)
-   **Description**: An internal helper that iterates through a list of method names and binds them from a source object to the facade instance.
-   **Process**: For each method name, it assigns `this[methodName] = source[methodName].bind(source)`, ensuring the `this` context is correct when the method is called via the facade.

#### Bound Methods
-   **From `FileSystemManager`**: `readFile`, `createFile`, `deletePath`, `movePath`, `renameAllInFolder`, `findStringInFiles`.

---

## Function: action(args)

### Description
The main exported function and the designated entry point for execution. It's an asynchronous function that acts as a dynamic dispatcher, invoking a method on the `FileSystemFacade` instance based on runtime arguments.

### Input
-   `args` (Object):
    -   `method` (string): The name of the method to call on the facade.
    -   `params` (array): An array of arguments for the target method.

### Processing Logic
1.  Destructures `method` and `params` from the `args` object.
2.  Checks if `method` is a valid, existing function on the singleton `fileSystemFacade` instance.
3.  **If the method exists**: It calls the method using the spread operator (`...params`) to pass the arguments. It `await`s the result and returns it.
4.  **If the method does not exist**: It throws an `Error` indicating the method was not found.
