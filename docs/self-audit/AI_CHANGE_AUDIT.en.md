# AI Change Audit

Generated: 2026-06-30T06:11:14.128Z
Task: add init lang and claim features
Baseline: 3a6e8983ac195dd832939c50a50b19aec2de853f (main)

## Summary

- Changed files: 5
- High-risk files: 0
- Medium-risk files: 1
- Failed commands: 0
- Potential secret findings: 0
- Large changes: 0

## Commits Since Baseline

No commits were created after the baseline.

## Agent Claim Check

Agent claimed:

> I added aca init, bilingual reports, and agent claim comparison.

Changed files not mentioned by the claim:
- `CHANGELOG.md`
- `README.md`
- `bin/agent-change-auditor.cjs`
- `package.json`
- `scripts/smoke-test.cjs`

## Review Focus

- No specific review focus detected.

## Changed Files

| Risk | Status | File | Reason |
| --- | --- | --- | --- |
| LOW | M | `CHANGELOG.md` | Documentation changed. |
| LOW | M | `README.md` | Documentation changed. |
| LOW | M | `bin/agent-change-auditor.cjs` | General source or asset change. |
| MEDIUM | M | `package.json` | Dependency manifest changed. |
| LOW | M | `scripts/smoke-test.cjs` | General source or asset change. |

## Dependency Changes

No dependency additions or removals detected in package manifests.

## Commands

| Exit | Command | Started |
| --- | --- | --- |
| 0 | `npm run check` | 2026-06-30T06:08:25.722Z |
| 0 | `npm run check` | 2026-06-30T06:11:09.964Z |

## Potential Secrets

No potential secrets detected in the redacted diff.

## Artifacts

- Redacted diff: `.agent-auditor/diff.patch`
- Machine-readable findings: `.agent-auditor/findings.json`
- Command log: `.agent-auditor/commands.log`

## Notes

This report is evidence-based. It uses git status, git diff, command output, and deterministic path/content rules. It does not rely on an AI model to decide what changed.
