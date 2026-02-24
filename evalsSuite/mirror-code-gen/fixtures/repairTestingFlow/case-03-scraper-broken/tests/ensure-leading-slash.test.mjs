import { ensureLeadingSlash } from '../src/scraper/utils.mjs';

const testCases = [
  {
    description: 'String without slash gets slash prepended',
    input: 'path/to/resource',
    expected: '/path/to/resource'
  },
  {
    description: 'String already with slash remains unchanged',
    input: '/already/with/slash',
    expected: '/already/with/slash'
  },
  {
    description: 'Empty string returns slash',
    input: '',
    expected: '/'
  },
  {
    description: 'String with multiple leading slashes remains unchanged (checks only first char)',
    input: '//double/slash',
    expected: '//double/slash'
  },
  {
    description: 'String with leading slash and spaces',
    input: '/ with space',
    expected: '/ with space'
  },
  {
    description: 'String without slash but with special characters',
    input: 'path?query=value',
    expected: '/path?query=value'
  }
];

const results = testCases.map(({ description, input, expected }) => {
  const actual = ensureLeadingSlash(input);
  const pass = actual === expected;
  return { description, expected, actual, pass };
});

process.stdout.write(JSON.stringify({ results }));
