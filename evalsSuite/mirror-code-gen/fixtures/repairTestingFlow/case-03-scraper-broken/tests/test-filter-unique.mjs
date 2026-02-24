import { filterUnique } from '../src/scraper/links.mjs';

async function runTests() {
  const results = [];
  
  // Test 1: Array with duplicates returns only first occurrence of each
  try {
    const input1 = ['/home', '/about', '/home', '/contact', '/about'];
    const expected1 = ['/home', '/about', '/contact'];
    const actual1 = filterUnique(input1);
    results.push({
      expected: expected1,
      actual: actual1,
      pass: JSON.stringify(expected1) === JSON.stringify(actual1)
    });
  } catch (error) {
    results.push({
      expected: 'Array without duplicates',
      actual: error.message,
      pass: false
    });
  }
  
  // Test 2: Empty array returns empty array
  try {
    const input2 = [];
    const expected2 = [];
    const actual2 = filterUnique(input2);
    results.push({
      expected: expected2,
      actual: actual2,
      pass: JSON.stringify(expected2) === JSON.stringify(actual2)
    });
  } catch (error) {
    results.push({
      expected: 'Empty array',
      actual: error.message,
      pass: false
    });
  }
  
  // Test 3: Already unique array returns same order
  try {
    const input3 = ['/a', '/b', '/c', '/d'];
    const expected3 = ['/a', '/b', '/c', '/d'];
    const actual3 = filterUnique(input3);
    results.push({
      expected: expected3,
      actual: actual3,
      pass: JSON.stringify(expected3) === JSON.stringify(actual3)
    });
  } catch (error) {
    results.push({
      expected: 'Same unique array',
      actual: error.message,
      pass: false
    });
  }
  
  // Test 4: Case-sensitive duplicates
  try {
    const input4 = ['/Home', '/home', '/HOME', '/About', '/about'];
    const expected4 = ['/Home', '/home', '/HOME', '/About', '/about'];
    const actual4 = filterUnique(input4);
    results.push({
      expected: expected4,
      actual: actual4,
      pass: JSON.stringify(expected4) === JSON.stringify(actual4)
    });
  } catch (error) {
    results.push({
      expected: 'Case-sensitive unique array',
      actual: error.message,
      pass: false
    });
  }
  
  // Test 5: Mixed duplicates including exact matches
  try {
    const input5 = ['/blog', '/BLOG', '/blog', '/blog/post', '/BLOG'];
    const expected5 = ['/blog', '/BLOG', '/blog/post'];
    const actual5 = filterUnique(input5);
    results.push({
      expected: expected5,
      actual: actual5,
      pass: JSON.stringify(expected5) === JSON.stringify(actual5)
    });
  } catch (error) {
    results.push({
      expected: 'Mixed case duplicates',
      actual: error.message,
      pass: false
    });
  }
  
  process.stdout.write(JSON.stringify({ results }));
}

runTests().catch(error => {
  process.stdout.write(JSON.stringify({ 
    results: [{ 
      expected: 'Test execution', 
      actual: error.message, 
      pass: false 
    }] 
  }));
});