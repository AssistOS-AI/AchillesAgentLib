# FDS

## Description
Normalizes scraped links by lowercasing and ensuring leading slashes for relative paths.

## Dependencies
- src/scraper/utils.mjs - ensureLeadingSlash : Ensures a leading slash on relative paths.

## Main Functions
- normalizeLinks (links: string[]) -> string[] Normalizes each link to a canonical form.
  Inputs: list of link strings.
  Outputs: list of normalized links.
  Errors: none.

## Exports
Exports normalizeLinks as a named function.

## Implementation Details
Lowercases all links. Leaves absolute URLs starting with http untouched except lowercasing. Adds leading slash for relative paths.

## Testing
Test normalization for absolute URLs, relative URLs without leading slash, and already normalized values.
