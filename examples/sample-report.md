# Example Workflow

```powershell
aca start --label "agent updated auth flow"

# Ask Codex, Claude Code, Cursor, or another coding agent to work.

aca run -- npm test
aca stop --build "npm run build"
```

The generated `AI_CHANGE_AUDIT.md` highlights the review focus instead of asking
the same agent to self-report its own behavior.
