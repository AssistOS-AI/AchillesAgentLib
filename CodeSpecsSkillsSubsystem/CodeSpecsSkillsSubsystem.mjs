import { readdir, readFile, stat, mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fork } from 'node:child_process';
import { buildArgumentExtractionPrompt, buildCodeGenerationPrompt } from './prompts.mjs';

function camelCaseKeys(obj) {
  if (!obj) return {};
  const newObj = {};
  for (const key in obj) {
    const camelCasedKey = key.replace(/-(\w)/g, (_, c) => c.toUpperCase());
    newObj[camelCasedKey] = obj[key];
  }
  return newObj;
}

export class CodeSpecsSkillsSubsystem {
  constructor({ llmAgent }) {
    this.llmAgent = llmAgent;
  }

  async prepareSkill(skillRecord) {
    console.log(`[CodeSpecs] Preparing skill: ${skillRecord.name}`);
    
    // Use specs folder convention - it should be in the skill directory alongside csskill.md
    const specsDir = resolve(skillRecord.skillDir, 'specs');
    
    // Check if specs directory exists
    let specsExist = false;
    try {
      const specsStat = await stat(specsDir);
      specsExist = specsStat.isDirectory();
    } catch (err) {
      specsExist = false;
    }
    
    if (!specsExist) {
      console.warn(`[CodeSpecs] WARN: Specs directory '${specsDir}' does not exist. Skipping code generation.`);
      return;
    }
    
    const specifications = this.getSpecifications(skillRecord);
    const { content: externalSpecsContent, signature } = await this.readExternalSpecs(specsDir);
    
    // Check if code needs to be regenerated
    const needsRegeneration = await this.checkIfRegenerationNeeded(skillRecord, signature);
    
    if (needsRegeneration) {
      console.log(`[CodeSpecs] Specs have changed or src folder doesn't exist. Regenerating code...`);
      const generatedMarkdown = await this.generateCode(specifications, {}, externalSpecsContent);
      
      // Write generated code to skillDir/src/
      const outputPath = join(skillRecord.skillDir, 'src');
      await this.writeGeneratedCodeToDisk(outputPath, generatedMarkdown);
      
      // Cache the signature of the specs for rebuild detection
      skillRecord.specsSignature = signature;
    } else {
      console.log(`[CodeSpecs] Specs unchanged. Using existing generated code.`);
    }
    
    console.log(`[CodeSpecs] Finished preparing skill: ${skillRecord.name}.`);
  }

