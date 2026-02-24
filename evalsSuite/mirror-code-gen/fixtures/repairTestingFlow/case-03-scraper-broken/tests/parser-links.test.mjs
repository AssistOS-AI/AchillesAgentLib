import { parseLinks } from '../src/scraper/parser.mjs';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const casesPath = join(__dirname, 'parser-links.test.mjs.cases.json');

function runTests() {
  const results = [];
  
  // Test 1: HTML containing multiple anchor tags with valid hrefs
  {
    const html = `
      <html>
        <body>
          <a href="/home">Home</a>
          <a href='https://example.com'>Example</a>
          <a href="/about" class="link">About</a>
        </body>
      </html>
    `;
    const expected = ['/home', 'https://example.com', '/about'];
    const actual = parseLinks(html);
    results.push({
      description: 'Multiple valid anchor tags',
      expected: expected,
      actual: actual,
      pass: JSON.stringify(expected) === JSON.stringify(actual)
    });
  }
  
  // Test 2: HTML with tags that have no href should be filtered out
  {
    const html = `
      <a>No href</a>
      <a href="/valid">Valid</a>
      <a class="no-href">Another without href</a>
    `;
    const expected = ['/valid'];
    const actual = parseLinks(html);
    results.push({
      description: 'Filter out tags without href',
      expected: expected,
      actual: actual,
      pass: JSON.stringify(expected) === JSON.stringify(actual)
    });
  }
  
  // Test 3: HTML with no anchor tags should return an empty array
  {
    const html = `
      <div>No links here</div>
      <p>Just text</p>
      <span>No anchors</span>
    `;
    const expected = [];
    const actual = parseLinks(html);
    results.push({
      description: 'No anchor tags',
      expected: expected,
      actual: actual,
      pass: JSON.stringify(expected) === JSON.stringify(actual)
    });
  }
  
  // Test 4: HTML with malformed tags should be handled gracefully
  {
    const html = `
      <a href="malformed>Broken quote</a>
      <a href="/working">Working</a>
      <a href='another"bad'>Mixed quotes</a>
      <a href="">Empty href</a>
    `;
    const expected = ['/working'];
    const actual = parseLinks(html);
    results.push({
      description: 'Handle malformed tags gracefully',
      expected: expected,
      actual: actual,
      pass: JSON.stringify(expected) === JSON.stringify(actual)
    });
  }
  
  // Test 5: Ensure extracted values match those from selector (integration test)
  {
    const html = `
      <a href="/test1" data-test="1">Test 1</a>
      <a href="/test2" class="test">Test 2</a>
    `;
    const expected = ['/test1', '/test2'];
    const actual = parseLinks(html);
    
    // Also verify each tag actually contains the href value
    const allTags = html.match(/<a[^>]*>/g) || [];
    const allHaveHref = allTags.every(tag => tag.includes('href='));
    
    results.push({
      description: 'Extracted values match selector integration',
      expected: expected,
      actual: actual,
      pass: JSON.stringify(expected) === JSON.stringify(actual) && allHaveHref
    });
  }
  
  // Test 6: Mixed single and double quotes
  {
    const html = `
      <a href='/single'>Single</a>
      <a href="/double">Double</a>
      <a href='/mixed"'>Mixed</a>
    `;
    const expected = ['/single', '/double'];
    const actual = parseLinks(html);
    results.push({
      description: 'Handle different quote styles',
      expected: expected,
      actual: actual,
      pass: JSON.stringify(expected) === JSON.stringify(actual)
    });
  }
  
  // Test 7: Tags with extra attributes
  {
    const html = `
      <a class="btn" href="/action" target="_blank">Button</a>
      <a href="/simple">Simple</a>
      <a id="link1" href="/id" data-custom="value">With ID</a>
    `;
    const expected = ['/action', '/simple', '/id'];
    const actual = parseLinks(html);
    results.push({
      description: 'Tags with extra attributes',
      expected: expected,
      actual: actual,
      pass: JSON.stringify(expected) === JSON.stringify(actual)
    });
  }
  
  // Test 8: Empty string input
  {
    const html = '';
    const expected = [];
    const actual = parseLinks(html);
    results.push({
      description: 'Empty string input',
      expected: expected,
      actual: actual,
      pass: JSON.stringify(expected) === JSON.stringify(actual)
    });
  }
  
  // Test 9: Self-closing anchor tags (though invalid HTML)
  {
    const html = `
      <a href="/selfclose" />
      <a href="/normal">Normal</a>
    `;
    const expected = ['/normal'];
    const actual = parseLinks(html);
    results.push({
      description: 'Handle self-closing tags',
      expected: expected,
      actual: actual,
      pass: JSON.stringify(expected) === JSON.stringify(actual)
    });
  }
  
  process.stdout.write(JSON.stringify({ results }));
}

// Read test cases from file if it exists
function loadTestCases() {
  try {
    const data = readFileSync(casesPath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return null;
  }
}

// If test cases file exists, run additional tests from it
const externalCases = loadTestCases();
if (externalCases && Array.isArray(externalCases)) {
  const originalRunTests = runTests;
  runTests = function() {
    const results = [];
    
    // Run built-in tests first
    const builtInResults = [];
    const originalStdout = process.stdout.write;
    process.stdout.write = function(data) {
      const parsed = JSON.parse(data);
      builtInResults.push(...parsed.results);
    };
    originalRunTests();
    process.stdout.write = originalStdout;
    results.push(...builtInResults);
    
    // Run external test cases
    externalCases.forEach((testCase, index) => {
      const expected = testCase.expected || [];
      const actual = parseLinks(testCase.html || '');
      results.push({
        description: `External case ${index + 1}: ${testCase.description || 'No description'}`,
        expected: expected,
        actual: actual,
        pass: JSON.stringify(expected) === JSON.stringify(actual)
      });
    });
    
    process.stdout.write(JSON.stringify({ results }));
  };
}

runTests();
