import { join } from 'node:path';
import { fork } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { buildArgumentExtractionPrompt } from './prompts.mjs';

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
    const mainFilePath = join(outputPath, 'index.mjs');
    try {
      const fileStat = await stat(mainFilePath);
      if (!fileStat.isFile()) {
        throw new Error(`Execution failed: Main entrypoint '${mainFilePath}' is not a file.`);
      }
    } catch (err) {
      throw new Error(`Execution failed: Main entrypoint '${mainFilePath}' not found. It should have been generated automatically.`);
    }

    const argsJson = JSON.stringify(args);
    console.log(`[CodeSkills] Executing code from disk: ${mainFilePath} with args: ${argsJson}`);

    return new Promise((resolve, reject) => {
      const child = fork(mainFilePath, [argsJson], { silent: true });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('error', (err) => {
        console.error(`[CodeSkills] Child process failed to start: ${err.message}`);
        reject(new Error(`Child process failed to start: ${err.message}`));
      });

      child.on('exit', (code, signal) => {
        if (code === 0) {
          try {
            // Assuming the child process prints the action result as JSON
            const result = JSON.parse(stdout.trim());
            resolve(result);
          } catch (e) {
            console.error(`[CodeSkills] Failed to parse child process stdout as JSON: ${e.message}\nSTDOUT:\n${stdout}`);
            reject(new Error(`Failed to parse child process stdout: ${e.message}. STDOUT: ${stdout}`));
          }
        } else {
          console.error(`[CodeSkills] Child process exited with code ${code || signal}. STDERR:\n${stderr}`);
          reject(new Error(`Child process exited with code ${code || signal}. STDERR: ${stderr}`));
        }
      });
    });
  }
}