  async executeSkillPrompt({ skillRecord, recursiveAgent, promptText, options }) {
    this.llmAgent = recursiveAgent.llmAgent;
    const specifications = this.getSpecifications(skillRecord);
    if (!specifications.inputFormat) {
      throw new Error("Invalid/unprepared csskill: Missing 'Input Format'.");
    }

    const args = await this.extractArguments(promptText, specifications);
    
    // Execute the already generated code from disk
    const outputPath = join(skillRecord.skillDir, 'src');
    const result = await this.executeCodeFromDisk(outputPath, args);
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

  async readExternalSpecs(basePath, fileList = []) {
    const files = await readdir(basePath);

    for (const file of files) {
      const fullPath = join(basePath, file);
      const fileStat = await stat(fullPath);
      if (fileStat.isDirectory()) {
        await this.readExternalSpecs(fullPath, fileList);
      } else if (file.endsWith('.md') || file.endsWith('.mds')) {
        fileList.push({ path: fullPath, mtime: fileStat.mtime.getTime() });
      }
    }

    fileList.sort((a, b) => a.path.localeCompare(b.path));

    let allSpecsContent = '';
    let signature = '';
    for (const file of fileList) {
      const fileContent = await readFile(file.path, 'utf-8');
      allSpecsContent += `# File: ${file.path}\n---\n${fileContent}\n---\n\n`;
      signature += `${file.path}=${file.mtime};`;
    }

    return { content: allSpecsContent, signature };
  }

  async checkIfRegenerationNeeded(skillRecord, currentSignature) {
    // Check if src folder exists
    const srcPath = join(skillRecord.skillDir, 'src');
    let srcExists = false;
    try {
      const srcStat = await stat(srcPath);
      srcExists = srcStat.isDirectory();
    } catch (err) {
      srcExists = false;
    }
    
    // If src folder doesn't exist, we need to generate code
    if (!srcExists) {
      return true;
    }
    
    // If we have a cached signature and it matches current, no regeneration needed
    if (skillRecord.specsSignature && skillRecord.specsSignature === currentSignature) {
      return false;
    }
    
    // Otherwise, regeneration is needed
    return true;
  }

  async extractArguments(userPrompt, specifications) {
    console.log('[CodeSpecs] Extracting arguments with LLM.');
    const prompt = buildArgumentExtractionPrompt(userPrompt, specifications.inputFormat);
    const response = await this.llmAgent.executePrompt(prompt, { responseShape: 'json', mode: 'fast' });
    if (response.error || !response.args) {
      throw new Error(`Argument extraction failed: ${response.error || 'LLM did not return an "args" object.'}`);
    }
    return response.args;
  }

  async generateCode(specifications, args, externalSpecsContent) {
    const prompt = buildCodeGenerationPrompt(specifications, args, externalSpecsContent);
    return await this.llmAgent.executePrompt(prompt, { mode: 'deep' });
  }
  
  parseMarkdownCodeBlocks(markdown) {
    const codeBlocks = new Map();
    const fileBlockPattern = /##\s*file-path:\s*([^\s]+)\s*\n+```javascript\n([\s\S]+?)\n```/g;
    let match;
    while ((match = fileBlockPattern.exec(markdown)) !== null) {
      codeBlocks.set(match[1], match[2]);
    }
    return codeBlocks;
  }

  async writeGeneratedCodeToDisk(outputPath, generatedMarkdown) {
    console.log(`[CodeSpecs] Writing generated code to disk: ${outputPath}`);
    // Ensure the output directory exists and is clean
    try {
      const outputStat = await stat(outputPath);
      if (outputStat.isDirectory()) {
        await rm(outputPath, { recursive: true, force: true });
      }
    } catch (err) {
      // Directory doesn't exist, which is fine
    }
    await mkdir(outputPath, { recursive: true });

    const codeBlocks = this.parseMarkdownCodeBlocks(generatedMarkdown);
    if (!codeBlocks.has('index.mjs')) {
      throw new Error("Code generation failed: 'index.mjs' not found in generated markdown.");
    }

    for (const [filePath, code] of codeBlocks.entries()) {
      const fullPath = join(outputPath, filePath);
      const dir = join(fullPath, '..');
      await mkdir(dir, { recursive: true }); // Ensure subdirectories exist
      await writeFile(fullPath, code, 'utf-8');
      console.log(`[CodeSpecs] Wrote: ${fullPath}`);
    }
  }

  async executeCodeFromDisk(outputPath, args) {
    const mainFilePath = join(outputPath, 'index.mjs');
    try {
      const fileStat = await stat(mainFilePath);
      if (!fileStat.isFile()) {
        throw new Error(`Execution failed: Main entrypoint '${mainFilePath}' is not a file.`);
      }
    } catch (err) {
      throw new Error(`Execution failed: Main entrypoint '${mainFilePath}' not found.`);
    }

    const argsJson = JSON.stringify(args);
    console.log(`[CodeSpecs] Executing code from disk: ${mainFilePath} with args: ${argsJson}`);

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
        console.error(`[CodeSpecs] Child process failed to start: ${err.message}`);
        reject(new Error(`Child process failed to start: ${err.message}`));
      });

      child.on('exit', (code, signal) => {
        if (code === 0) {
          try {
            // Assuming the child process prints the action result as JSON
            const result = JSON.parse(stdout.trim());
            resolve(result);
          } catch (e) {
            console.error(`[CodeSpecs] Failed to parse child process stdout as JSON: ${e.message}\nSTDOUT:\n${stdout}`);
            reject(new Error(`Failed to parse child process stdout: ${e.message}. STDOUT: ${stdout}`));
          }
        } else {
          console.error(`[CodeSpecs] Child process exited with code ${code || signal}. STDERR:\n${stderr}`);
          reject(new Error(`Child process exited with code ${code || signal}. STDERR: ${stderr}`));
        }
      });
    });
  }
}