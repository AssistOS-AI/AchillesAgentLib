/**
 * Prompt templates for DBTableSkillsSubsystem.
 *
 * All LLM prompts used by ConversationalTskillController are centralized here
 * for easier maintenance and consistency.
 */

/**
 * Build prompt for parsing user input to determine CRUD operation.
 * @param {string} userPrompt - The user's natural language input
 * @param {string} entityName - Name of the entity/table
 * @param {string} tablePurpose - Description of what the table stores
 * @param {string} fieldInfo - Formatted field information string
 * @param {string} [skillInstructions] - Optional skill-specific instructions
 * @returns {string} The formatted prompt
 */
export function buildParseOperationPrompt(userPrompt, entityName, tablePurpose, fieldInfo, skillInstructions = '') {
    const instructionsSection = skillInstructions
        ? `\nSkill-specific instructions:\n${skillInstructions}\n`
        : '';

    return `Analyze this prompt and determine the database operation type:
"${userPrompt}"

For table: ${entityName}
Table purpose: ${tablePurpose}
${instructionsSection}
Available fields:
${fieldInfo}

Respond with JSON:
{
    "operation": "CREATE" | "UPDATE" | "SELECT" | "DELETE",
    "intent": "description of what the user wants",
    "filter": {},
    "data": {}
}`;
}

/**
 * Build prompt for extracting field changes from user input during UPDATE.
 * @param {string} entityName - Name of the entity/table
 * @param {Object} currentRecord - The current record being updated
 * @param {string} fieldInfo - Formatted field information string
 * @param {string} userInput - The user's input specifying changes
 * @returns {string} The formatted prompt
 */
export function buildExtractFieldChangesPrompt(entityName, currentRecord, fieldInfo, userInput) {
    return `Extract the field changes from this user input for a "${entityName}" record.

Current record:
${JSON.stringify(currentRecord, null, 2)}

Available fields:
${fieldInfo}

User said: "${userInput}"

Respond with JSON: { "changes": { "fieldName": "newValue", ... } }
Rules:
- Only include fields the user explicitly wants to change.
- Do not infer or invent values.
- Do not copy values from the current record unless the user explicitly provided that value.
- If the user message is ambiguous, vague, or only references field names without values, return { "changes": {} }.`;
}

/**
 * Build prompt for extracting create data from user input during CREATE capture.
 * Supports capturing one or multiple fields from natural language in one turn.
 * @param {string} entityName - Name of the entity/table
 * @param {Object} currentRecord - Partial record collected so far
 * @param {string[]} requiredFields - Required field names
 * @param {string[]} missingFields - Still-missing required field names
 * @param {string} fieldInfo - Formatted field information string
 * @param {string} userInput - The user's latest input
 * @returns {string} The formatted prompt
 */
export function buildExtractCreateDataPrompt(
    entityName,
    currentRecord,
    requiredFields,
    missingFields,
    fieldInfo,
    userInput,
) {
    return `Extract field values for creating a "${entityName}" record from the user's message.

Current partial record:
${JSON.stringify(currentRecord || {}, null, 2)}

Required fields:
${JSON.stringify(requiredFields || [])}

Missing required fields:
${JSON.stringify(missingFields || [])}

Available fields:
${fieldInfo}

User said: "${userInput}"

Respond with JSON: { "data": { "fieldName": "value", ... } }
Rules:
- Extract all fields that are explicitly provided (one or multiple).
- Use only available fields listed above.
- If no field value is clearly provided, return { "data": {} }.`;
}

/**
 * Build prompt for applying user corrections to validation errors.
 * @param {string} entityName - Name of the entity/table
 * @param {string} errorList - Comma-separated list of previous errors
 * @param {Object} previousData - The data that had validation errors
 * @param {string} userCorrections - The user's correction input
 * @param {string} fieldInfo - Formatted field information string
 * @returns {string} The formatted prompt
 */
export function buildValidationCorrectionPrompt(entityName, errorList, previousData, userCorrections, fieldInfo) {
    return `The user is correcting validation errors for a "${entityName}" record.

Previous errors: ${errorList}
Previous data: ${JSON.stringify(previousData, null, 2)}

User's corrections: "${userCorrections}"

Available fields:
${fieldInfo}

Respond with JSON: { "correctedData": { ...all fields with corrections applied... } }`;
}

/**
 * Format field information for use in prompts.
 * @param {Object} fields - Field definitions from parsed skill
 * @returns {string} Formatted field info string
 */
export function formatFieldInfo(fields) {
    return Object.entries(fields)
        .map(([name, def]) => {
            let info = `- ${name}: ${def.description || name}`;
            if (def.aliases?.length > 0) {
                info += ` (aliases: ${def.aliases.join(', ')})`;
            }
            return info;
        })
        .join('\n');
}

/**
 * Format field information (simple version without aliases).
 * @param {Object} fields - Field definitions from parsed skill
 * @returns {string} Formatted field info string
 */
export function formatFieldInfoSimple(fields) {
    return Object.entries(fields)
        .map(([name, def]) => `- ${name}: ${def.description || name}`)
        .join('\n');
}
