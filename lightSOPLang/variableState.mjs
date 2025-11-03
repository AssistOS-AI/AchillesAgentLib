import { createUndefinedValue } from './valueHelpers.mjs';

export class VariableState {
    constructor(name) {
        this.name = name;
        this.command = '';
        this.arguments = [];
        this.dependencies = new Set();
        this.dependents = new Set();
        this.signature = '';
        this.value = createUndefinedValue('', 'initial');
    }

    updateFromDeclaration(declaration) {
        this.command = declaration.command;
        this.arguments = declaration.arguments;
        this.dependencies = new Set(declaration.dependencies);
        this.signature = declaration.signature;
    }

    markChanged() {
        this.value = createUndefinedValue('definition changed', 'definition');
    }
}
