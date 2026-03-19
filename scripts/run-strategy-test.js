const { runAnalysis } = require('../dist/lib/bot-engine'); // This won't work if not built
// Let's use ts-node in a way that works or use a different approach.

// I will try to use a simple JS script that uses 'require' on the compiled output, 
// but it's likely not compiled to dist/.

// Better: I'll try to run the TS script with --transpile-only
const { execSync } = require('child_process');

try {
    const output = execSync('npx ts-node -T scripts/test-strategy-refactor.ts', { encoding: 'utf8' });
    console.log(output);
} catch (e) {
    console.error('Execution failed:', e.stdout || e.message);
}
