import {join} from 'node:path';
import {stat} from 'node:fs/promises';
import {buildArgumentExtractionPrompt} from './prompts.mjs';
import { parseSkillDocument } from '../utils/skillDocumentParser.mjs';

// Timestamp helper for logging
const getTimestamp = () => {
    const now = new Date();
    return now.toISOString().slice(11, 23); // HH:MM:SS.mmm
};

// Debug logging configuration
const DEBUG_ENABLED = String(process.env.ACHILLES_DEBUG ?? '').toLowerCase() === 'true';

function debugLog(message, ...args) {
  if (DEBUG_ENABLED) {
    console.log(`[CodeSkills DEBUG] ${message}`, ...args);
  }
}

function debugError(...args) {
  if (DEBUG_ENABLED) console.error(...args);
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
  constructor({ llmAgent, modelConfig = null }) {
    this.llmAgent = llmAgent;
    this.modelConfig = modelConfig || { plan: 'plan', code: 'code' };
  }

  parseSkillDescriptor({ filePath }) {
    return parseSkillDocument(filePath);
  }

  async executeSkillPrompt({ skillRecord, recursiveAgent, promptText, options }) {
    this.llmAgent = recursiveAgent.llmAgent;
    const specifications = this.getSpecifications(skillRecord);
    
    if (!specifications.inputFormat) {
      throw new Error("Invalid/unprepared cskill: Missing 'Input Format' section in the skill's .md file.");
    }

    // Always pass the prompt directly; never extract via LLM
    const args = {
      promptText
    };
    debugLog(`Executing skill "${skillRecord.shortName}" with prompt: ${args.promptText.substring(0, 200)}...`);
    args.llmAgent = this.llmAgent;
    args.recursiveAgent = recursiveAgent;
    
    // Pass through context, sessionMemory, user, and attachments from options.
    const executionContext = options?.context || {};
    Object.assign(args, executionContext);
    args.context = executionContext;
    args.sessionMemory = executionContext.sessionMemory || null;
    args.user = executionContext.user || null;
    args.attachments = executionContext.attachments || [];

    // Execute the already generated code from disk
    const outputPath = skillRecord.skillDir;
    const result = await this.executeCodeFromDisk(outputPath, args);
    debugLog(`Execution completed, result: ${JSON.stringify(result).substring(0, 200)}`);
    
    return {
      skill: skillRecord.name,
      preparedConfig: skillRecord.preparedConfig || null,
      result,
      sessionMemory: null,
    };
  }

  getSpecifications(skillRecord) {
    const specifications = camelCaseKeys(skillRecord.descriptor.sections);
    if (skillRecord.descriptor.name) {
      specifications.name = skillRecord.descriptor.name;
    }
    if (skillRecord.descriptor.rawContent) {
      specifications.rawContent = skillRecord.descriptor.rawContent;
    }
    return specifications;
  }

  async extractArguments(userPrompt, specifications) {
    debugLog('Extracting arguments with LLM.');
    const prompt = buildArgumentExtractionPrompt(userPrompt, specifications.inputFormat);
    const response = await this.llmAgent.executePrompt(prompt, { responseShape: 'json', model: this.modelConfig.plan || 'plan' });
    if (response.error || !response.args) {
      throw new Error(`Argument extraction failed: ${response.error || 'LLM did not return an "args" object.'}`);
    }
    return response.args;
  }

  async executeCodeFromDisk(outputPath, args) {
    // Try both index.mjs and index.js, preferring index.mjs
    const possibleMainFiles = ['src/index.mjs', 'src/index.js'];
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
        return await module.action(args);
      
    } catch (error) {
      debugError(`[CodeSkills] Dynamic import execution failed: ${error.message}`);
      debugError(`[CodeSkills] Error stack: ${error.stack}`);
      throw new Error(`Execution failed: ${error.message}`);
    }
  }
}
