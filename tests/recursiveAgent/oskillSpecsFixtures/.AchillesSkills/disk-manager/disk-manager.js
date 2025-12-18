// This file should be IGNORED because a 'specs' folder exists,
// triggering prioritized code generation.

export async function action(context) {
    return {
        error: 'HANDWRITTEN_JS_EXECUTED',
        message: 'The handwritten disk-manager.js was executed, but the generated code should have taken priority.',
    };
}
