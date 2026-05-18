import { createUndefinedValue } from './valueHelpers.mjs';

export class VariableState {
    constructor(name) {
        this.name = name;
        this.command = '';
        this.arguments = [];
        this.dependencies = new Set();
        this.dependents = new Set();
        this.signature = '';
        this.comment = '';
        this.commentLines = [];
        this.lineNumber = null;
        this.value = createUndefinedValue('', 'initial');
    }

    updateFromDeclaration(declaration) {
        this.command = declaration.command;
        this.arguments = declaration.arguments;
        this.dependencies = new Set(declaration.dependencies);
        this.signature = declaration.signature;
        this.comment = typeof declaration.comment === 'string' ? declaration.comment : '';
        this.commentLines = Array.isArray(declaration.commentLines) ? declaration.commentLines.slice() : [];
        this.lineNumber = Number.isFinite(declaration.lineNumber) ? declaration.lineNumber : null;
    }

    markChanged() {
        this.value = createUndefinedValue('definition changed', 'definition');
    }
}
