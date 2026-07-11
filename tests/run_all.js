'use strict';

/**
 * Single-command project check: syntax-checks every tracked JS file, then
 * runs the Node test suite. Usage: node tests/run_all.js
 */

const { execFileSync, spawnSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function listTrackedJsFiles() {
    // -co: tracked plus untracked (minus ignored), so new files are checked
    // before they are ever committed.
    const output = execFileSync('git', ['-C', ROOT, 'ls-files', '-co', '--exclude-standard', '*.js'], { encoding: 'utf8' });
    return [...new Set(output.split('\n').filter(Boolean))];
}

function syntaxCheckAll(files) {
    const failures = [];

    files.forEach(file => {
        const result = spawnSync('node', ['--check', file], { cwd: ROOT, encoding: 'utf8' });
        if (result.status !== 0) {
            failures.push({ file, message: result.stderr.trim() });
        }
    });

    return failures;
}

function runTests() {
    const result = spawnSync('node', ['--test', 'tests/**/*.test.js'], { cwd: ROOT, stdio: 'inherit' });
    return result.status === 0;
}

const files = listTrackedJsFiles();
const syntaxFailures = syntaxCheckAll(files);

if (syntaxFailures.length > 0) {
    syntaxFailures.forEach(failure => {
        console.error(`\nSyntax error in ${failure.file}:\n${failure.message}`);
    });
    console.error(`\nFAIL: ${syntaxFailures.length} of ${files.length} JS files failed node --check.`);
    process.exit(1);
}

console.log(`Syntax OK: ${files.length} tracked JS files pass node --check.`);

if (!runTests()) {
    console.error('\nFAIL: test suite failed.');
    process.exit(1);
}

console.log('\nAll checks passed.');
