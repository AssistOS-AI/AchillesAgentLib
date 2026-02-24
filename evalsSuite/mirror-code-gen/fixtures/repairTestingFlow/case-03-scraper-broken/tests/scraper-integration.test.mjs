import { scrapeLinks } from '../src/scraper/index.mjs';
import { registerSource } from '../src/scraper/fetcher.mjs';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const casesPath = join(__dirname, 'scraper-integration.test.mjs.cases.json');

async function runTests() {
  const testCases = JSON.parse(readFileSync(casesPath, 'utf-8'));
  const results = [];

  for (const testCase of testCases) {
    try {
      // Register test HTML for the source key
      if (testCase.html) {
        registerSource(testCase.sourceKey, testCase.html);
      }

      let actual;
      try {
        actual = await scrapeLinks(testCase.sourceKey);
      } catch (error) {
        // For error test cases, capture the error message
        if (testCase.expectedError) {
          actual = error.message;
        } else {
          throw error;
        }
      }

      // Clean up registered source to prevent test pollution
      if (testCase.html) {
        // The fetcher doesn't have unregister, but we can overwrite or rely on next test
        // For simplicity, we'll just leave it since Map.set overwrites
      }

      const pass = JSON.stringify(actual) === JSON.stringify(testCase.expected);
      
      results.push({
        description: testCase.description,
        expected: testCase.expectedError ? testCase.expectedError : testCase.expected,
        actual: actual,
        pass: pass
      });
    } catch (error) {
      results.push({
        description: testCase.description,
        expected: testCase.expectedError ? testCase.expectedError : testCase.expected,
        actual: error.message,
        pass: false
      });
    }
  }

  process.stdout.write(JSON.stringify({ results }));
}

runTests().catch(error => {
  console.error(error);
  process.exit(1);
});
