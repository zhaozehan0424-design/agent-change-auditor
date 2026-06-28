# AI Change Audit

Generated: 2026-06-28T11:40:59.520Z
Task: fix duplicate command reporting
Baseline: 5945e8bd65206c754a08c18d533691cc1044eb5b (main)

## Summary

- Changed files: 6
- High-risk files: 1
- Medium-risk files: 0
- Failed commands: 0
- Potential secret findings: 0
- Large changes: 0

## Review Focus

- Review high-risk files manually before merging or deploying.

## Changed Files

| Risk | Status | File | Reason |
| --- | --- | --- | --- |
| LOW | M | `README.md` | Documentation changed. |
| LOW | M | `bin/agent-change-auditor.cjs` | General source or asset change. |
| HIGH | ?? | `.github/workflows/ci.yml` | CI/CD workflow changed. |
| LOW | ?? | `AI_CHANGE_AUDIT.md` | General source or asset change. |
| LOW | ?? | `CHANGELOG.md` | Documentation changed. |
| LOW | ?? | `MAINTENANCE.md` | Documentation changed. |

## Dependency Changes

No dependency additions or removals detected in package manifests.

## Commands

| Exit | Command | Started |
| --- | --- | --- |
| 0 | `npm run check` | 2026-06-28T11:39:22.201Z |
| 0 | `npm run check` | 2026-06-28T11:40:23.125Z |
| 0 | `npm run check` | 2026-06-28T11:40:57.605Z |

## Potential Secrets

No potential secrets detected in the redacted diff.

## Artifacts

- Redacted diff: `.agent-auditor/diff.patch`
- Machine-readable findings: `.agent-auditor/findings.json`
- Command log: `.agent-auditor/commands.log`

## Notes

This report is evidence-based. It uses git status, git diff, command output, and deterministic path/content rules. It does not rely on an AI model to decide what changed.
