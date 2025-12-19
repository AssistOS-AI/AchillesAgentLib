import {join} from 'node:path';
import {stat} from 'node:fs/promises';
import {buildArgumentExtractionPrompt} from './prompts.mjs';

// Debug logging configuration
const DEBUG_ENABLED = String(process.env.ACHILLES_DEBUG ?? process.env.ACHILES_DEBUG ?? '').toLowerCase() === 'true';

function debugLog(message, ...args) {
  if (DEBUG_ENABLED) {
    console.log(`[CodeSkills DEBUG] ${message}`, ...args);
  }
}

function camelCaseKeys(obj) {
  if (!obj) return {};
  const newObj = {};
  for (const key in obj) {
    const camelCasedKey = key.replace(/-(\w)/g, (_, c) => c.toUpperCase());
    newObj[camelCasedKey] = obj[key];
  }
  return newObj;
}

export class CodeSkillsSubsystem {
  constructor({ llmAgent }) {
    this.llmAgent = llmAgent;
  }

  async executeSkillPrompt({ skillRecord, recursiveAgent, promptText, options }) {
    debugLog(`Starting executeSkillPrompt for: ${skillRecord.name}`);

    this.llmAgent = recursiveAgent.llmAgent;
    const specifications = this.getSpecifications(skillRecord);
    
    debugLog(`Specifications loaded, inputFormat: ${!!specifications.inputFormat}`);
    if (!specifications.inputFormat) {
      throw new Error("Invalid/unprepared cskill: Missing 'Input Format' section in the skill's .md file.");
    }

    // Use pre-provided args if available (ignoring the default 'input' key),
    // otherwise extract from prompt using LLM
    let args;
    const providedArgs = options?.args || {};
    const hasExplicitArgs = Object.keys(providedArgs).some(key => key !== 'input');

    if (hasExplicitArgs) {
      debugLog(`Using pre-provided args from options...`);
      args = providedArgs;
    } else {
      debugLog(`Extracting arguments from prompt...`);
      args = await this.extractArguments(promptText, specifications);
    }
    debugLog(`Arguments: ${JSON.stringify(args).substring(0, 200)}...`);
    
    // Execute the already generated code from disk
    debugLog(`Executing code from disk...`);
    const outputPath = join(skillRecord.skillDir, 'src');
    const result = await this.executeCodeFromDisk(outputPath, args);
    debugLog(`Execution completed, result type: ${typeof result}`);
    
    return result;
  }

  getSpecifications(skillRecord) {
    const specifications = camelCaseKeys(skillRecord.descriptor.sections);
    if (skillRecord.descriptor.summary) {
      specifications.summary = skillRecord.descriptor.summary;
    }
    if (skillRecord.descriptor.title) {
        specifications.title = skillRecord.descriptor.title;
    }
    return specifications;
  }

  async extractArguments(userPrompt, specifications) {
    console.log('[CodeSkills] Extracting arguments with LLM.');
    const prompt = buildArgumentExtractionPrompt(userPrompt, specifications.inputFormat);
    const response = await this.llmAgent.executePrompt(prompt, { responseShape: 'json', mode: 'fast' });
    if (response.error || !response.args) {
      throw new Error(`Argument extraction failed: ${response.error || 'LLM did not return an "args" object.'}`);
    }
    return response.args;
  }

  async executeCodeFromDisk(outputPath, args) {
    // Try both index.mjs and index.js, preferring index.mjs
    const possibleMainFiles = ['index.mjs', 'index.js'];
    let mainFilePath = null;
    let modulePath = null;
    
    for (const fileName of possibleMainFiles) {
      const testPath = join(outputPath, fileName);
      try {
        const fileStat = await stat(testPath);
        if (fileStat.isFile()) {
          mainFilePath = testPath;
          // Convert to file URL for dynamic import
          modulePath = `file://${testPath}`;
          break;
        }
      } catch (err) {
        // File doesn't exist, continue to next option
        continue;
      }
    }
    
    if (!mainFilePath) {
      throw new Error(`Execution failed: No valid entrypoint found. Tried: ${possibleMainFiles.map(f => join(outputPath, f)).join(', ')}. It should have been generated automatically.`);
    }

    const argsJson = JSON.stringify(args);

    // Validate that the main file exists and is accessible
    try {
      await stat(mainFilePath);
    } catch (err) {
      throw new Error(`Execution failed: Main entrypoint '${mainFilePath}' is not accessible: ${err.message}`);
    }

    try {
      // Use dynamic import to load the module
      const module = await import(modulePath);
      
      // Check if the module has the expected action function
      if (typeof module.action !== 'function') {
        throw new Error(`Execution failed: Module '${mainFilePath}' does not export an 'action' function.`);
      }

      // Execute the action function directly
        return await module.action(JSON.parse(argsJson));
      
    } catch (error) {
      console.error(`[CodeSkills] Dynamic import execution failed: ${error.message}`);
      console.error(`[CodeSkills] Error stack: ${error.stack}`);
      throw new Error(`Execution failed: ${error.message}`);
    }
  }
}