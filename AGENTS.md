# AGENTS.md

## Project Overview

This is a browser-based game built with standard JavaScript, HTML, and CSS.

The project should remain simple, portable, and easy to understand. Prefer clear code, predictable structure, and browser-native APIs over clever abstractions or unnecessary tooling.

## Key Rules for LLMs and Agents

- Never add or commit anything using git commands unless expicitly asked to. You may run other git commands to view the commit history and compare previous versions of the project or files.

- When you have completed your task, answered a question, need permission to run a command, or completed planning for a large task and are about to execute it, run the ~/scripts/brrr_notify.py script, replacing the brackets with the correct content. It's an executable script, and I'd prefer if you ran it using the absolute path: ~/scripts/brrr_notify.py "[name of agent, i.e. Vibe or Codex] is done" "[summary of completed work]" "[name of project directory]"

## Project Structure and Code Requirements

- Use plain JavaScript, HTML, and CSS.

- Do not use third-party libraries, frameworks, build tools, package managers, CDNs, or external runtime dependencies unless explicitly approved.

- The game should run directly in a modern browser from local files or a simple static server.
