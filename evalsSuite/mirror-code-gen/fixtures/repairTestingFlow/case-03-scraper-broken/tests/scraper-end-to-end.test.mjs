import { registerSource } from '../src/scraper/fetcher.mjs';
import { scrapeLinks } from '../src/scraper/index.mjs';

async function runTests() {
  const results = [];
  
  // Test 1: Normal flow with valid HTML containing multiple links
  try {
    registerSource('test1', `
      <html>
        <a href="/page1">Link 1</a>
        <a href="/page2">Link 2</a>
        <a href="page3">Link 3</a>
        <a href="http://example.com/abs">Absolute</a>
        <a href="/page1">Duplicate</a>
        <a href="page3">Another duplicate</a>
      </html>
    `);
    const actual = await scrapeLinks('test1');
    const expected = [
      '/page1',
      '/page2',
      '/page3',
      'http://example.com/abs'
    ];
    results.push({
      name: 'Normal flow with valid HTML containing multiple links',
      expected,
      actual,
      pass: JSON.stringify(actual) === JSON.stringify(expected)
    });
  } catch (error) {
    results.push({
      name: 'Normal flow with valid HTML containing multiple links',
      expected: 'No error',
      actual: error.message,
      pass: false
    });
  }
  
  // Test 2: Empty HTML input returns empty array
  try {
    registerSource('test2', '');
    const actual = await scrapeLinks('test2');
    const expected = [];
    results.push({
      name: 'Empty HTML input returns empty array',
      expected,
      actual,
      pass: JSON.stringify(actual) === JSON.stringify(expected)
    });
  } catch (error) {
    results.push({
      name: 'Empty HTML input returns empty array',
      expected: 'No error',
      actual: error.message,
      pass: false
    });
  }
  
  // Test 3: HTML with no anchor tags returns empty array
  try {
    registerSource('test3', '<html><body><p>No links here</p></body></html>');
    const actual = await scrapeLinks('test3');
    const expected = [];
    results.push({
      name: 'HTML with no anchor tags returns empty array',
      expected,
      actual,
      pass: JSON.stringify(actual) === JSON.stringify(expected)
    });
  } catch (error) {
    results.push({
      name: 'HTML with no anchor tags returns empty array',
      expected: 'No error',
      actual: error.message,
      pass: false
    });
  }
  
  // Test 4: Source not registered throws error
  try {
    await scrapeLinks('nonexistent');
    results.push({
      name: 'Source not registered throws error',
      expected: 'Should throw error',
      actual: 'No error thrown',
      pass: false
    });
  } catch (error) {
    const expectedMessage = 'Source not found';
    results.push({
      name: 'Source not registered throws error',
      expected: expectedMessage,
      actual: error.message,
      pass: error.message === expectedMessage
    });
  }
  
  // Test 5: Mixed relative/absolute links are normalized correctly
  try {
    registerSource('test5', `
      <a href="relative">Relative</a>
      <a href="/already-absolute">Already absolute</a>
      <a href="http://example.com">HTTP absolute</a>
      <a href="https://secure.com/path">HTTPS absolute</a>
      <a href="another-relative">Another relative</a>
    `);
    const actual = await scrapeLinks('test5');
    const expected = [
      '/relative',
      '/already-absolute',
      'http://example.com',
      'https://secure.com/path',
      '/another-relative'
    ];
    results.push({
      name: 'Mixed relative/absolute links are normalized correctly',
      expected,
      actual,
      pass: JSON.stringify(actual) === JSON.stringify(expected)
    });
  } catch (error) {
    results.push({
      name: 'Mixed relative/absolute links are normalized correctly',
      expected: 'No error',
      actual: error.message,
      pass: false
    });
  }
  
  // Test 6: Duplicate links are removed
  try {
    registerSource('test6', `
      <a href="/duplicate">First</a>
      <a href="/duplicate">Second</a>
      <a href="http://same.com">Third</a>
      <a href="http://same.com">Fourth</a>
      <a href="/unique">Fifth</a>
    `);
    const actual = await scrapeLinks('test6');
    const expected = [
      '/duplicate',
      'http://same.com',
      '/unique'
    ];
    results.push({
      name: 'Duplicate links are removed',
      expected,
      actual,
      pass: JSON.stringify(actual) === JSON.stringify(expected)
    });
  } catch (error) {
    results.push({
      name: 'Duplicate links are removed',
      expected: 'No error',
      actual: error.message,
      pass: false
    });
  }
  
  process.stdout.write(JSON.stringify({ results }));
}

runTests();
