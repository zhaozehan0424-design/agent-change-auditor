# AI Change Audit

Generated: 2026-06-28T13:11:23.858Z
Task: ignore own audit artifacts
Baseline: 2b02a2b60b9d9de6056ce0450e7443c88a105b81 (main)

## Summary

- Changed files: 3
- High-risk files: 0
- Medium-risk files: 0
- Failed commands: 0
- Potential secret findings: 0
- Large changes: 0

## Review Focus

- No specific review focus detected.

## Changed Files

| Risk | Status | File | Reason |
| --- | --- | --- | --- |
| LOW | M | `README.md` | Documentation changed. |
| LOW | M | `bin/agent-change-auditor.cjs` | General source or asset change. |
| LOW | M | `scripts/smoke-test.cjs` | General source or asset change. |

## Dependency Changes

No dependency additions or removals detected in package manifests.

## Commands

| Exit | Command | Started |
| --- | --- | --- |
| 0 | `npm run check` | 2026-06-28T13:11:22.055Z |

## Potential Secrets

No potential secrets detected in the redacted diff.

## Artifacts

- Redacted diff: `.agent-auditor/diff.patch`
- Machine-readable findings: `.agent-auditor/findings.json`
- Command log: `.agent-auditor/commands.log`

## Notes

This report is evidence-based. It uses git status, git diff, command output, and deterministic path/content rules. It does not rely on an AI model to decide what changed.
