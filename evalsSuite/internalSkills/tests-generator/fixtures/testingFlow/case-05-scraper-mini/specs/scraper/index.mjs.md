# FDS

## Description
Defines the top-level scraper flow that fetches HTML, parses links, normalizes them, and returns unique results.

## Dependencies
- src/scraper/fetcher.mjs - fetchHtml : Retrieves HTML for a given source key.
- src/scraper/parser.mjs - parseLinks : Extracts raw href values from HTML.
- src/scraper/normalizer.mjs - normalizeLinks : Normalizes raw links to a canonical form.
- src/scraper/links.mjs - filterUnique : Removes duplicate links while preserving order.

## Main Functions
- scrapeLinks (source: string) -> Promise<string[]> Runs the full scraping pipeline and returns unique links.
  Inputs: source key string.
  Outputs: array of normalized unique links.
  Errors: propagates errors from fetchHtml when source is missing.

## Exports
Exports scrapeLinks as the primary API for the scraper module.

## Implementation Details
Executes pipeline in sequence: fetchHtml -> parseLinks -> normalizeLinks -> filterUnique. Uses async/await for fetching.

## Testing
Test scrapeLinks end-to-end by registering a source with multiple links (including duplicates and relative URLs). Verify normalization (lowercasing, leading slash) and deduplication. Test error when source key is missing.
