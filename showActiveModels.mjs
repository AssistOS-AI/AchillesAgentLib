#!/usr/bin/env node
/**
 * Show Active Models
 * 
 * Displays the currently configured fast and deep models
 * based on LLMConfig.json and .env overrides.
 * 
 * Usage: node showActiveModels.mjs
 */

import { listModelsFromCache, loadModelsConfiguration } from './utils/LLMClient.mjs';

const COLORS = {
    RESET: '\x1b[0m',
    RED: '\x1b[31m',
    GREEN: '\x1b[32m',
    YELLOW: '\x1b[33m',
    CYAN: '\x1b[36m',
    GRAY: '\x1b[90m',
    BOLD: '\x1b[1m',
};

function printSection(title, models, defaultModel) {
    console.log(`\n${COLORS.BOLD}${COLORS.CYAN}=== ${title} ===${COLORS.RESET}`);
    
    if (models.length === 0) {
        console.log(`  ${COLORS.YELLOW}(no models available)${COLORS.RESET}`);
        return;
    }

    for (let i = 0; i < models.length; i++) {
        const model = models[i];
        const isDefault = model.name === defaultModel;
        const isPriority = i === 0;
        
        let badge = '';
        if (isPriority) badge += `${COLORS.GREEN}[1st]${COLORS.RESET} `;
        if (isDefault) badge += `${COLORS.YELLOW}[default]${COLORS.RESET} `;
        
        const hasKey = model.apiKeyEnv ? (process.env[model.apiKeyEnv] ? COLORS.GREEN + 'YES' : COLORS.RED + 'NO') : COLORS.GRAY + 'N/A';
        
        console.log(`  ${badge}${COLORS.BOLD}${model.name}${COLORS.RESET}`);
        console.log(`      Provider: ${model.providerKey}`);
        console.log(`      API Key: ${model.apiKeyEnv || 'none'} (${hasKey}${COLORS.RESET})`);
        if (model.qualifiedName) {
            console.log(`      Qualified: ${model.qualifiedName}`);
        }
    }
}

function main() {
    console.log(`${COLORS.BOLD}${COLORS.CYAN}Active LLM Models Configuration${COLORS.RESET}`);
    console.log(`${COLORS.GRAY}Models are listed in priority order (first = highest priority)${COLORS.RESET}`);
    
    const config = loadModelsConfiguration();
    const models = listModelsFromCache();
    
    // Show env overrides
    console.log(`\n${COLORS.BOLD}Environment Overrides:${COLORS.RESET}`);
    const envFast = process.env.ACHILLES_ENABLED_FAST_MODELS;
    const envDeep = process.env.ACHILLES_ENABLED_DEEP_MODELS;
    const envDefaultFast = process.env.ACHILLES_DEFAULT_FAST_MODEL;
    const envDefaultDeep = process.env.ACHILLES_DEFAULT_DEEP_MODEL;
    
    if (envFast) console.log(`  ACHILLES_ENABLED_FAST_MODELS: ${envFast}`);
    if (envDeep) console.log(`  ACHILLES_ENABLED_DEEP_MODELS: ${envDeep}`);
    if (envDefaultFast) console.log(`  ACHILLES_DEFAULT_FAST_MODEL: ${envDefaultFast}`);
    if (envDefaultDeep) console.log(`  ACHILLES_DEFAULT_DEEP_MODEL: ${envDefaultDeep}`);
    if (!envFast && !envDeep && !envDefaultFast && !envDefaultDeep) {
        console.log(`  ${COLORS.GRAY}(none - using LLMConfig.json)${COLORS.RESET}`);
    }
    
    // Show LLMConfig.json defaults
    console.log(`\n${COLORS.BOLD}LLMConfig.json Defaults:${COLORS.RESET}`);
    console.log(`  defaultFastModel: ${config.defaultFastModel || '(not set)'}`);
    console.log(`  defaultDeepModel: ${config.defaultDeepModel || '(not set)'}`);
    
    // Show active models by mode
    printSection('FAST Models (mode: fast)', models.fast, config.defaultFastModel);
    printSection('DEEP Models (mode: deep)', models.deep, config.defaultDeepModel);
    
    // Summary
    console.log(`\n${COLORS.BOLD}Summary:${COLORS.RESET}`);
    console.log(`  Total fast models: ${models.fast.length}`);
    console.log(`  Total deep models: ${models.deep.length}`);
    
    if (models.fast.length > 0) {
        console.log(`  ${COLORS.GREEN}First fast model (will be used):${COLORS.RESET} ${models.fast[0].name}`);
    }
    if (models.deep.length > 0) {
        console.log(`  ${COLORS.GREEN}First deep model (will be used):${COLORS.RESET} ${models.deep[0].name}`);
    }
}

main();
