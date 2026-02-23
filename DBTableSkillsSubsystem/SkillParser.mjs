/**
 * SkillParser - Module for parsing tskill.md files into structured skill definitions
 */

/**
 * Parse a tskill.md file content into structured data
 * @param {string} content - The markdown content to parse
 * @returns {Object} Parsed skill object
 */
export function parseSkillMarkdown(content) {
    const skill = {
        tableName: '',
        tablePurpose: '',
        instructions: '',  // LLM instructions for query interpretation
        deleteGuard: null,
        listDisplayFields: [],
        fields: {},
        derivedFields: {},
        indexes: [],
        primaryKey: null,
        businessRules: [],
        relationships: []
    };

    const lines = content.split('\n');
    let currentField = null;
    let currentSection = null;
    let currentSubSection = null;
    let currentContent = [];
    let sectionDepth = 0;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmedLine = line.trim();

        // Handle main table section (# TableName Skill)
        const tableMatch = trimmedLine.match(/^#\s+(.+)\s+Skill$/i);
        if (tableMatch) {
            skill.tableName = tableMatch[1].trim();
            sectionDepth = 1;
            continue;
        }

        // Handle table purpose (## Table Purpose)
        if (trimmedLine.match(/^##\s+Table Purpose$/i)) {
            saveCurrentContent();
            currentSection = 'tablePurpose';
            currentField = null;
            currentSubSection = null;
            currentContent = [];
            sectionDepth = 2;
            continue;
        }

        // Handle fields section (## Fields)
        if (trimmedLine.match(/^##\s+Fields$/i)) {
            saveCurrentContent();
            currentSection = 'fields';
            currentField = null;
            currentSubSection = null;
            currentContent = [];
            sectionDepth = 2;
            continue;
        }

        // Handle relationships section (## Relationships)
        if (trimmedLine.match(/^##\s+Relationships$/i)) {
            saveCurrentContent();
            currentSection = 'relationships';
            currentField = null;
            currentSubSection = null;
            currentContent = [];
            sectionDepth = 2;
            continue;
        }

        // Handle business rules section (## Business Rules)
        if (trimmedLine.match(/^##\s+Business Rules$/i)) {
            saveCurrentContent();
            currentSection = 'businessRules';
            currentField = null;
            currentSubSection = null;
            currentContent = [];
            sectionDepth = 2;
            continue;
        }

        // Handle instructions section (## Instructions)
        if (trimmedLine.match(/^##\s+Instructions$/i)) {
            saveCurrentContent();
            currentSection = 'instructions';
            currentField = null;
            currentSubSection = null;
            currentContent = [];
            sectionDepth = 2;
            continue;
        }

        // Handle delete guard section (## Delete Guard)
        if (trimmedLine.match(/^##\s+Delete Guard$/i)) {
            saveCurrentContent();
            currentSection = 'deleteGuard';
            currentField = null;
            currentSubSection = null;
            currentContent = [];
            sectionDepth = 2;
            continue;
        }

        // Handle list display fields section (## List Display Fields)
        if (trimmedLine.match(/^##\s+List Display Fields$/i)) {
            saveCurrentContent();
            currentSection = 'listDisplayFields';
            currentField = null;
            currentSubSection = null;
            currentContent = [];
            sectionDepth = 2;
            continue;
        }

        // Handle field definition (### FieldName)
        const fieldMatch = trimmedLine.match(/^###\s+(.+)$/);
        if (fieldMatch && currentSection === 'fields') {
            saveCurrentContent();
            const fieldName = fieldMatch[1].trim();
            currentField = fieldName;
            skill.fields[fieldName] = createEmptyField(fieldName);
            currentSubSection = null;
            currentContent = [];
            sectionDepth = 3;
            continue;
        }

        // Handle field subchapters (#### SubChapter)
        const subChapterMatch = trimmedLine.match(/^####\s+(.+)$/);
        if (subChapterMatch && currentField) {
            saveCurrentContent();
            currentSubSection = subChapterMatch[1].trim();
            currentContent = [];
            sectionDepth = 4;
            continue;
        }

        // Accumulate content
        if (sectionDepth > 0) {
            currentContent.push(line);
        }
    }

    // Save final content
    saveCurrentContent();

    // Post-process to identify derived fields
    identifyDerivedFields(skill);

    return skill;

    // Helper function to save current content
    function saveCurrentContent() {
        const content = currentContent.join('\n').trim();

        if (!content) return;

        if (currentSection === 'tablePurpose' && !currentField) {
            skill.tablePurpose = content;
        } else if (currentSection === 'instructions' && !currentField) {
            skill.instructions = content;
        } else if (currentSection === 'deleteGuard' && !currentField) {
            parseDeleteGuard(content, skill);
        } else if (currentSection === 'listDisplayFields' && !currentField) {
            skill.listDisplayFields = parseFieldNameList(content);
        } else if (currentSection === 'relationships' && !currentField) {
            parseRelationships(content, skill);
        } else if (currentSection === 'businessRules' && !currentField) {
            parseBusinessRules(content, skill);
        } else if (currentField && currentSubSection) {
            processSubSection(skill, currentField, currentSubSection, content);
        } else if (currentField && !currentSubSection) {
            // Field description without explicit subsection
            if (skill.fields[currentField]) {
                skill.fields[currentField].description = content;
            }
        }

        currentContent = [];
    }
}

/**
 * Create an empty field object with default values
 */
function createEmptyField(fieldName) {
    return {
        name: fieldName,
        description: '',
        label: null,
        shortLabel: null,
        type: 'string', // default type
        aliases: [],
        presenterDescription: null,
        valuePresenterDescription: null,
        resolverDescription: null,
        validatorDescription: null,
        enumeratorDescription: null,
        derivatorDescription: null,
        isRequired: false,
        requiredCondition: null,
        isPrimaryKey: false,
        primaryKeyStrategy: null,
        isIndexed: false,
        isUnique: false,
        grouping: null,
        defaultValue: null,
        maxLength: null,
        minLength: null,
        pattern: null,
        enumValues: null
    };
}

/**
 * Process a field subsection
 */
function processSubSection(skill, fieldName, subSection, content) {
    const field = skill.fields[fieldName];
    if (!field) return;

    const sectionLower = subSection.toLowerCase().replace(/\s+/g, '');
    const trimmedContent = content.trim();

    switch (sectionLower) {
        case 'description':
            field.description = trimmedContent;
            // Try to extract type from description
            extractFieldType(field, trimmedContent);
            break;

        case 'fielddisplayname':
        case 'displayname':
        case 'fieldlabel':
        case 'label':
            field.label = trimmedContent;
            break;

        case 'fieldshortlabel':
        case 'shortlabel':
            field.shortLabel = trimmedContent;
            break;

        case 'aliases':
        case 'alias':
            field.aliases = parseAliases(trimmedContent);
            break;

        case 'fieldnamepresenter':
        case 'namepresenter':
            field.presenterDescription = trimmedContent;
            break;

        case 'fieldvaluepresenter':
        case 'valuepresenter':
        case 'presenter':
            field.valuePresenterDescription = trimmedContent;
            break;

        case 'fieldvalueresolver':
        case 'valueresolver':
        case 'resolver':
            field.resolverDescription = trimmedContent;
            break;

        case 'fieldvalueenumerator':
        case 'valueenumerator':
        case 'enumerator':
            field.enumeratorDescription = trimmedContent;
            // Try to extract enum values if present
            extractEnumValues(field, trimmedContent);
            break;

        case 'fieldvaluevalidator':
        case 'valuevalidator':
        case 'validator':
            field.validatorDescription = trimmedContent;
            // Extract validation rules
            extractValidationRules(field, trimmedContent);
            break;

        case 'fieldvalueisrequired':
        case 'valueisrequired':
        case 'isrequired':
        case 'required':
            field.isRequired = true;
            field.requiredCondition = trimmedContent || 'Always required';
            break;

        case 'fieldvaluederivator':
        case 'valuederivator':
        case 'derivator':
        case 'derived':
        case 'computed':
            field.derivatorDescription = trimmedContent;
            field.isDerived = true;
            break;

        case 'primarykey':
        case 'primary':
        case 'pk':
            field.isPrimaryKey = true;
            field.primaryKeyStrategy = trimmedContent || 'auto-increment';
            skill.primaryKey = fieldName;
            break;

        case 'indexed':
        case 'index':
            field.isIndexed = true;
            if (trimmedContent.toLowerCase().includes('unique')) {
                field.isUnique = true;
            }
            skill.indexes.push({
                field: fieldName,
                unique: field.isUnique
            });
            break;

        case 'unique':
            field.isUnique = true;
            field.isIndexed = true;
            break;

        case 'grouping':
        case 'group':
            field.grouping = trimmedContent;
            break;

        case 'default':
        case 'defaultvalue':
            field.defaultValue = trimmedContent;
            break;

        case 'type':
        case 'datatype':
            field.type = parseFieldType(trimmedContent);
            break;

        case 'maxlength':
        case 'max':
            field.maxLength = parseInt(trimmedContent) || null;
            break;

        case 'minlength':
        case 'min':
            field.minLength = parseInt(trimmedContent) || null;
            break;

        case 'pattern':
        case 'regex':
            field.pattern = trimmedContent;
            break;
    }
}

/**
 * Parse aliases from content
 */
function parseAliases(content) {
    // Try to parse as JSON array
    const arrayMatch = content.match(/\[([^\]]+)\]/);
    if (arrayMatch) {
        return arrayMatch[1]
            .split(',')
            .map(a => a.trim().replace(/["']/g, ''))
            .filter(a => a.length > 0);
    }

    // Parse as comma-separated list
    if (content.includes(',')) {
        return content
            .split(',')
            .map(a => a.trim())
            .filter(a => a.length > 0);
    }

    // Parse as line-separated list
    return content
        .split('\n')
        .map(a => a.replace(/^[-*]\s*/, '').trim())
        .filter(a => a.length > 0);
}

function parseFieldNameList(content) {
    const lines = String(content || '').split('\n');
    const orderedFields = [];
    const seen = new Set();

    const addField = (rawValue) => {
        const cleanValue = String(rawValue || '')
            .trim()
            .replace(/^`+|`+$/g, '')
            .replace(/^["']+|["']+$/g, '')
            .replace(/:$/, '')
            .trim();
        if (!cleanValue) return;
        if (!/^[a-zA-Z_][\w-]*$/.test(cleanValue)) return;
        if (seen.has(cleanValue)) return;
        seen.add(cleanValue);
        orderedFields.push(cleanValue);
    };

    for (const line of lines) {
        const trimmed = String(line || '').trim();
        if (!trimmed) continue;
        if (trimmed.startsWith('|')) continue;

        const withoutPrefix = trimmed
            .replace(/^[-*+]\s+/, '')
            .replace(/^\d+\.\s+/, '')
            .trim();

        if (!withoutPrefix) continue;
        if (withoutPrefix.includes(',')) {
            withoutPrefix.split(',').forEach(part => addField(part));
        } else {
            addField(withoutPrefix);
        }
    }

    return orderedFields;
}

/**
 * Extract field type from description
 */
function extractFieldType(field, description) {
    const lower = description.toLowerCase();

    if (lower.includes('integer') || lower.includes('int') || lower.includes('number')) {
        field.type = 'integer';
    } else if (lower.includes('decimal') || lower.includes('float') || lower.includes('double')) {
        field.type = 'decimal';
    } else if (lower.includes('boolean') || lower.includes('bool')) {
        field.type = 'boolean';
    } else if (lower.includes('date') && lower.includes('time')) {
        field.type = 'datetime';
    } else if (lower.includes('date')) {
        field.type = 'date';
    } else if (lower.includes('time')) {
        field.type = 'time';
    } else if (lower.includes('email')) {
        field.type = 'email';
    } else if (lower.includes('url') || lower.includes('link')) {
        field.type = 'url';
    } else if (lower.includes('json') || lower.includes('object')) {
        field.type = 'json';
    } else if (lower.includes('text') || lower.includes('long')) {
        field.type = 'text';
    } else {
        field.type = 'string'; // default
    }
}

/**
 * Parse field type string
 */
function parseFieldType(typeStr) {
    const lower = typeStr.toLowerCase().trim();

    const typeMap = {
        'int': 'integer',
        'integer': 'integer',
        'number': 'integer',
        'bigint': 'bigint',
        'decimal': 'decimal',
        'float': 'decimal',
        'double': 'decimal',
        'numeric': 'decimal',
        'string': 'string',
        'varchar': 'string',
        'char': 'string',
        'text': 'text',
        'longtext': 'text',
        'boolean': 'boolean',
        'bool': 'boolean',
        'date': 'date',
        'datetime': 'datetime',
        'timestamp': 'datetime',
        'time': 'time',
        'json': 'json',
        'jsonb': 'json',
        'object': 'json',
        'array': 'array',
        'email': 'email',
        'url': 'url',
        'uuid': 'uuid'
    };

    // Check for type with length (e.g., varchar(255))
    const lengthMatch = lower.match(/(\w+)\((\d+)\)/);
    if (lengthMatch) {
        const baseType = typeMap[lengthMatch[1]] || lengthMatch[1];
        return baseType;
    }

    return typeMap[lower] || lower;
}

/**
 * Extract enum values from enumerator description
 */
function extractEnumValues(field, description) {
    // Look for explicit list of values
    const listMatch = description.match(/\[([^\]]+)\]/);
    if (listMatch) {
        field.enumValues = listMatch[1]
            .split(',')
            .map(v => v.trim().replace(/["']/g, ''));
        return;
    }

    // Look for quoted values in description
    const quotedValues = description.match(/["']([^"']+)["']/g);
    if (quotedValues && quotedValues.length > 1) {
        field.enumValues = quotedValues.map(v => v.replace(/["']/g, ''));
    }
}

/**
 * Extract validation rules from validator description
 */
function extractValidationRules(field, description) {
    const lower = description.toLowerCase();

    // Extract length constraints
    const minMatch = lower.match(/min(?:imum)?[\s:]+(\d+)/);
    if (minMatch) {
        field.minLength = parseInt(minMatch[1]);
    }

    const maxMatch = lower.match(/max(?:imum)?[\s:]+(\d+)/);
    if (maxMatch) {
        field.maxLength = parseInt(maxMatch[1]);
    }

    // Extract pattern/regex
    const regexMatch = description.match(/pattern[\s:]+([^\s]+)/i) ||
                       description.match(/regex[\s:]+([^\s]+)/i) ||
                       description.match(/\/(.+)\//);
    if (regexMatch) {
        field.pattern = regexMatch[1];
    }

    // Check for email validation
    if (lower.includes('email')) {
        field.type = 'email';
        field.pattern = field.pattern || '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$';
    }

    // Check for URL validation
    if (lower.includes('url') || lower.includes('link')) {
        field.type = 'url';
    }
}

/**
 * Identify and move derived fields to derivedFields object
 */
function identifyDerivedFields(skill) {
    for (const [fieldName, field] of Object.entries(skill.fields)) {
        if (field.isDerived || field.derivatorDescription) {
            skill.derivedFields[fieldName] = field;
            delete skill.fields[fieldName];
        }
    }
}

function parseTableFieldRef(value) {
    const text = String(value || '').trim();
    if (!text) return null;
    const match = text.match(/^([a-zA-Z_][\w]*)\s*\.\s*([a-zA-Z_][\w]*)$/);
    if (!match) return null;
    return {
        table: match[1],
        field: match[2],
    };
}

function parseFieldReferencesExpression(value) {
    const text = String(value || '').trim();
    if (!text) return null;
    const match = text.match(
        /([a-zA-Z_][\w]*\.[a-zA-Z_][\w]*)\s*(?:references|->|=>)\s*([a-zA-Z_][\w]*\.[a-zA-Z_][\w]*)/i,
    );
    if (!match) return null;
    const source = parseTableFieldRef(match[1]);
    const target = parseTableFieldRef(match[2]);
    if (!source || !target) return null;
    return { source, target };
}

/**
 * Parse relationships section
 */
function parseRelationships(content, skill) {
    const lines = content.split('\n');
    let currentRelation = null;
    const relationHeaderRegex = /^###\s+(.+)$/;
    const bulletRegex = /^[-*]\s+(.+)$/;

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        const headerMatch = trimmed.match(relationHeaderRegex);
        if (headerMatch) {
            currentRelation = {
                type: headerMatch[1].trim(),
                foreign: null,
                reference: null,
                referencedBy: null,
                field: null,
                cascade: null,
                sourceTable: null,
                sourceField: null,
                targetTable: null,
                targetField: null
            };
            skill.relationships.push(currentRelation);
            continue;
        }

        // Check for relationship definition
        const bulletMatch = trimmed.match(bulletRegex);
        if (bulletMatch) {
            const relationText = bulletMatch[1].trim();

            // Parse relationship format: "Type: one-to-many with orders.customer_id"
            const match = relationText.match(/(.+?):\s*(.+)/);
            if (match) {
                const [, key, value] = match;
                const cleanedValue = value.trim();
                const keyLower = key.toLowerCase().trim();

                if (keyLower.includes('type')) {
                    currentRelation = {
                        type: cleanedValue,
                        foreign: null,
                        reference: null,
                        referencedBy: null,
                        field: null,
                        cascade: null,
                        sourceTable: null,
                        sourceField: null,
                        targetTable: null,
                        targetField: null
                    };
                    skill.relationships.push(currentRelation);
                } else if (currentRelation) {
                    if (keyLower.includes('referenced by')) {
                        currentRelation.referencedBy = cleanedValue;
                        const pair = parseTableFieldRef(cleanedValue);
                        if (pair) {
                            currentRelation.sourceTable = pair.table;
                            currentRelation.sourceField = pair.field;
                        }
                    } else if (keyLower.includes('foreign')) {
                        currentRelation.foreign = cleanedValue;
                    } else if (keyLower.includes('cascade')) {
                        currentRelation.cascade = cleanedValue;
                    } else if (keyLower.includes('reference')) {
                        currentRelation.reference = cleanedValue;
                        const pair = parseTableFieldRef(cleanedValue);
                        if (pair) {
                            currentRelation.targetTable = pair.table;
                            currentRelation.targetField = pair.field;
                        }
                    } else if (keyLower === 'field') {
                        currentRelation.field = cleanedValue;
                        const refs = parseFieldReferencesExpression(cleanedValue);
                        if (refs) {
                            currentRelation.sourceTable = refs.source.table;
                            currentRelation.sourceField = refs.source.field;
                            currentRelation.targetTable = refs.target.table;
                            currentRelation.targetField = refs.target.field;
                        } else {
                            const sourcePair = parseTableFieldRef(cleanedValue);
                            if (sourcePair) {
                                currentRelation.sourceTable = sourcePair.table;
                                currentRelation.sourceField = sourcePair.field;
                            }
                        }
                    }
                }
            }
        }
    }
}

/**
 * Parse business rules section
 */
function parseBusinessRules(content, skill) {
    const lines = content.split('\n');

    for (const line of lines) {
        const trimmed = line.trim();

        // Check for rule definition
        if (trimmed.match(/^[-*]\s+/) || trimmed.match(/^\d+\.\s+/)) {
            const ruleText = trimmed.replace(/^[-*\d.]\s+/, '').trim();
            if (ruleText) {
                skill.businessRules.push(ruleText);
            }
        } else if (trimmed && skill.businessRules.length > 0) {
            // Continue previous rule
            skill.businessRules[skill.businessRules.length - 1] += ' ' + trimmed;
        }
    }
}

/**
 * Parse delete guard section.
 */
function parseDeleteGuard(content, skill) {
    const trimmed = String(content || '').trim();
    if (!trimmed) {
        return;
    }

    // Supported syntax:
    // - DeleteGuard: block_if_referenced
    // - block_if_referenced
    const explicitMatch = trimmed.match(/DeleteGuard\s*:\s*([a-zA-Z0-9_-]+)/i);
    const mode = explicitMatch
        ? explicitMatch[1].toLowerCase()
        : trimmed.split(/\s+/)[0].toLowerCase();

    if (!mode) {
        return;
    }

    skill.deleteGuard = { mode };
}

/**
 * Validate parsed skill structure
 */
export function validateSkill(skill) {
    const errors = [];
    const warnings = [];

    // Check for table name
    if (!skill.tableName) {
        errors.push('Table name is required');
    }

    // Check for table purpose
    if (!skill.tablePurpose) {
        warnings.push('Table purpose is recommended for documentation');
    }

    // Check for at least one field
    const fieldCount = Object.keys(skill.fields).length + Object.keys(skill.derivedFields).length;
    if (fieldCount === 0) {
        errors.push('At least one field must be defined');
    }

    // Check for primary key
    if (!skill.primaryKey) {
        warnings.push('No primary key defined - consider adding one for database operations');
    }

    // Validate delete guard mode if present
    if (skill.deleteGuard && skill.deleteGuard.mode) {
        const allowedModes = new Set(['block_if_referenced']);
        if (!allowedModes.has(String(skill.deleteGuard.mode).toLowerCase())) {
            warnings.push(`Unknown delete guard mode "${skill.deleteGuard.mode}"`);
        }
    }

    if (Array.isArray(skill.listDisplayFields) && skill.listDisplayFields.length > 0) {
        const missingListDisplayFields = skill.listDisplayFields.filter(fieldName =>
            !Object.prototype.hasOwnProperty.call(skill.fields, fieldName)
            && !Object.prototype.hasOwnProperty.call(skill.derivedFields, fieldName),
        );
        if (missingListDisplayFields.length > 0) {
            warnings.push(
                `List display fields reference undefined fields: ${missingListDisplayFields.join(', ')}`,
            );
        }
    }

    // Validate field definitions
    for (const [fieldName, field] of Object.entries(skill.fields)) {
        if (!field.description) {
            warnings.push(`Field "${fieldName}" lacks a description`);
        }

        // Check for resolver/presenter symmetry
        if (field.valuePresenterDescription && !field.resolverDescription) {
            warnings.push(`Field "${fieldName}" has a presenter but no resolver - consider adding one for symmetry`);
        }
        if (field.resolverDescription && !field.valuePresenterDescription) {
            warnings.push(`Field "${fieldName}" has a resolver but no presenter - consider adding one for symmetry`);
        }
    }

    return {
        isValid: errors.length === 0,
        errors,
        warnings
    };
}
