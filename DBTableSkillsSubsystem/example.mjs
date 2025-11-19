/**
 * Example usage of DBTableSkillsSubsystem
 */

import { DBTableSkillsSubsystem } from './DBTableSkillsSubsystem.mjs';

// Example LLM agent mock
const mockLLMAgent = {
    executePrompt: async (prompt, options) => {
        // Mock implementation that returns predefined responses
        console.log('LLM Prompt:', prompt.substring(0, 100) + '...');

        if (options.responseShape === 'json') {
            return {
                operation: 'SELECT',
                intent: 'Get all customers',
                filter: {},
                data: null
            };
        }

        if (options.responseShape === 'code') {
            return 'function example() { return "example"; }';
        }

        return 'Mock response';
    }
};

// Example database adapter mock
const mockDBAdapter = {
    query: async (sql, params) => {
        console.log('DB Query:', sql);
        return [];
    },

    insert: async (table, data) => {
        console.log('DB Insert:', table, data);
        return { id: 1 };
    },

    update: async (table, data, where) => {
        console.log('DB Update:', table, data, where);
        return { affected: 1 };
    },

    delete: async (table, where) => {
        console.log('DB Delete:', table, where);
        return { affected: 1 };
    }
};

async function main() {
    console.log('DBTableSkillsSubsystem Example\n');

    // Create subsystem instance
    const subsystem = new DBTableSkillsSubsystem({
        llmAgent: mockLLMAgent,
        dbAdapter: mockDBAdapter,
        config: {
            skillsPath: './skills',
            generatedPath: './generated'
        }
    });

    console.log('1. Created DBTableSkillsSubsystem instance');

    // Example skill record (normally provided by the agent framework)
    const skillRecord = {
        name: 'customers',
        descriptor: {
            title: 'Customer Management',
            summary: 'Manage customer records',
            sections: {}
        },
        skillDir: './skills/customers',
        filePath: './skills/customers/tskill.md'
    };

    console.log('2. Defined skill record for "customers" table');

    try {
        // Prepare the skill (this would parse tskill.md and generate functions)
        console.log('3. Preparing skill...');
        await subsystem.prepareSkill(skillRecord);
        console.log('   ✓ Skill prepared successfully');

        // Execute a skill prompt
        console.log('4. Executing skill prompt...');
        const result = await subsystem.executeSkillPrompt({
            skillRecord,
            promptText: 'Show me all customers',
            options: {
                args: {
                    prompt: 'Show me all customers'
                }
            }
        });

        console.log('5. Result:');
        console.log(JSON.stringify(result, null, 2));

    } catch (error) {
        console.error('Error:', error.message);
        console.log('\nNote: This example requires a tskill.md file at ./skills/customers/tskill.md');
        console.log('See sample_customers_tskill.md in the files directory for an example.');
    }
}

// Run the example
main().catch(console.error);