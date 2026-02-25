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

Respond with JSON ONLY (no markdown, no explanation):
{
    "operation": "CREATE" | "UPDATE" | "SELECT" | "DELETE",
    "intent": "description of what the user wants",
    "filter": {},
    "data": {},
    "query": {
        "window": "first" | "last",
        "limit": 10
    },
    "postFilters": [
        {
            "field": "field_name",
            "operator": "equals" | "not_equals" | "contains" | "not_contains" | "starts_with" | "ends_with" | "in" | "not_in" | "gt" | "gte" | "lt" | "lte" | "between",
            "value": "value",
            "valueTo": "value_for_between_only",
            "joinWithPrevious": "and" | "or"
        }
    ]
}

Rules:
- Always return all top-level keys: operation, intent, filter, data, query, postFilters.
- If a section is not needed, use an empty object {} or empty array [].
- For SELECT:
  - Put only exact DB-equality predicates in "filter" (flat field->value pairs).
  - Put comparator/text operators (gt/gte/lt/lte/between/contains/not_contains/starts_with/ends_with/in/not_in) in "postFilters".
  - Put pagination/window intent in "query": e.g. "first 3" => {"window":"first","limit":3}, "last two" => {"window":"last","limit":2}.
  - "query.limit" MUST be an integer number (convert words like "two", "twenty one" to digits).
  - Never place sort/pagination keys inside "filter".
  - Never emit synthetic operator keys in filter (invalid examples: name_contains, quantity_gte, area_id_in).
- For UPDATE/DELETE, when user specifies an entity id, map it to the primary key in "filter".
- Never invent fields not listed in Available fields.
- Never invent values not implied by user input.

Ambiguity handling:
- If user input is ambiguous and cannot be safely mapped to one exact field:
  - prefer SELECT,
  - keep "filter" minimal (or {}),
  - use "postFilters" with explicit OR conditions across plausible fields,
  - include "(ambiguous)" in intent.
- For short noun-like queries, do not force a single field unless explicitly requested.
- If unsure between exact equality and substring, prefer substring via postFilters "contains".

Comparator priority rules (important):
- When prompt contains a numeric comparator with a value (>, >=, <, <=, more than, less than, greater than, at least, at most, between, from..to), prioritize mapping it to a numeric field in postFilters.
- Treat typo variants as the same comparator intent:
  - "more then" => "more than"
  - "less then" => "less than"
  - "greater then" => "greater than"
- Do NOT downgrade numeric comparator intent into a plain equality filter on unrelated text fields.
- If both a product phrase and comparator are present (example: "Electrical Conduit less then 65 peaces"):
  - keep product phrase as text match in postFilters (contains),
  - map comparator to numeric field (typically quantity) in postFilters,
  - combine with AND.
- Use OR in postFilters only when user explicitly asks with keyword "or".
- For prompts using "with"/"where" plus comparator and no explicit "or", default joinWithPrevious to "and".
- If comparator appears without an explicit field name (example: "with at least 55 peaces"), infer numeric field from context:
  - default to "quantity" for inventory-like prompts,
  - if "quantity" does not exist, choose the closest numeric field from Available fields (do not leave comparator unmapped),
  - never map it to unit equality.
- If pattern is "<item phrase> with/where <numeric comparator> <number> <unit-like token>", produce BOTH:
  - a text predicate for item phrase (contains),
  - a numeric predicate for quantity (gt/gte/lt/lte/between).
- Treat common typos as equivalent:
  - "less then" -> "less than"
  - "more then" -> "more than"
  - "peaces"/"piece"/"pcs"/"pieces" indicate quantity context unless user explicitly says "unit is ...".
- Only set unit equality when the prompt explicitly asks about unit (example: "where unit is pcs").
- Never output only {"filter":{"unit":"pieces"}} when a numeric comparator is present.
- For SELECT with numeric comparator intent, postFilters must include at least one numeric condition (gt/gte/lt/lte/between).
- Hard reject:
  - empty postFilters when numeric comparator cues are present,
  - filter keys with operator suffixes (name_contains, quantity_gte, etc).
  - dropping comparator intent when at least one numeric field exists in Available fields.
- Mandatory constraint:
  - If numeric comparator cue exists and at least one numeric field exists in Available fields, output must include at least one numeric postFilter (gt/gte/lt/lte/between) on one of those numeric fields.

Examples (valid JSON shape):
Prompt: "list last two areas"
{
  "operation":"SELECT",
  "intent":"list areas with last window",
  "filter":{},
  "data":{},
  "query":{"window":"last","limit":2},
  "postFilters":[]
}

Prompt: "show all materials where quantity >= 50 and quantity <= 200"
{
  "operation":"SELECT",
  "intent":"filter materials by quantity range",
  "filter":{},
  "data":{},
  "query":{},
  "postFilters":[
    {"field":"quantity","operator":"gte","value":"50","joinWithPrevious":"and"},
    {"field":"quantity","operator":"lte","value":"200","joinWithPrevious":"and"}
  ]
}

Prompt: "show all Electrical Conduit less then 65 peaces"
{
  "operation":"SELECT",
  "intent":"filter electrical conduit by quantity less than 65",
  "filter":{},
  "data":{},
  "query":{},
  "postFilters":[
    {"field":"name","operator":"contains","value":"electrical conduit","joinWithPrevious":"and"},
    {"field":"quantity","operator":"lt","value":"65","joinWithPrevious":"and"}
  ]
}

Prompt: "show all Electrical Conduit with at least 55 peaces"
{
  "operation":"SELECT",
  "intent":"filter electrical conduit by quantity at least 55",
  "filter":{},
  "data":{},
  "query":{},
  "postFilters":[
    {"field":"name","operator":"contains","value":"electrical conduit","joinWithPrevious":"and"},
    {"field":"quantity","operator":"gte","value":"55","joinWithPrevious":"and"}
  ]
}

Prompt: "show all cms's"
{
  "operation":"SELECT",
  "intent":"ambiguous short search term (ambiguous)",
  "filter":{},
  "data":{},
  "query":{},
  "postFilters":[
    {"field":"category1","operator":"contains","value":"cms","joinWithPrevious":"and"},
    {"field":"category2","operator":"contains","value":"cms","joinWithPrevious":"or"},
    {"field":"category3","operator":"contains","value":"cms","joinWithPrevious":"or"},
    {"field":"name","operator":"contains","value":"cms","joinWithPrevious":"or"}
  ]
}

Prompt: "change area named shelf area"
{
  "operation":"UPDATE",
  "intent":"update area records named shelf area",
  "filter":{"name":"shelf area"},
  "data":{},
  "query":{},
  "postFilters":[]
}

Negative example (invalid):
Prompt: "show all Electrical Conduit with at least 55 peaces"
{
  "operation":"SELECT",
  "filter":{"unit":"pieces"},
  "postFilters":[]
}
Reason invalid: comparator cue present but no numeric postFilter; unit was inferred without explicit "unit is ...".

Negative example (invalid):
Prompt: "show all materials where quantity >= 50"
{
  "operation":"SELECT",
  "filter":{"quantity_gte":"50"},
  "postFilters":[]
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
