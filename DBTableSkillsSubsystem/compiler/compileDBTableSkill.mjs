import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseTSkillDocument } from '../parser/parseTSkillDocument.mjs';

const GENERATED_FILENAME = 'dbtable.generated.mjs';
const META_FILENAME = 'dbtable.generated.meta.json';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const RUNTIME_SOURCE = path.resolve(MODULE_DIR, '../runtime/createDBTableSkillFunctions.mjs');

function toImportPath(fromDir, targetFile) {
    const relative = path.relative(fromDir, targetFile).replace(/\\/g, '/');
    if (relative.startsWith('.')) {
        return relative;
    }
    return `./${relative}`;
}

function readExistingFile(filePath) {
    try {
        return fs.readFileSync(filePath, 'utf8');
    } catch (error) {
        return null;
    }
}

function writeIfChanged(filePath, content) {
    const existing = readExistingFile(filePath);
    if (existing !== null && existing === content) {
        return false;
    }
    fs.writeFileSync(filePath, content);
    return true;
}

function writeMetaFile(filePath, meta) {
    const serialized = `${JSON.stringify(meta, null, 4)}\n`;
    writeIfChanged(filePath, serialized);
}

function buildModuleSource({ blueprint, importPath }) {
    const header = [
        `import { createDBTableSkillFunctions } from '${importPath}';`,
        '',
    ].join('\n');

    const body = [
        `const TABLE_BLUEPRINT = ${JSON.stringify(blueprint, null, 4)};`,
        '',
        'export const generated = createDBTableSkillFunctions(TABLE_BLUEPRINT);',
        '',
        'export const {',
        '    blueprint,',
        '    prepareRecord,',
        '    validatorFunction,',
        '    presentRecord,',
        '    generatePKValues,',
        '    enumeratorFunction,',
        '    fieldNamePresenterFunction,',
        '} = generated;',
        '',
        'export default {',
        '    blueprint,',
        '    prepareRecord,',
        '    validatorFunction,',
        '    presentRecord,',
        '    generatePKValues,',
        '    enumeratorFunction,',
        '    fieldNamePresenterFunction,',
        '};',
        '',
    ].join('\n');

    return `${header}${body}`;
}

export function compileDBTableSkill(skillRecord) {
    if (!skillRecord || !skillRecord.filePath) {
        throw new Error('compileDBTableSkill requires a skillRecord with filePath.');
    }

    const parsed = parseTSkillDocument(skillRecord.filePath);
    const { raw, ...rest } = parsed;
    const blueprint = {
        ...rest,
    };
    blueprint.generatedAt = new Date().toISOString();

    const moduleSource = buildModuleSource({
        blueprint,
        importPath: toImportPath(skillRecord.skillDir, RUNTIME_SOURCE),
    });

    const generatedPath = path.join(skillRecord.skillDir, GENERATED_FILENAME);
    const metaPath = path.join(skillRecord.skillDir, META_FILENAME);

    const meta = {
        descriptorHash: blueprint.descriptorHash,
        generatedAt: blueprint.generatedAt,
        file: GENERATED_FILENAME,
    };

    const existingMeta = readExistingFile(metaPath);
    if (existingMeta) {
        try {
            const parsed = JSON.parse(existingMeta);
            if (
                parsed
                && parsed.descriptorHash === blueprint.descriptorHash
                && fs.existsSync(generatedPath)
            ) {
                return {
                    generated: false,
                    file: generatedPath,
                    blueprint,
                };
            }
        } catch {
            // ignore malformed metadata
        }
    }

    writeIfChanged(generatedPath, `${moduleSource}`);
    writeMetaFile(metaPath, meta);

    return {
        generated: true,
        file: generatedPath,
        blueprint,
    };
}

export default {
    compileDBTableSkill,
};
