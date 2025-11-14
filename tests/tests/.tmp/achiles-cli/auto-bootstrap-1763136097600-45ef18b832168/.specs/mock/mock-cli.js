#!/usr/bin/env node
const requirements = [
  {
    "id": "FS-001",
    "title": "Auto functional coverage",
    "source": "FS",
    "description": "Version: v1.0 (1763136097613)",
    "mockResponse": "Simulated response for FS-001: Version: v1.0 (1763136097613)"
  }
];

const args = process.argv.slice(2);
const getArg = (flag) => {
    const name = flag.replace(/^-+/, '');
    const exactIndex = args.indexOf(flag);
    if (exactIndex !== -1) {
        return args[exactIndex + 1];
    }
    const prefixed = args.find((token) => token.startsWith(`--${name}=`));
    if (prefixed) {
        return prefixed.split('=').slice(1).join('=');
    }
    return null;
};

const reqId = (getArg('--req') || getArg('--requirement') || '').toUpperCase();
const scenario = getArg('--input') || 'default scenario';

const listRequirements = () => {
    console.log('Available mock requirements:');
    requirements.forEach((entry) => {
        console.log(` - ${entry.id} (${entry.source}): ${entry.title}`);
    });
    console.log('\nUsage: node mock-cli.js --req FS-001 --input "preview data"');
};

if (!reqId) {
    listRequirements();
    process.exit(0);
}

const match = requirements.find((entry) => entry.id.toUpperCase() === reqId);
if (!match) {
    console.error(`Requirement ${reqId} not found.\n`);
    listRequirements();
    process.exit(1);
}

console.log(`[mock] ${match.id} – ${match.title}`);
console.log(`Scenario: ${scenario}`);
console.log(`Summary: ${match.description}`);
console.log(`Mock response: ${match.mockResponse}`);
