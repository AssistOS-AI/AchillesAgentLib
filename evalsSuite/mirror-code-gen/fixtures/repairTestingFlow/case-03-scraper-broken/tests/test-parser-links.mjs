import { parseLinks } from '../src/scraper/parser.mjs';

const testCases = JSON.parse(
  await fs.readFile(new URL('./test-parser-links.mjs.cases.json', import.meta.url))
);

async function runTests() {
  const results = [];
  
  for (const testCase of testCases) {
    const actual = parseLinks(testCase.input);
    const pass = JSON.stringify(actual) === JSON.stringify(testCase.expected);
    
    results.push({
      expected: testCase.expected,
      actual: actual,
      pass: pass
    });
  }
  
  process.stdout.write(JSON.stringify({ results }));
}

const fs = await import('fs/promises');
runTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});