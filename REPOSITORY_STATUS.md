# Repository Status

Last reviewed: 2026-06-30
Maintainer: @zhaozehan0424-design
Repository: `zhaozehan0424-design/agent-change-auditor`
Project type: Node.js CLI
Current public version: v0.2.1

## Purpose

Evidence-based audit reports for AI coding agent changes, using git state, command logs, deterministic risk rules, and optional agent self-claim comparison.

## Current Health

- CLI commands are covered by syntax, public repository, and smoke tests.
- Public repository hygiene files are present: README, license, changelog, maintenance notes, security policy, contribution guide, issue template, PR template, CI, and self-audit evidence.
- Generated root audit artifacts are ignored; curated self-audit evidence is stored under `docs/self-audit/`.

## Latest Local Verification

- `npm run check -> syntax_ok=4, public_repo_ok=true, smoke_ok=true`

## Next Useful Improvements

- Add configurable risk rules.
- Add PR-comment / GitHub Actions output mode.
- Add optional model-generated explanations from sanitized findings.
- Publish an npm package after more external validation.
