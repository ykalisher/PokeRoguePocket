# AGENTS.md

## Project Overview

This is a browser-based game built with standard JavaScript, HTML, and CSS.

The project should remain simple, portable, and easy to understand. Prefer clear code, predictable structure, and browser-native APIs over clever abstractions or unnecessary tooling.

## Key Rules for LLMs and Agents

- Never add or commit anything using git commands unless expicitly asked to. You may run other git commands to view the commit history and compare previous versions of the project or files.

- The `scripts/manage_*.js` tools are interactive CLIs for the project owner only. Agents must not run or extend them; edit the JSON data files directly and validate with `node tests/run_all.js`.

- `TODO.md` is the owner's planning file. Do not act on its contents unless explicitly asked.

## Project Structure and Code Requirements

- Use plain JavaScript, HTML, and CSS.

- Do not use third-party libraries, frameworks, build tools, package managers, CDNs, or external runtime dependencies unless explicitly approved. This governs everything the game itself loads in the browser. Dev-only tooling that never ships with the game is exempt where approved: `tests/` (Node built-ins only) and `dev/verify/` (Python + Playwright browser verification, approved July 2026).

- The game should run directly in a modern browser from local files or a simple static server.
