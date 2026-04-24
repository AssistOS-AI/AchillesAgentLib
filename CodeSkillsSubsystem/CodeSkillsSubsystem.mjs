import { join, resolve } from 'node:path';
import { stat, readdir } from 'node:fs/promises';
import { buildArgumentExtractionPrompt } from './prompts.mjs';
import { parseSkillDocument } from '../utils/skillDocumentParser.mjs';

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

async function fileExists(filePath) {
  try {
    const s = await stat(filePath);
    return s.isFile();
  } catch {
    return false;
  }
}

async function dirExists(dirPath) {
  try {
    const s = await stat(dirPath);
    return s.isDirectory();
  } catch {
    return false;
  }
}

export class CodeSkillsSubsystem {
  constructor({ llmAgent, modelConfig = null }) {
    this.llmAgent = llmAgent;
    this.modelConfig = modelConfig || { plan: 'plan', code: 'code' };
    this._generating = new Map();
  }

  parseSkillDescriptor({ filePath }) {
    return parseSkillDocument(filePath);
  }

  prepareSkill(skillRecord) {
    const sections = skillRecord.descriptor?.sections || {};
    const skillDir = skillRecord.skillDir;

    skillRecord.preparedConfig = {
      type: 'cskill',
      name: skillRecord.descriptor?.name || null,
      rawContent: skillRecord.descriptor?.rawContent || null,
      sections,
      skillDir,
      hasSpecs: false,
      needsGeneration: false,
    };

    if (!skillDir) return;

    const specsDir = join(skillDir, 'specs');
    const entryPoints = [join(skillDir, 'src', 'index.mjs'), join(skillDir, 'src', 'index.js')];

    Promise.all([dirExists(specsDir), ...entryPoints.map(fileExists)]).then(
      ([specsExist, hasMjs, hasJs]) => {
        const hasCode = hasMjs || hasJs;
        skillRecord.preparedConfig.hasSpecs = specsExist;
        skillRecord.preparedConfig.needsGeneration = specsExist && !hasCode;
      },
      () => {}
    );
  }

  async executeSkillPrompt({ skillRecord, mainAgent, promptText, options }) {
    this.llmAgent = mainAgent.llmAgent;
    const specifications = this.getSpecifications(skillRecord);

    if (!specifications.inputFormat) {
      throw new Error("Invalid/unprepared cskill: Missing 'Input Format' section in the skill's .md file.");
    }

    await this._ensureCodeGenerated(skillRecord, mainAgent);

    const args = {
      promptText
    };
    debugLog(`Executing skill "${skillRecord.shortName}" with prompt: ${args.promptText.substring(0, 200)}...`);
    args.llmAgent = this.llmAgent;

    const executionContext = options?.context || {};
    Object.assign(args, executionContext);
    args.context = executionContext;

    const outputPath = skillRecord.skillDir;
    const result = await this.executeCodeFromDisk(outputPath, args);
    debugLog(`Execution completed, result: ${JSON.stringify(result).substring(0, 200)}`);

    return {
      skill: skillRecord.name,
      preparedConfig: skillRecord.preparedConfig || null,
      result,
    };
  }

  async _ensureCodeGenerated(skillRecord, mainAgent) {
    const skillDir = skillRecord.skillDir;
    if (!skillDir) return;

    const entryPoints = [join(skillDir, 'src', 'index.mjs'), join(skillDir, 'src', 'index.js')];
    const hasCode = (await Promise.all(entryPoints.map(fileExists))).some(Boolean);
    if (hasCode) return;

    if (this._generating.has(skillDir)) {
      await this._generating.get(skillDir);
      return;
    }

    const specsDir = join(skillDir, 'specs');
    if (!(await dirExists(specsDir))) {
      throw new Error(`Execution failed: No valid entrypoint found and no specs/ directory. Tried: ${entryPoints.map(f => join(skillDir, f)).join(', ')}. It should have been generated automatically.`);
    }

    const generationPromise = mainAgent.executeSkill('mirror-code-generator', skillDir);
    this._generating.set(skillDir, generationPromise);

    try {
      const result = await generationPromise;
      debugLog(`Code generated for "${skillRecord.shortName}": ${JSON.stringify(result?.result)}`);
    } finally {
      this._generating.delete(skillDir);
    }
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
    const possibleMainFiles = ['src/index.mjs', 'src/index.js'];
    let mainFilePath = null;
    let modulePath = null;

    for (const fileName of possibleMainFiles) {
      const testPath = join(outputPath, fileName);
      try {
        const fileStat = await stat(testPath);
        if (fileStat.isFile()) {
          mainFilePath = testPath;
          modulePath = `file://${testPath}`;
          break;
        }
      } catch {
        continue;
      }
    }

    if (!mainFilePath) {
      throw new Error(`Execution failed: No valid entrypoint found. Tried: ${possibleMainFiles.map(f => join(outputPath, f)).join(', ')}. It should have been generated automatically.`);
    }

    try {
      await stat(mainFilePath);
    } catch (err) {
      throw new Error(`Execution failed: Main entrypoint '${mainFilePath}' is not accessible: ${err.message}`);
    }

    try {
      const module = await import(modulePath);

      if (typeof module.action !== 'function') {
        throw new Error(`Execution failed: Module '${mainFilePath}' does not export an 'action' function.`);
      }

      return await module.action(args);

    } catch (error) {
      debugError(`[CodeSkills] Dynamic import execution failed: ${error.message}`);
      debugError(`[CodeSkills] Error stack: ${error.stack}`);
      throw new Error(`Execution failed: ${error.message}`);
    }
  }
}
