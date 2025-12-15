import {SourceTextModule, createContext} from 'node:vm';
import {readdirSync, readFileSync, statSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {buildArgumentExtractionPrompt, buildCodeGenerationPrompt} from './prompts.mjs';

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
    constructor({llmAgent}) {
        this.llmAgent = llmAgent;
    }

    readExternalSpecs(basePath) {
        let allSpecsContent = '';
        const filesToRead = readdirSync(basePath);

        for (const file of filesToRead) {
            const fullPath = join(basePath, file);
            const stat = statSync(fullPath);

            if (stat.isDirectory()) {
                allSpecsContent += this.readExternalSpecs(fullPath);
            } else if (file.endsWith('.md') || file.endsWith('.mds')) {
                const fileContent = readFileSync(fullPath, 'utf-8');
                allSpecsContent += `# File: ${fullPath}\n---\n${fileContent}\n---\n\n`;
            }
        }
        return allSpecsContent;
    }

    async executeSkillPrompt({skillRecord, recursiveAgent, promptText, options}) {
        this.llmAgent = recursiveAgent.llmAgent;

        if (!skillRecord.descriptor || !skillRecord.descriptor.sections) {
            throw new Error("Skill record is missing the pre-parsed descriptor sections.");
        }
        const specifications = camelCaseKeys(skillRecord.descriptor.sections);

        if (skillRecord.descriptor.summary) {
            specifications.summary = skillRecord.descriptor.summary;
        }

        if (!specifications.specsPath) {
            throw new Error("Invalid csskill.md format: Missing 'Specs Path' section.");
        }
        if (!specifications.inputFormat || !specifications.outputFormat) {
            throw new Error("Invalid csskill.md format: Missing 'Input Format' or 'Output Format' sections.");
        }

        const specsDir = resolve(skillRecord.skillDir, specifications.specsPath);
        const externalSpecsContent = this.readExternalSpecs(specsDir);

        const args = await this.extractArguments(promptText, specifications.inputFormat);
        const generatedMarkdown = await this.generateCode(specifications, args, externalSpecsContent);
        const result = await this.executeGeneratedCode(generatedMarkdown, args);

        return result;
    }

    async extractArguments(userPrompt, inputFormat) {
        const prompt = buildArgumentExtractionPrompt(userPrompt, inputFormat);
        const response = await this.llmAgent.executePrompt(prompt, {responseShape: 'json', mode: 'fast'});

        if (response.error) {
            throw new Error(`Failed to extract arguments: ${response.error}`);
        }
        if (!response.args) {
            throw new Error(`Argument extraction failed. LLM did not return an "args" object. Response: ${JSON.stringify(response)}`);
        }
        return response.args;
    }

    async generateCode(specifications, args, externalSpecsContent) {
        const prompt = buildCodeGenerationPrompt(specifications, args, externalSpecsContent);
        return await this.llmAgent.executePrompt(prompt, {mode: 'deep'});
    }

    parseVirtualModules(markdown) {
        const modules = new Map();
        const fileRegex = /##\s*file-path:\s*([^\s]+)\s*\n+```javascript\n([\s\S]+?)\n```/g;

        let match;
        while ((match = fileRegex.exec(markdown)) !== null) {
            const [, filePath, code] = match;
            modules.set(filePath, code);
        }

        return modules;
    }

    async executeGeneratedCode(markdownCode, args) {
        const virtualModules = this.parseVirtualModules(markdownCode);
        if (!virtualModules.has('index.mjs')) {
            throw new Error("Code generation failed: The main entrypoint 'index.mjs' was not found in the LLM's response.");
        }

        const context = createContext({console, args});
        const moduleCache = new Map();

        const linker = async (specifier, referencingModule) => {
            if (moduleCache.has(specifier)) {
                return moduleCache.get(specifier);
            }
            if (virtualModules.has(specifier)) {
                const code = virtualModules.get(specifier);
                const module = new SourceTextModule(code, {
                    identifier: specifier,
                    context: referencingModule.context,
                });
                await module.link(linker);
                moduleCache.set(specifier, module);
                return module;
            }

            if (specifier.startsWith('node:')) {
                const builtIn = await import(specifier);
                const exportNames = Object.keys(builtIn);
                const syntheticModule = new SourceTextModule(
                    exportNames.map(name => `export const ${name} = await import('${specifier}').then(m => m.${name});`).join('\n')
                );
                await syntheticModule.link(linker);
                await syntheticModule.evaluate();
                moduleCache.set(specifier, syntheticModule);
                return syntheticModule;
            }

            throw new Error(`Unable to resolve import specifier: '${specifier}'.`);
        };

        const mainModule = new SourceTextModule(virtualModules.get('index.mjs'), {
            identifier: 'index.mjs',
            context,
        });

        await mainModule.link(linker);
        await mainModule.evaluate({timeout: 5000});

        const {action} = mainModule.namespace;

        if (typeof action !== 'function') {
            throw new Error("Execution failed: 'index.mjs' does not export an 'action' function.");
        }

        try {
            const result = await action(args);
            return result;
        } catch (error) {
            throw new Error(`Error during generated code execution: ${error.message}`);
        }
    }
}
