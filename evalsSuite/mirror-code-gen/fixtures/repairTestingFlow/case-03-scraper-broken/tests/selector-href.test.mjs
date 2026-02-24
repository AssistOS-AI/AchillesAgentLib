import { extractHref } from '../src/scraper/selector.mjs';

const testCases = [
  {
    name: 'Standard tag with double quotes returns href value',
    input: '<a href="https://example.com">link</a>',
    expected: 'https://example.com'
  },
  {
    name: 'Single quotes also work',
    input: '<a href=\'https://example.org\'>link</a>',
    expected: 'https://example.org'
  },
  {
    name: 'No href attribute returns null',
    input: '<a class="link">link</a>',
    expected: null
  },
  {
    name: 'Multiple attributes extracts only href',
    input: '<a href="https://example.net" class="link" target="_blank">link</a>',
    expected: 'https://example.net'
  },
  {
    name: 'Case-insensitive href attribute',
    input: '<a HREF="https://example.edu">link</a>',
    expected: 'https://example.edu'
  },
  {
    name: 'Extra spaces in tag',
    input: '<a  href =  "https://example.co"  >link</a>',
    expected: 'https://example.co'
  },
  {
    name: 'Malformed tag (missing closing quote) returns null',
    input: '<a href="https://example.bad>link</a>',
    expected: null
  }
];

const results = testCases.map(testCase => {
  const actual = extractHref(testCase.input);
  const pass = actual === testCase.expected;
  return {
    name: testCase.name,
    expected: testCase.expected,
    actual: actual,
    pass: pass
  };
});

process.stdout.write(JSON.stringify({ results }));
