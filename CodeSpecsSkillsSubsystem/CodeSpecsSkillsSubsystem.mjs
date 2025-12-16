import { readdir, readFile, stat, mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fork } from 'node:child_process';
import { buildArgumentExtractionPrompt, buildCodeGenerationPrompt } from './prompts.mjs';

// Debug logging configuration
const DEBUG_ENABLED = String(process.env.ACHILLES_DEBUG ?? process.env.ACHILES_DEBUG ?? '').toLowerCase() === 'true';

function debugLog(message, ...args) {
  if (DEBUG_ENABLED) {
    console.log(`[CodeSpecs DEBUG] ${message}`, ...args);
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

export class CodeSpecsSkillsSubsystem {
  constructor({ llmAgent }) {
    this.llmAgent = llmAgent;
  }

  async prepareSkill(skillRecord) {
    console.log(`[CodeSpecs] Preparing skill: ${skillRecord.name}`);
    
    debugLog(`Skill directory: ${skillRecord.skillDir}`);
    // Use specs folder convention - it should be in the skill directory alongside csskill.md
    const specsDir = resolve(skillRecord.skillDir, 'specs');
    debugLog(`Specs directory: ${specsDir}`);
    
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

    const result = await this.readExternalSpecsWithFiles(specsDir);
    debugLog(`readExternalSpecsWithFiles result: ${JSON.stringify({
      hasContent: !!result.content,
      hasSignature: !!result.signature,
      hasFileSpecs: !!result.fileSpecs,
      fileSpecsCount: result.fileSpecs?.length || 0
    })}`);

    if (!result.signature) {
      console.error(`[CodeSpecs] ERROR: No signature returned from readExternalSpecsWithFiles`);
      return;
    }
    const { signature, fileSpecs } = result;

    // Check if code needs to be regenerated
    const needsRegeneration = await this.checkIfRegenerationNeeded(skillRecord, signature);
    
    debugLog(`Regeneration needed: ${needsRegeneration}`);
    if (needsRegeneration) {

        const specifications = this.getSpecifications(skillRecord);
      debugLog(`Generating code from specifications...`);
      console.log(`[CodeSpecs] Specs have changed or src folder doesn't exist. Regenerating code...`);
      
      // New approach: Generate code file by file
      debugLog(`Using file-by-file generation approach for ${fileSpecs.length} specification files`);
      const outputPath = join(skillRecord.skillDir, 'src');
      
      // Ensure output directory exists and is clean
      try {
        const outputStat = await stat(outputPath);
        if (outputStat.isDirectory()) {
          await rm(outputPath, { recursive: true, force: true });
        }
      } catch (err) {
        // Directory doesn't exist, which is fine
      }
      await mkdir(outputPath, { recursive: true });
      
      // Generate each file individually
      let filesGenerated = 0;
      let filesFailed = 0;
      
      for (const [relativePath, specContent] of fileSpecs) {
        try {
          debugLog(`Generating code for: ${relativePath}`);
          
          // Generate code for this specific file
          const fileCode = await this.generateSingleFileCode(specifications, specContent, relativePath);
          
          if (!fileCode || typeof fileCode !== 'string') {
            console.warn(`[CodeSpecs] WARN: Failed to generate code for ${relativePath} - empty or invalid response`);
            filesFailed++;
            continue;
          }
          
          // Write the file
          const outputFilePath = join(outputPath, relativePath);
          const outputDir = dirname(outputFilePath);
          await mkdir(outputDir, { recursive: true });
          await writeFile(outputFilePath, fileCode, 'utf-8');
          
          debugLog(`Successfully generated: ${relativePath}`);
          filesGenerated++;
          
        } catch (error) {
          console.warn(`[CodeSpecs] WARN: Failed to generate ${relativePath}: ${error.message}`);
          debugLog(`Generation error for ${relativePath}: ${error.stack}`);
          filesFailed++;
        }
      }
      
      // Check if we generated the main entrypoint
      const indexFilePath = join(outputPath, 'index.mjs');
      let indexFileExists = false;
      try {
        await stat(indexFilePath);
        indexFileExists = true;
      } catch (err) {
        indexFileExists = false;
      }
      
      if (!indexFileExists) {
        console.error(`[CodeSpecs] ERROR: Main entrypoint 'index.mjs' was not generated. Check your specifications.`);
        console.error(`[CodeSpecs] Generated ${filesGenerated} files, failed ${filesFailed} files.`);
      } else {
        console.log(`[CodeSpecs] Code generation completed: ${filesGenerated} files generated, ${filesFailed} files failed`);
      }
      
      // Cache the signature of the specs for rebuild detection
      skillRecord.specsSignature = signature;
      debugLog(`Cached signature: ${signature.substring(0, 50)}...`);
      
    } else {
      debugLog(`Using cached code - no regeneration needed`);
      console.log(`[CodeSpecs] Specs unchanged. Using existing generated code.`);
    }
    
    console.log(`[CodeSpecs] Finished preparing skill: ${skillRecord.name}.`);
  }

  async executeSkillPrompt({ skillRecord, recursiveAgent, promptText, options }) {
    debugLog(`Starting executeSkillPrompt for: ${skillRecord.name}`);

    this.llmAgent = recursiveAgent.llmAgent;
    const specifications = this.getSpecifications(skillRecord);
    
    debugLog(`Specifications loaded, inputFormat: ${!!specifications.inputFormat}`);
    if (!specifications.inputFormat) {
      throw new Error("Invalid/unprepared csskill: Missing 'Input Format'.");
    }

    debugLog(`Extracting arguments from prompt...`);
    const args = await this.extractArguments(promptText, specifications);
    debugLog(`Arguments extracted: ${JSON.stringify(args).substring(0, 200)}...`);
    
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
  
  async readExternalSpecsWithFiles(specsDir) {
    const result = await this.readExternalSpecs(specsDir);
    
    // Also collect individual spec files for file-by-file generation
    const fileSpecs = [];
    
    async function collectSpecFiles(basePath, currentPath = '') {
      const fullPath = join(basePath, currentPath);
      const files = await readdir(fullPath);
      
      for (const file of files) {
        const filePath = join(fullPath, file);
        const fileStat = await stat(filePath);
        
        if (fileStat.isDirectory()) {
          await collectSpecFiles(basePath, join(currentPath, file));
        } else if (file.endsWith('.md') || file.endsWith('.mds')) {
          const relativePath = currentPath ? join(currentPath, file) : file;
          // Convert spec file path to JS file path (specs/index.js.md -> index.mjs)
          const jsPath = relativePath
            .replace(/(?:\.js)?\.md$/, '.mjs')
            .replace(/(?:\.js)?\.mds$/, '.js');
          
          try {
            const fileContent = await readFile(filePath, 'utf-8');
            fileSpecs.push([jsPath, fileContent]);
          } catch (readError) {
            console.warn(`[CodeSpecs] WARN: Could not read spec file ${relativePath}: ${readError.message}`);
          }
        }
      }
    }
    
    await collectSpecFiles(specsDir);
    
    return {
      content: result.content,
      signature: result.signature,
      fileSpecs
    };
  }

  async generateSingleFileCode(specifications, specContent, relativePath) {
    // Create a focused prompt for generating a single file
    const filePrompt = `You are a senior software developer creating a single JavaScript/ESM module.
    
    Generate ONLY the JavaScript code for this module. Do NOT include any markdown, backticks, 
    or file path annotations. Return ONLY the raw JavaScript code.
    
    The module should be generated based on this specification:
    
    --- BEGIN SPECIFICATION ---
    ${specContent}
    --- END SPECIFICATION ---
    
    This file will be located at: ${relativePath}
    
    IMPORTANT: Return ONLY the JavaScript code, nothing else!`;
    
    try {
      debugLog(`Generating single file: ${relativePath}`);
      const response = await this.llmAgent.executePrompt(filePrompt, { mode: 'deep' });
      
      // The response should be pure JavaScript code
      if (typeof response !== 'string') {
        debugLog(`Unexpected response type for ${relativePath}: ${typeof response}`);
        return null;
      }
      
      // Clean up any accidental markdown or annotations
      let cleanedCode = response
        // Remove markdown code blocks
        .replace(/```javascript\n?/g, '')
        .replace(/```\n?/g, '')
        // Remove file path annotations
        .replace(/##\s*file-path:\s*[^\n]+\n+/g, '')
        // Remove leading/trailing whitespace
        .trim();
      
      debugLog(`Successfully generated ${relativePath}, ${cleanedCode.length} characters`);
      return cleanedCode;
      
    } catch (error) {
      debugLog(`Error generating ${relativePath}: ${error.message}`);
      return null;
    }
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