import { normalizeLinks } from '../src/scraper/normalizer.mjs';
import { readFileSync } from 'fs';

const testCasesPath = new URL('./normalizer-links.test.mjs.cases.json', import.meta.url);
let testCases = [];

try {
  const data = JSON.parse(readFileSync(testCasesPath, 'utf8'));
  testCases = data.testCases || [];
} catch (error) {
  console.error('Failed to load test cases:', error.message);
  process.exit(1);
}

const results = testCases.map(({ description, input, expected }) => {
  try {
    const actual = normalizeLinks(input);
    const pass = JSON.stringify(actual) === JSON.stringify(expected);
    return { expected, actual, pass };
  } catch (error) {
    return { expected, actual: error.message, pass: false };
  }
});

process.stdout.write(JSON.stringify({ results }));
