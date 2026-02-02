import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RecursiveSkilledAgent } from '../../RecursiveSkilledAgents/RecursiveSkilledAgent.mjs';
import { LLMAgent } from '../../LLMAgents/LLMAgent.mjs';
import { envAutoConfig } from '../../LLMAgents/envAutoConfig.mjs';
import { rm, mkdir } from 'node:fs/promises';
import fs from 'node:fs/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function evalCodeGenerationPerformance() {
  // Configure LLM environment for code generation
  await envAutoConfig();

  // Initialize the agent with a real LLM for code generation
  const llmAgent = new LLMAgent({ name: 'evalCodeGen' });
  const agent = new RecursiveSkilledAgent({
    llmAgent,
    additionalSkillRoots: [path.resolve(__dirname, '.AchillesSkills')],
    searchUpwards: false,
  });

  console.log("⏳ Preparing skills (will trigger code generation for all cskills)...");
  await Promise.all(agent.pendingPreparations || []);
  console.log("✅ Skills prepared.");

  // Track test results
  const testResults = {
    total: 0,
    passed: 0,
    failed: 0
  };

  // Helper function to log test results
  function logTestResult(skillName, success, message) {
    testResults.total++;
    if (success) {
      testResults.passed++;
      console.log(`\n🟢 ${skillName}: ${message}`);
    } else {
      testResults.failed++;
      console.log(`\n🔴 ${skillName}: ${message}`);
    }
  }

  // Helper to clean up generated files after testing (always removes targets)
  async function cleanupGeneratedFiles(skillName) {
    return;
    const specsDir = path.resolve(__dirname, '.AchillesSkills', skillName, 'specs');
    const skillDir = path.resolve(__dirname, '.AchillesSkills', skillName);

    try {
      const entries = await fs.readdir(specsDir, { withFileTypes: true });
      for (const entry of entries) {
        const specPath = path.join('specs', entry.name);
        const absSpecPath = path.join(specsDir, entry.name);
        if (entry.isDirectory()) {
          // Recursively remove generated counterparts for nested specs
          await cleanupGeneratedFilesFromDir(skillDir, absSpecPath, specPath);
        } else if (entry.name.endsWith('.md') || entry.name.endsWith('.mds')) {
          const targetRel = specPathToTarget(specPath);
          const targetAbs = path.join(skillDir, targetRel);
          await rm(targetAbs, { recursive: true, force: true }).catch(() => {});
        }
      }
      console.log(`🧹 Cleaned up generated files for ${skillName}`);
    } catch (error) {
      // Ignore missing specs directory
    }
  }

  async function cleanupGeneratedFilesFromDir(skillDir, currentAbsSpecsDir, currentRelSpecsDir) {
    const entries = await fs.readdir(currentAbsSpecsDir, { withFileTypes: true });
    for (const entry of entries) {
      const nextRel = path.join(currentRelSpecsDir, entry.name);
      const nextAbs = path.join(currentAbsSpecsDir, entry.name);
      if (entry.isDirectory()) {
        await cleanupGeneratedFilesFromDir(skillDir, nextAbs, nextRel);
      } else if (entry.name.endsWith('.md') || entry.name.endsWith('.mds')) {
        const targetRel = specPathToTarget(nextRel);
        const targetAbs = path.join(skillDir, targetRel);
        await rm(targetAbs, { recursive: true, force: true }).catch(() => {});
      }
    }
  }

  function specPathToTarget(relativePath) {
    return relativePath
      .replace(/\\/g, '/')
      .replace(/^specs\//, '')
      .replace(/\.mds?$/, '');
  }

  // --- Test Case 1: CSV Parser and Transformer ---
  let csvParserPassed = false;
  try {
    console.log("\n=== Testing CSV Parser and Transformer ===");

    const csvData = `name,age,email
John,25,john@example.com
Jane,30,jane@example.com
Bob,35,bob@example.com`;

    const transformConfig = {
      fieldMappings: { name: "fullName", age: "userAge" },
      filters: { userAge: { gt: 25 } }
    };

    // Test 1: Basic parsing
    console.log("\nTest 1: Basic CSV parsing");
    const parseResult1 = await agent.executePrompt(
      `operation: parse\ncsvString: ${csvData.replace(/\n/g, '\\n')}`,
      {
        skillName: 'csv-parser'
      }
    );

    if (parseResult1.result?.parsedData && parseResult1.result.parsedData.length === 3) {
      console.log(`✅ Parsed ${parseResult1.result.parsedData.length} records successfully`);
    } else {
      throw new Error("CSV parsing failed");
    }

    // Test 2: Parsing with transformation
    console.log("\nTest 2: CSV parsing with transformation");
    const parseResult2 = await agent.executePrompt(
      [
        'operation: parseAndTransform',
        `csvString: ${csvData.replace(/\n/g, '\\n')}`,
        `transformConfig: ${JSON.stringify(transformConfig)}`
      ].join('\n'),
      {
        skillName: 'csv-parser'
      }
    );

    if (parseResult2.result?.transformedData && parseResult2.result.transformedData.length === 2) {
      console.log(`✅ Transformed data correctly filtered (${parseResult2.result.transformedData.length} records)`);
      logTestResult('csv-parser', true, 'All tests passed');
      csvParserPassed = true;
    } else {
      throw new Error("CSV transformation failed");
    }
  } catch (error) {
    logTestResult('csv-parser', false, `Test failed: ${error.message}`);
    console.error("❌ CSV Parser test failed:", error);
  } finally {
    await cleanupGeneratedFiles('csv-parser', csvParserPassed);
  }

  // --- Test Case 2: Simple Cache ---
  let simpleCachePassed = false;
  try {
    console.log("\n=== Testing Simple Cache ===");

    // Test 1: Set and get value
    console.log("\nTest 1: Set and retrieve cache value");
    await agent.executePrompt(
      [
        'operation: set',
        'key: test_key',
        `value: ${JSON.stringify({ data: 'test_value', timestamp: Date.now() })}`,
        'ttl: 10000'
      ].join('\n'),
      {
        skillName: 'simple-cache'
      }
    );

    const getResult = await agent.executePrompt(
      [
        'operation: get',
        'key: test_key'
      ].join('\n'),
      {
        skillName: 'simple-cache'
      }
    );

    if (getResult.result?.data === 'test_value') {
      console.log(`✅ Cache set and get working correctly`);
    } else {
      throw new Error("Cache get failed");
    }

    // Test 2: Check existence
    console.log("\nTest 2: Check cache key existence");
    const hasResponse = await agent.executePrompt(
      [
        'operation: has',
        'key: test_key'
      ].join('\n'),
      {
        skillName: 'simple-cache'
      }
    );

    // Extract result from SkillExecutor wrapper (primitives are wrapped in { result: value })
    const hasResult = hasResponse.result;

    if (hasResult === true) {
      console.log(`✅ Cache key existence check working`);
      logTestResult('simple-cache', true, 'All tests passed');
      simpleCachePassed = true;
    } else {
      throw new Error(`Cache has operation failed: expected true, got ${hasResult}`);
    }
  } catch (error) {
    logTestResult('simple-cache', false, `Test failed: ${error.message}`);
    console.error("❌ Simple Cache test failed:", error);
  } finally {
    await cleanupGeneratedFiles('simple-cache', simpleCachePassed);
  }

  // --- Test Case 3: Log Buffer ---
  let logBufferPassed = false;
  try {
    console.log("\n=== Testing Log Buffer ===");

    // Test 1: Add logs and check stats
    console.log("\nTest 1: Add logs to buffer");
    for (let i = 1; i <= 3; i++) {
      await agent.executePrompt(
        [
          'operation: log',
          `message: Test log message ${i}`,
          'level: info'
        ].join('\n'),
        {
          skillName: 'log-buffer'
        }
      );
    }

    // Test 2: Get statistics
    console.log("\nTest 2: Get buffer statistics");
    const statsResult = await agent.executePrompt(
      'operation: getStats',
      {
        skillName: 'log-buffer'
      }
    );

    if (statsResult.result?.totalLogs === 3) {
      console.log(`✅ Log buffer working correctly (${statsResult.result.totalLogs} logs)`);
    } else {
      throw new Error("Log buffer stats incorrect");
    }

    // Test 3: Force flush
    console.log("\nTest 3: Force buffer flush");
    const flushResult = await agent.executePrompt(
      'operation: flush',
      {
        skillName: 'log-buffer'
      }
    );

    if (flushResult.result?.success === true) {
      console.log(`✅ Log buffer flush working`);
      logTestResult('log-buffer', true, 'All tests passed');
      logBufferPassed = true;
    } else {
      throw new Error("Log buffer flush failed");
    }
  } catch (error) {
    logTestResult('log-buffer', false, `Test failed: ${error.message}`);
    console.error("❌ Log Buffer test failed:", error);
  } finally {
    await cleanupGeneratedFiles('log-buffer', logBufferPassed);
  }

  // --- Test Case 4: Schema Validator ---
  let schemaValidatorPassed = false;
  try {
    console.log("\n=== Testing Schema Validator ===");

    const testData = { user: "John", age: "25" };
    const testSchema = {
      user: { type: "string", min: 3 },
      age: { type: "number", min: 18 }
    };

    // Test: Validate data against schema
    console.log("\nTest: Data validation against schema");
    const validationResult = await agent.executePrompt(
      [
        'operation: validate',
        `data: ${JSON.stringify(testData)}`,
        `schema: ${JSON.stringify(testSchema)}`
      ].join('\n'),
      {
        skillName: 'schema-validator'
      }
    );

    // This should fail because age is a string, not number
    if (validationResult.result?.valid === false && validationResult.result.errors) {
      console.log(`✅ Schema validation working (correctly rejected invalid data)`);
      logTestResult('schema-validator', true, 'All tests passed');
      schemaValidatorPassed = true;
    } else {
      throw new Error("Schema validation failed");
    }
  } catch (error) {
    logTestResult('schema-validator', false, `Test failed: ${error.message}`);
    console.error("❌ Schema Validator test failed:", error);
  } finally {
    await cleanupGeneratedFiles('schema-validator', schemaValidatorPassed);
  }

  // --- Test Case 5: Config Loader ---
  let configLoaderPassed = false;
  try {
    console.log("\n=== Testing Config Loader ===");

    const configSource = {
      DB_HOST: "localhost",
      DB_PORT: "5432",
      DEBUG: "true"
    };

    const configSchema = {
      DB_HOST: "string",
      DB_PORT: "number",
      DEBUG: "boolean"
    };

    // Test: Load and validate configuration
    console.log("\nTest: Configuration loading and validation");
    const configResult = await agent.executePrompt(
      [
        'operation: load',
        `source: ${JSON.stringify(configSource)}`,
        `schema: ${JSON.stringify(configSchema)}`
      ].join('\n'),
      {
        skillName: 'config-loader'
      }
    );

    if (configResult.result?.config &&
        configResult.result.config.DB_PORT === 5432 &&
        configResult.result.config.DEBUG === true) {
      console.log(`✅ Config loader working (correct type conversion)`);
      logTestResult('config-loader', true, 'All tests passed');
      configLoaderPassed = true;
    } else {
      throw new Error("Config loader failed");
    }
  } catch (error) {
    logTestResult('config-loader', false, `Test failed: ${error.message}`);
    console.error("❌ Config Loader test failed:", error);
  } finally {
    await cleanupGeneratedFiles('config-loader', configLoaderPassed);
  }

  // --- Test Case 6: Rate Limiter ---
  let rateLimiterPassed = false;
  try {
    console.log("\n=== Testing Rate Limiter ===");

    // Test 1: Set rate
    console.log("\nTest 1: Set rate limit");
    await agent.executePrompt(
      [
        'operation: setRate',
        `rate: ${JSON.stringify({ tokensPerSecond: 10, burstLimit: 20 })}`
      ].join('\n'),
      {
        skillName: 'rate-limiter'
      }
    );

    // Test 2: Consume tokens
    console.log("\nTest 2: Consume tokens");
    const consumeResult = await agent.executePrompt(
      [
        'operation: consume',
        'tokens: 5'
      ].join('\n'),
      {
        skillName: 'rate-limiter'
      }
    );

    if (consumeResult.result?.success === true) {
      console.log(`✅ Rate limiter working (consumed 5 tokens)`);
    } else {
      throw new Error("Rate limiter consume failed");
    }

    // Test 3: Get status
    console.log("\nTest 3: Get rate limiter status");
    const statusResult = await agent.executePrompt(
      'operation: getStatus',
      {
        skillName: 'rate-limiter'
      }
    );

    if (statusResult.result?.tokens >= 0) {
      console.log(`✅ Rate limiter status working (remaining tokens: ${statusResult.result.tokens})`);
      logTestResult('rate-limiter', true, 'All tests passed');
      rateLimiterPassed = true;
    } else {
      throw new Error("Rate limiter status failed");
    }
  } catch (error) {
    logTestResult('rate-limiter', false, `Test failed: ${error.message}`);
    console.error("❌ Rate Limiter test failed:", error);
  } finally {
    await cleanupGeneratedFiles('rate-limiter', rateLimiterPassed);
  }

  // --- Test Case 7: Hash Utility ---
  let hashUtilPassed = false;
  try {
    console.log("\n=== Testing Hash Utility ===");

    // Test 1: Generate hash
    console.log("\nTest 1: Generate hash");
    const hashResult = await agent.executePrompt(
      [
        'operation: hash',
        'data: password123',
        'salt: testSalt123'
      ].join('\n'),
      {
        skillName: 'hash-util'
      }
    );

    if (hashResult.result?.hash && hashResult.result.salt) {
      console.log(`✅ Hash generation working`);
    } else {
      throw new Error("Hash generation failed");
    }

    // Test 2: Verify hash
    console.log("\nTest 2: Verify hash");
    const verifyResult = await agent.executePrompt(
      [
        'operation: verify',
        'data: password123',
        `hash: ${hashResult.result.hash}`,
        `salt: ${hashResult.result.salt}`
      ].join('\n'),
      {
        skillName: 'hash-util'
      }
    );

    if (verifyResult.result?.valid === true) {
      console.log(`✅ Hash verification working`);
      logTestResult('hash-util', true, 'All tests passed');
      hashUtilPassed = true;
    } else {
      throw new Error("Hash verification failed");
    }
  } catch (error) {
    logTestResult('hash-util', false, `Test failed: ${error.message}`);
    console.error("❌ Hash Utility test failed:", error);
  } finally {
    await cleanupGeneratedFiles('hash-util', hashUtilPassed);
  }

  // Print final summary
  console.log("\n" + "=".repeat(60));
  console.log("📊 CODE GENERATION PERFORMANCE SUMMARY");
  console.log("=".repeat(60));
  console.log(`🟢 Passed: ${testResults.passed}/${testResults.total}`);
  console.log(`🔴 Failed: ${testResults.failed}/${testResults.total}`);
  console.log(`📈 Success Rate: ${Math.round((testResults.passed / testResults.total) * 100)}%`);
  
  if (testResults.failed === 0) {
    console.log("\n🎉 All skill tests passed successfully!");
    console.log("✅ Tested 7 skills: csv-parser, simple-cache, log-buffer,");
    console.log("   schema-validator, config-loader, rate-limiter,");
    console.log("   and hash-util");
  } else {
    console.log("\n⚠️  Some tests failed. Check the logs above for details.");
  }
}


await evalCodeGenerationPerformance();
