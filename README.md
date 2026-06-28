# Agent Change Auditor

Evidence-based audit reports for AI coding agent changes.

This is a small local CLI for people who let AI agents edit code, but still want
a human-readable review trail afterwards. It records a baseline before the agent
works, then generates an audit report from git diff, command output, path rules,
dependency changes, and redaction checks.

The audit window is deliberately manual: you decide when to start and when to
stop. The tool does not guess that the agent is "done"; it records the evidence
between two explicit checkpoints.

It does not need an AI model. The first version is intentionally deterministic:
AI can be added later as an optional explanation layer, but the evidence comes
from git and command logs.

## Why

Asking an agent "what did you change?" is useful, but it is not evidence. The
agent may omit risky files, summarize too broadly, or miss indirect changes.
Agent Change Auditor records the facts:

- which files changed
- which high-risk paths changed
- whether dependencies or lockfiles changed
- which commands were run and whether they failed
- whether the diff appears to contain secrets
- where a human should focus review

## Good Fit

Use this when an AI coding agent makes non-trivial changes and you want a review
artifact before committing, merging, or deploying. It is especially useful for
changes that touch auth, dependencies, CI, deployment config, MCP config, or
server-side code.

It is not meant to replace human review, tests, or full security scanning. It is
the small independent record that helps a reviewer know where to look first.

## Quick Start

From inside a git repository:

```powershell
aca start --label "refactor login flow"
```

Let your coding agent work, then record checks and generate the report:

```powershell
aca stop --test "npm test" --build "npm run build"
```

`aca finish` is kept as an alias for `aca stop`, but `stop` better reflects the
manual "end the audit now" workflow.

Artifacts:

```text
AI_CHANGE_AUDIT.md
.agent-auditor/findings.json
.agent-auditor/diff.patch
.agent-auditor/commands.log
```

You can also record commands as you go:

```powershell
aca run -- npm install
aca run -- npm test
```

## Risk Rules

The MVP flags risky changes using path-based rules:

- `HIGH`: auth/session/login/OAuth/JWT paths
- `HIGH`: `.env*`, `vercel.json`, `Dockerfile`, deployment config
- `HIGH`: `.github/workflows/*`
- `HIGH`: MCP, Cursor, Claude Desktop, or Codex tool config
- `MEDIUM`: dependency manifests and lockfiles
- `MEDIUM`: server, middleware, API route, database schema, migrations
- `LOW`: documentation

## Secret Redaction

The generated diff and command logs redact common token patterns such as OpenAI
keys, GitHub tokens, bearer tokens, private key blocks, and email addresses.

This tool is not a replacement for full secret scanning. It is a local audit
trail for AI-assisted code changes.

## Status

This is an MVP. Good next steps:

- compare an agent-written summary with the actual diff
- add PR comment output
- add configurable rules
- add framework-specific rules for Next.js, Vercel, MCP, and Python projects
- add optional model-generated explanations from sanitized findings

## License

MIT.
