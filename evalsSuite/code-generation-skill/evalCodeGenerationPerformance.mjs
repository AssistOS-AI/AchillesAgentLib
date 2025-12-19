import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RecursiveSkilledAgent } from '../../RecursiveSkilledAgents/RecursiveSkilledAgent.mjs';
import { LLMAgent } from '../../LLMAgents/LLMAgent.mjs';
import { envAutoConfig } from '../../LLMAgents/envAutoConfig.mjs';
import { rm, mkdir } from 'node:fs/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function evalCodeGenerationPerformance() {
  // Configure LLM environment for code generation
  await envAutoConfig();

  // Create a temporary directory for the test to operate in
  const testWorkspace = path.resolve(__dirname, 'fs-test-workspace');
  await rm(testWorkspace, { recursive: true, force: true });
  await mkdir(testWorkspace, { recursive: true });
  console.log(`✅ Test workspace created at: ${testWorkspace}`);

  // Initialize the agent with a real LLM for code generation
  const llmAgent = new LLMAgent({ name: 'FileSystem-Skill-Test' });
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

  // Helper function to clean up skill src folder after testing
  async function cleanupSkillSrc(skillName) {
    const srcPath = path.resolve(__dirname, '.AchillesSkills', skillName, 'src');
    try {
      await rm(srcPath, { recursive: true, force: true });
      console.log(`🧹 Cleaned up src folder for ${skillName}`);
    } catch (error) {
      // Silently ignore if folder doesn't exist
    }
  }

  // --- Test Case 1: CSV Parser and Transformer ---
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
    const parseResult1 = await agent.executePrompt("parse CSV data", {
      skillName: 'csv-parser',
      args: {
        operation: 'parse',
        csvString: csvData
      }
    });

    if (parseResult1.parsedData && parseResult1.parsedData.length === 3) {
      console.log(`✅ Parsed ${parseResult1.parsedData.length} records successfully`);
    } else {
      throw new Error("CSV parsing failed");
    }

    // Test 2: Parsing with transformation
    console.log("\nTest 2: CSV parsing with transformation");
    const parseResult2 = await agent.executePrompt("parse and transform CSV data", {
      skillName: 'csv-parser',
      args: {
        operation: 'parseAndTransform',
        csvString: csvData,
        transformConfig: transformConfig
      }
    });

    if (parseResult2.transformedData && parseResult2.transformedData.length === 2) {
      console.log(`✅ Transformed data correctly filtered (${parseResult2.transformedData.length} records)`);
      logTestResult('csv-parser', true, 'All tests passed');
    } else {
      throw new Error("CSV transformation failed");
    }
  } catch (error) {
    logTestResult('csv-parser', false, `Test failed: ${error.message}`);
    console.error("❌ CSV Parser test failed:", error);
  } finally {
    await cleanupSkillSrc('csv-parser');
  }

  // --- Test Case 2: Simple Cache ---
  try {
    console.log("\n=== Testing Simple Cache ===");

    // Test 1: Set and get value
    console.log("\nTest 1: Set and retrieve cache value");
    await agent.executePrompt("set cache value", {
      skillName: 'simple-cache',
      args: {
        operation: 'set',
        key: 'test_key',
        value: { data: 'test_value', timestamp: Date.now() },
        ttl: 10000
      }
    });

    const getResult = await agent.executePrompt("get cache value", {
      skillName: 'simple-cache',
      args: {
        operation: 'get',
        key: 'test_key'
      }
    });

    if (getResult && getResult.data === 'test_value') {
      console.log(`✅ Cache set and get working correctly`);
    } else {
      throw new Error("Cache get failed");
    }

    // Test 2: Check existence
    console.log("\nTest 2: Check cache key existence");
    const hasResult = await agent.executePrompt("check cache key", {
      skillName: 'simple-cache',
      args: {
        operation: 'has',
        key: 'test_key'
      }
    });

    if (hasResult === true) {
      console.log(`✅ Cache key existence check working`);
      logTestResult('simple-cache', true, 'All tests passed');
    } else {
      throw new Error("Cache has operation failed");
    }
  } catch (error) {
    logTestResult('simple-cache', false, `Test failed: ${error.message}`);
    console.error("❌ Simple Cache test failed:", error);
  } finally {
    await cleanupSkillSrc('simple-cache');
  }

  // --- Test Case 3: Log Buffer ---
  try {
    console.log("\n=== Testing Log Buffer ===");
    
    // Test 1: Add logs and check stats
    console.log("\nTest 1: Add logs to buffer");
    for (let i = 1; i <= 3; i++) {
      await agent.executePrompt("add log message", {
        skillName: 'log-buffer',
        args: {
          operation: 'log',
          message: `Test log message ${i}`,
          level: 'info'
        }
      });
    }
    
    // Test 2: Get statistics
    console.log("\nTest 2: Get buffer statistics");
    const statsResult = await agent.executePrompt("get log stats", {
      skillName: 'log-buffer',
      args: {
        operation: 'getStats'
      }
    });
    
    if (statsResult.totalLogs === 3) {
      console.log(`✅ Log buffer working correctly (${statsResult.totalLogs} logs)`);
    } else {
      throw new Error("Log buffer stats incorrect");
    }

    // Test 3: Force flush
    console.log("\nTest 3: Force buffer flush");
    const flushResult = await agent.executePrompt("flush logs", {
      skillName: 'log-buffer',
      args: {
        operation: 'flush'
      }
    });
    
    if (flushResult.success === true) {
      console.log(`✅ Log buffer flush working`);
      logTestResult('log-buffer', true, 'All tests passed');
    } else {
      throw new Error("Log buffer flush failed");
    }
  } catch (error) {
    logTestResult('log-buffer', false, `Test failed: ${error.message}`);
    console.error("❌ Log Buffer test failed:", error);
  } finally {
    await cleanupSkillSrc('log-buffer');
  }

  // --- Test Case 4: Schema Validator ---
  try {
    console.log("\n=== Testing Schema Validator ===");
    
    const testData = { user: "John", age: "25" };
    const testSchema = {
      user: { type: "string", min: 3 },
      age: { type: "number", min: 18 }
    };

    // Test: Validate data against schema
    console.log("\nTest: Data validation against schema");
    const validationResult = await agent.executePrompt("validate data", {
      skillName: 'schema-validator',
      args: {
        operation: 'validate',
        data: testData,
        schema: testSchema
      }
    });
    
    // This should fail because age is a string, not number
    if (validationResult.valid === false && validationResult.errors) {
      console.log(`✅ Schema validation working (correctly rejected invalid data)`);
      logTestResult('schema-validator', true, 'All tests passed');
    } else {
      throw new Error("Schema validation failed");
    }
  } catch (error) {
    logTestResult('schema-validator', false, `Test failed: ${error.message}`);
    console.error("❌ Schema Validator test failed:", error);
  } finally {
    await cleanupSkillSrc('schema-validator');
  }

  // --- Test Case 5: Config Loader ---
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
    const configResult = await agent.executePrompt("load configuration", {
      skillName: 'config-loader',
      args: {
        operation: 'load',
        source: configSource,
        schema: configSchema
      }
    });
    
    if (configResult.config && 
        configResult.config.DB_PORT === 5432 && 
        configResult.config.DEBUG === true) {
      console.log(`✅ Config loader working (correct type conversion)`);
      logTestResult('config-loader', true, 'All tests passed');
    } else {
      throw new Error("Config loader failed");
    }
  } catch (error) {
    logTestResult('config-loader', false, `Test failed: ${error.message}`);
    console.error("❌ Config Loader test failed:", error);
  } finally {
    await cleanupSkillSrc('config-loader');
  }

  // --- Test Case 6: Template Engine ---
  try {
    console.log("\n=== Testing Template Engine ===");
    
    const templateData = {
      user: { name: "John", age: 25 }
    };

    // Test: Render template
    console.log("\nTest: Template rendering");
    const templateResult = await agent.executePrompt("render template", {
      skillName: 'template-engine',
      args: {
        operation: 'render',
        template: "Hello {user.name}! Your age is {user.age}.",
        data: templateData
      }
    });
    
    const expectedResult = "Hello John! Your age is 25.";
    if (templateResult === expectedResult) {
      console.log(`✅ Template engine working correctly`);
      logTestResult('template-engine', true, 'All tests passed');
    } else {
      throw new Error(`Template rendering failed. Expected: "${expectedResult}", Got: "${templateResult}"`);
    }
  } catch (error) {
    logTestResult('template-engine', false, `Test failed: ${error.message}`);
    console.error("❌ Template Engine test failed:", error);
  } finally {
    await cleanupSkillSrc('template-engine');
  }

  // --- Test Case 7: Rate Limiter ---
  try {
    console.log("\n=== Testing Rate Limiter ===");
    
    // Test 1: Set rate
    console.log("\nTest 1: Set rate limit");
    await agent.executePrompt("set rate", {
      skillName: 'rate-limiter',
      args: {
        operation: 'setRate',
        rate: { tokensPerSecond: 10, burstLimit: 20 }
      }
    });

    // Test 2: Consume tokens
    console.log("\nTest 2: Consume tokens");
    const consumeResult = await agent.executePrompt("consume tokens", {
      skillName: 'rate-limiter',
      args: {
        operation: 'consume',
        tokens: 5
      }
    });
    
    if (consumeResult.success === true) {
      console.log(`✅ Rate limiter working (consumed 5 tokens)`);
    } else {
      throw new Error("Rate limiter consume failed");
    }

    // Test 3: Get status
    console.log("\nTest 3: Get rate limiter status");
    const statusResult = await agent.executePrompt("get rate status", {
      skillName: 'rate-limiter',
      args: {
        operation: 'getStatus'
      }
    });
    
    if (statusResult.tokens >= 0) {
      console.log(`✅ Rate limiter status working (remaining tokens: ${statusResult.tokens})`);
      logTestResult('rate-limiter', true, 'All tests passed');
    } else {
      throw new Error("Rate limiter status failed");
    }
  } catch (error) {
    logTestResult('rate-limiter', false, `Test failed: ${error.message}`);
    console.error("❌ Rate Limiter test failed:", error);
  } finally {
    await cleanupSkillSrc('rate-limiter');
  }

  // --- Test Case 8: Hash Utility ---
  try {
    console.log("\n=== Testing Hash Utility ===");
    
    // Test 1: Generate hash
    console.log("\nTest 1: Generate hash");
    const hashResult = await agent.executePrompt("generate hash", {
      skillName: 'hash-util',
      args: {
        operation: 'hash',
        data: 'password123',
        salt: 'testSalt123'
      }
    });
    
    if (hashResult.hash && hashResult.salt) {
      console.log(`✅ Hash generation working`);
    } else {
      throw new Error("Hash generation failed");
    }

    // Test 2: Verify hash
    console.log("\nTest 2: Verify hash");
    const verifyResult = await agent.executePrompt("verify hash", {
      skillName: 'hash-util',
      args: {
        operation: 'verify',
        data: 'password123',
        hash: hashResult.hash,
        salt: hashResult.salt
      }
    });
    
    if (verifyResult.valid === true) {
      console.log(`✅ Hash verification working`);
      logTestResult('hash-util', true, 'All tests passed');
    } else {
      throw new Error("Hash verification failed");
    }
  } catch (error) {
    logTestResult('hash-util', false, `Test failed: ${error.message}`);
    console.error("❌ Hash Utility test failed:", error);
  } finally {
    await cleanupSkillSrc('hash-util');
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
    console.log("✅ Tested 8 skills: csv-parser, simple-cache, log-buffer,");
    console.log("   schema-validator, config-loader, template-engine,");
    console.log("   rate-limiter, and hash-util");
  } else {
    console.log("\n⚠️  Some tests failed. Check the logs above for details.");
  }
}


await evalCodeGenerationPerformance();
