/**
 * Preview Changes - Shows a diff before applying changes
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * Simple diff implementation
 */
function simpleDiff(oldText, newText) {
    const oldLines = oldText.split('\n');
    const newLines = newText.split('\n');
    const diff = [];

    let i = 0, j = 0;
    while (i < oldLines.length || j < newLines.length) {
        if (i >= oldLines.length) {
            diff.push(`+ ${newLines[j]}`);
            j++;
        } else if (j >= newLines.length) {
            diff.push(`- ${oldLines[i]}`);
            i++;
        } else if (oldLines[i] === newLines[j]) {
            diff.push(`  ${oldLines[i]}`);
            i++;
            j++;
        } else {
            const oldInNew = newLines.indexOf(oldLines[i], j);
            const newInOld = oldLines.indexOf(newLines[j], i);

            if (oldInNew === -1 && newInOld === -1) {
                diff.push(`- ${oldLines[i]}`);
                diff.push(`+ ${newLines[j]}`);
                i++;
                j++;
            } else if (oldInNew === -1 || (newInOld !== -1 && newInOld < oldInNew)) {
                diff.push(`- ${oldLines[i]}`);
                i++;
            } else {
                diff.push(`+ ${newLines[j]}`);
                j++;
            }
        }
    }

    return diff.join('\n');
}

export async function action(input, context) {
    const { skillsDir } = context;

    if (!skillsDir) {
        return 'Error: skillsDir not configured in context';
    }

    // Parse arguments
    let args;
    if (typeof input === 'string') {
        try {
            args = JSON.parse(input);
        } catch (e) {
            return `Error: Invalid JSON input. Expected: {skillName, fileName, newContent}`;
        }
    } else {
        args = input || {};
    }

    const { skillName, fileName, newContent } = args;

    if (!skillName) {
        return 'Error: skillName is required';
    }
    if (!fileName) {
        return 'Error: fileName is required';
    }
    if (!newContent) {
        return 'Error: newContent is required';
    }

    const filePath = path.join(skillsDir, skillName, fileName);

    // If file doesn't exist, show as new file
    if (!fs.existsSync(filePath)) {
        return [
            `=== NEW FILE: ${skillName}/${fileName} ===`,
            '',
            newContent,
        ].join('\n');
    }

    let currentContent;
    try {
        currentContent = fs.readFileSync(filePath, 'utf8');
    } catch (error) {
        return `Error reading file: ${error.message}`;
    }

    // Check if content is identical
    if (currentContent === newContent) {
        return `No changes detected in ${skillName}/${fileName}`;
    }

    const diff = simpleDiff(currentContent, newContent);

    return [
        `=== DIFF: ${skillName}/${fileName} ===`,
        '(- removed, + added)',
        '',
        diff,
    ].join('\n');
}

export default action;
