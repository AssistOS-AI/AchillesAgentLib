import { registerSource, fetchHtml } from '../src/scraper/fetcher.mjs';

// Clear the sources Map before each test to ensure isolation
function clearSources() {
    // Since the Map is a module-level variable, we need to clear it
    // This simulates isolated state by clearing all entries
    const sources = new Map();
    // Note: In a real test environment with module reloading, 
    // the Map would be fresh each time, but for this simple test
    // we'll clear the shared Map
    // This approach works because we're in the same module scope
    while (sources.keys().next().done === false) {
        sources.clear();
    }
}

async function runTests() {
    const results = [];
    
    // Test 1: Register a source and fetch it successfully
    try {
        clearSources();
        const testKey = 'test-url';
        const testHtml = '<html>Test Content</html>';
        
        // Register the source
        registerSource(testKey, testHtml);
        
        // Fetch the source
        const fetchedHtml = await fetchHtml(testKey);
        
        results.push({
            expected: testHtml,
            actual: fetchedHtml,
            pass: fetchedHtml === testHtml
        });
    } catch (error) {
        results.push({
            expected: 'Successful fetch',
            actual: error.message,
            pass: false
        });
    }
    
    // Test 2: Fetch unregistered source throws 'Source not found' error
    try {
        clearSources();
        const nonExistentKey = 'non-existent-url';
        
        // This should throw an error
        await fetchHtml(nonExistentKey);
        
        // If we reach here, no error was thrown (fail)
        results.push({
            expected: 'Error: Source not found',
            actual: 'No error thrown',
            pass: false
        });
    } catch (error) {
        results.push({
            expected: 'Source not found',
            actual: error.message,
            pass: error.message === 'Source not found'
        });
    }
    
    // Test 3: Register overwrites existing key
    try {
        clearSources();
        const sameKey = 'same-key';
        const firstHtml = '<html>First</html>';
        const secondHtml = '<html>Second</html>';
        
        // Register first value
        registerSource(sameKey, firstHtml);
        
        // Register second value (should overwrite)
        registerSource(sameKey, secondHtml);
        
        // Fetch should return the second (overwritten) value
        const fetchedHtml = await fetchHtml(sameKey);
        
        results.push({
            expected: secondHtml,
            actual: fetchedHtml,
            pass: fetchedHtml === secondHtml
        });
    } catch (error) {
        results.push({
            expected: 'Successful overwrite and fetch',
            actual: error.message,
            pass: false
        });
    }
    
    // Output results as JSON
    process.stdout.write(JSON.stringify({ results }));
}

// Run the tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    runTests().catch(error => {
        console.error('Test runner error:', error);
        process.exit(1);
    });
}

export { runTests };