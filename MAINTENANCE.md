# Maintenance

Agent Change Auditor should stay evidence-first.

## Release Checklist

- Run `npm run check`.
- Run a manual audit against a small temporary repo.
- Review `AI_CHANGE_AUDIT.md` for duplicated commands, missing high-risk flags, and accidental secret output.
- Update `CHANGELOG.md`.

## Rule Changes

When adding a new risk rule:

- keep the rule deterministic
- add a smoke test if the rule targets a new file family
- avoid noisy broad matches that make every source file high risk
- prefer `HIGH` only for auth, secrets, deployment, CI, MCP/tool access, and other review-critical paths

## AI Features

Optional AI summaries can be added later, but they must read sanitized findings
instead of raw files or unredacted command output. The deterministic report
should remain useful without any model call.
