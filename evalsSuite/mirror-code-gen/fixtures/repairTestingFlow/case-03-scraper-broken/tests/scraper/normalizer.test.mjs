import { normalizeLinks } from '../../src/scraper/normalizer.mjs';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';

async function runTests() {
  const results = [];
  
  try {
    // Read test cases from cases file
    const casesPath = new URL('./normalizer.test.cases.json', import.meta.url);
    const casesData = await readFile(casesPath, 'utf8');
    const testCases = JSON.parse(casesData);
    
    for (const testCase of testCases) {
      const actual = normalizeLinks(testCase.input);
      const pass = JSON.stringify(actual) === JSON.stringify(testCase.expected);
      
      results.push({
        expected: testCase.expected,
        actual: actual,
        pass: pass
      });
    }
  } catch (error) {
    // If cases file doesn't exist, use default test cases
    const defaultCases = [
      {
        input: ['about', 'contact', '/home'],
        expected: ['/about', '/contact', '/home']
      },
      {
        input: ['http://example.com', 'https://example.org/path'],
        expected: ['http://example.com', 'https://example.org/path']
      },
      {
        input: ['about', 'http://example.com', '/home', 'https://example.org'],
        expected: ['/about', 'http://example.com', '/home', 'https://example.org']
      },
      {
        input: [],
        expected: []
      }
    ];
    
    for (const testCase of defaultCases) {
      const actual = normalizeLinks(testCase.input);
      const pass = JSON.stringify(actual) === JSON.stringify(testCase.expected);
      
      results.push({
        expected: testCase.expected,
        actual: actual,
        pass: pass
      });
    }
  }
  
  process.stdout.write(JSON.stringify({ results }));
}

runTests().catch(error => {
  console.error(error);
  process.exit(1);
});