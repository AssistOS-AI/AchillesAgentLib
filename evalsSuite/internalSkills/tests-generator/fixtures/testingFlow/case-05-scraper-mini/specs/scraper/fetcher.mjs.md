# FDS

## Description
Maintains an in-memory map of HTML sources and provides access functions to register and fetch HTML by key.

## Dependencies
None.

## Main Functions
- registerSource (key: string, html: string) -> void Registers HTML content under a key.
  Inputs: key and HTML string.
  Outputs: none.
  Errors: none.
- fetchHtml (key: string) -> Promise<string> Retrieves HTML content for a key.
  Inputs: key string.
  Outputs: HTML string.
  Errors: throws when key is not registered.

## Exports
Exports registerSource and fetchHtml as named functions.

## Implementation Details
Uses a module-scoped Map to store HTML by key. fetchHtml is async but returns immediately from memory.

## Testing
Test registerSource + fetchHtml for a known key. Test fetchHtml throws when key is missing.
