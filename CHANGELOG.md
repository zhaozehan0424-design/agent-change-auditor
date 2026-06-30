# Changelog

## v0.2.1 - 2026-06-30

Repository publication and maintenance pass.

- Added public maintenance, security, contribution, issue-template, PR-template, and repository-status files.
- Added a public-repository verification script to CI.
- Moved self-audit reports into `docs/self-audit/` and ignored future generated audit reports at the repository root.
- Added GitHub repository metadata to `package.json` and README badges.

## v0.2.0 - 2026-06-30

Usability release.

- Added `aca init` for local project setup and initial git snapshots.
- Added `aca claim` to compare an agent's self-reported changes with actual changed files.
- Added `--lang en|zh-CN|both` report output.
- Added committed-change tracking from baseline to current `HEAD`.
- Ignored the auditor's own artifacts in changed-file risk tables.

## v0.1.0 - 2026-06-28

Initial MVP.

- Added `start`, `run`, `stop`/`finish`, and `report` commands.
- Added git baseline capture and redacted diff artifacts.
- Added deterministic risk rules for auth, deployment, CI, MCP, dependency, backend, and documentation changes.
- Added command recording and markdown audit report generation.
- Added syntax checks and smoke test coverage.
