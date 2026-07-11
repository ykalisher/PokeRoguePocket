'use strict';

/**
 * Claude Code PostToolUse hook: validates the file that was just edited.
 * .js files get node --check, .json files get a JSON.parse. Exit code 2
 * reports the error back to the editing agent; anything else stays silent.
 */

const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

let payload = '';
process.stdin.on('data', chunk => { payload += chunk; });
process.stdin.on('end', () => {
    let filePath = null;

    try {
        filePath = JSON.parse(payload).tool_input.file_path;
    } catch {
        process.exit(0);
    }

    if (typeof filePath !== 'string' || !fs.existsSync(filePath)) process.exit(0);

    if (filePath.endsWith('.js')) {
        const result = spawnSync('node', ['--check', filePath], { encoding: 'utf8' });

        if (result.status !== 0) {
            console.error((result.stderr || 'node --check failed').trim());
            process.exit(2);
        }
    } else if (filePath.endsWith('.json')) {
        try {
            JSON.parse(fs.readFileSync(filePath, 'utf8'));
        } catch (error) {
            console.error(`${filePath}: invalid JSON - ${error.message}`);
            process.exit(2);
        }
    }

    process.exit(0);
});
