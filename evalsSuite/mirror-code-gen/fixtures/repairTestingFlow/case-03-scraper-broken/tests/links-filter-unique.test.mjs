import { filterUnique } from '../src/scraper/links.mjs';

const testCases = [
  {
    name: 'list with duplicates should return only first occurrence',
    input: ['/home', '/about', '/home', '/contact', '/about'],
    expected: ['/home', '/about', '/contact']
  },
  {
    name: 'list with no duplicates should remain unchanged',
    input: ['/a', '/b', '/c'],
    expected: ['/a', '/b', '/c']
  },
  {
    name: 'empty list should return empty list',
    input: [],
    expected: []
  },
  {
    name: 'case-sensitive duplicates should be considered different',
    input: ['/a', '/A', '/a', '/A'],
    expected: ['/a', '/A']
  },
  {
    name: 'mixed duplicates in different positions',
    input: ['/x', '/y', '/z', '/x', '/y', '/w'],
    expected: ['/x', '/y', '/z', '/w']
  }
];

const results = testCases.map(testCase => {
  const actual = filterUnique(testCase.input);
  const pass = JSON.stringify(actual) === JSON.stringify(testCase.expected);
  
  return {
    name: testCase.name,
    expected: testCase.expected,
    actual: actual,
    pass: pass
  };
});

process.stdout.write(JSON.stringify({ results }));
