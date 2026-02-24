import { extractHref } from '../src/scraper/selector.mjs';

const testCases = [
  {
    name: 'Standard href with double quotes',
    input: '<a href="https://example.com">Link</a>',
    expected: 'https://example.com'
  },
  {
    name: 'Href with single quotes',
    input: '<a href=\'https://single-quote.com\'>Link</a>',
    expected: 'https://single-quote.com'
  },
  {
    name: 'No href attribute',
    input: '<a class="link">No href</a>',
    expected: null
  },
  {
    name: 'Mixed case href attribute',
    input: '<a HrEf="https://mixed-case.com">Link</a>',
    expected: 'https://mixed-case.com'
  },
  {
    name: 'Extra spaces and multiple attributes',
    input: '<a  class="btn"  href="https://spaces.com"  target="_blank"  >Link</a>',
    expected: 'https://spaces.com'
  },
  {
    name: 'Empty href value',
    input: '<a href="">Link</a>',
    expected: ''
  },
  {
    name: 'Href with special characters',
    input: '<a href="/path/to/page?query=test&id=123">Link</a>',
    expected: '/path/to/page?query=test&id=123'
  },
  {
    name: 'Multiple href attributes (should match first)',
    input: '<a href="first.com" href="second.com">Link</a>',
    expected: 'first.com'
  }
];

async function runTests() {
  const results = [];
  
  for (const testCase of testCases) {
    try {
      const actual = extractHref(testCase.input);
      const pass = actual === testCase.expected;
      
      results.push({
        name: testCase.name,
        expected: testCase.expected,
        actual: actual,
        pass: pass
      });
    } catch (error) {
      results.push({
        name: testCase.name,
        expected: testCase.expected,
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
