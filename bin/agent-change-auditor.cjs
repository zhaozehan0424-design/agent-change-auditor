#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");
const crypto = require("node:crypto");

const AUDIT_DIR = ".agent-auditor";
const BASELINE_FILE = "baseline.json";
const FINDINGS_FILE = "findings.json";
const PATCH_FILE = "diff.patch";
const REPORT_FILE = "AI_CHANGE_AUDIT.md";

const SENSITIVE_PATTERNS = [
  { name: "OpenAI API key", re: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { name: "GitHub token", re: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g },
  { name: "Anthropic API key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { name: "Generic bearer token", re: /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}\b/gi },
  { name: "Likely private key block", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g }
];

const RISK_RULES = [
  { risk: "HIGH", reason: "Authentication or authorization logic changed.", pattern: /(^|\/)(auth|session|sessions|login|logout|oauth|jwt|permission|permissions|rbac|acl)(\/|\.|$)/i },
  { risk: "HIGH", reason: "Environment, secret, or deployment config changed.", pattern: /(^|\/)(\.env|\.env\..+|vercel\.json|netlify\.toml|wrangler\.toml|docker-compose\.ya?ml|Dockerfile)$/i },
  { risk: "HIGH", reason: "CI/CD workflow changed.", pattern: /(^|\/)\.github\/workflows\/.+\.ya?ml$/i },
  { risk: "HIGH", reason: "MCP or agent tool configuration changed.", pattern: /(^|\/)(mcp\.json|mcp\.config\.json|claude_desktop_config\.json|\.cursor\/.+|\.codex\/.+)$/i },
  { risk: "MEDIUM", reason: "Dependency manifest changed.", pattern: /(^|\/)(package\.json|pyproject\.toml|requirements.*\.txt|go\.mod|Cargo\.toml|pom\.xml|build\.gradle)$/i },
  { risk: "MEDIUM", reason: "Lockfile changed; review dependency churn.", pattern: /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|uv\.lock|poetry\.lock|go\.sum|Cargo\.lock)$/i },
  { risk: "MEDIUM", reason: "Server, middleware, API route, or backend entrypoint changed.", pattern: /(^|\/)(server|middleware|api|routes?|controllers?)(\/|\.|$)/i },
  { risk: "MEDIUM", reason: "Database schema or migration changed.", pattern: /(^|\/)(schema|migrations?|prisma)(\/|\.|$)/i },
  { risk: "LOW", reason: "Documentation changed.", pattern: /(^|\/)(README|CHANGELOG|CONTRIBUTING|SECURITY|MAINTENANCE|LICENSE)(\.[A-Za-z0-9]+)?$/i }
];

function main() {
  const [command, ...args] = process.argv.slice(2);
  try {
    if (!command || command === "help" || command === "--help" || command === "-h") {
      printHelp();
      return;
    }
    if (command === "start") return start(args);
    if (command === "finish" || command === "stop") return finish(args);
    if (command === "report") return report(args);
    if (command === "run") return runCommand(args);
    throw new Error(`Unknown command: ${command}`);
  } catch (error) {
    console.error(`agent-change-auditor: ${error.message}`);
    process.exitCode = 1;
  }
}

function printHelp() {
  console.log(`Agent Change Auditor

Usage:
  aca start [--label "task name"]
  aca run -- <command...>
  aca stop [--test "npm test"] [--build "npm run build"]
  aca finish [--test "npm test"] [--build "npm run build"]
  aca report

What it does:
  start   Records the current git state as a baseline.
  run     Runs a command and appends stdout/stderr to the audit log.
  stop    Manually ends the audit window and writes AI_CHANGE_AUDIT.md.
  finish  Alias for stop.
  report  Regenerates AI_CHANGE_AUDIT.md from the latest findings.
`);
}

function start(args) {
  assertGitRepo();
  const opts = parseOptions(args);
  ensureAuditDir();
  const baseline = {
    tool: "agent-change-auditor",
    version: readPackageVersion(),
    label: opts.label || "AI coding agent change",
    startedAt: new Date().toISOString(),
    cwd: process.cwd(),
    head: git(["rev-parse", "HEAD"]).trim(),
    branch: safeGit(["branch", "--show-current"]).trim(),
    status: git(["status", "--short"]),
    node: process.version,
    files: listGitFiles().map((file) => ({ file, sha256: hashFile(file) }))
  };
  fs.writeFileSync(auditPath(BASELINE_FILE), JSON.stringify(baseline, null, 2));
  fs.writeFileSync(auditPath("commands.jsonl"), "");
  fs.writeFileSync(auditPath("commands.log"), "");
  console.log(`baseline_saved=${auditPath(BASELINE_FILE)}`);
  console.log(`head=${baseline.head}`);
}

function runCommand(args) {
  assertGitRepo();
  ensureAuditDir();
  const sep = args.indexOf("--");
  const commandArgs = sep >= 0 ? args.slice(sep + 1) : args;
  if (commandArgs.length === 0) throw new Error("run requires a command after --");

  const startedAt = new Date().toISOString();
  const result = cp.spawnSync(commandArgs[0], commandArgs.slice(1), {
    cwd: process.cwd(),
    encoding: "utf8",
    shell: process.platform === "win32"
  });
  const endedAt = new Date().toISOString();
  const entry = {
    command: commandArgs.join(" "),
    startedAt,
    endedAt,
    exitCode: result.status,
    signal: result.signal || null
  };
  appendJsonl(auditPath("commands.jsonl"), entry);
  appendCommandLog(entry, result.stdout || "", result.stderr || "");
  process.stdout.write(result.stdout || "");
  process.stderr.write(result.stderr || "");
  process.exitCode = result.status || 0;
}

function finish(args) {
  assertGitRepo();
  ensureAuditDir();
  const opts = parseOptions(args);
  const baseline = readBaseline();
  if (opts.test) runAndRecord(opts.test, "test");
  if (opts.build) runAndRecord(opts.build, "build");

  const diffRaw = collectDiff(baseline);
  const diff = redact(diffRaw);
  fs.writeFileSync(auditPath(PATCH_FILE), diff);

  const changedFiles = parseChangedFiles(baseline);
  const stats = parseNumstat(baseline);
  const findings = analyze({
    baseline,
    changedFiles,
    stats,
    diff,
    commandResults: []
  });
  fs.writeFileSync(auditPath(FINDINGS_FILE), JSON.stringify(findings, null, 2));
  fs.writeFileSync(REPORT_FILE, renderReport(findings));
  console.log(`report_written=${path.resolve(REPORT_FILE)}`);
  console.log(`findings_written=${auditPath(FINDINGS_FILE)}`);
}

function report() {
  const findingsPath = auditPath(FINDINGS_FILE);
  if (!fs.existsSync(findingsPath)) throw new Error("No findings found. Run `aca stop` first.");
  const findings = JSON.parse(fs.readFileSync(findingsPath, "utf8"));
  fs.writeFileSync(REPORT_FILE, renderReport(findings));
  console.log(`report_written=${path.resolve(REPORT_FILE)}`);
}

function analyze(input) {
  const changedFiles = input.changedFiles.map((item) => {
    const matched = RISK_RULES.filter((rule) => rule.pattern.test(item.path));
    const risk = highestRisk(matched.map((rule) => rule.risk));
    return {
      ...item,
      risk: risk || "LOW",
      reasons: matched.length ? matched.map((rule) => rule.reason) : ["General source or asset change."]
    };
  });

  const dependencyChanges = detectDependencyChanges(input.diff);
  const sensitiveHits = detectSensitiveHits(input.diff);
  const commandLog = readCommandJsonl();
  const commands = [...commandLog, ...input.commandResults];
  const failedCommands = commands.filter((cmd) => cmd.exitCode !== 0);
  const largeChanges = input.stats.filter((s) => (s.added + s.deleted) >= 500);
  const highRiskFiles = changedFiles.filter((file) => file.risk === "HIGH");
  const mediumRiskFiles = changedFiles.filter((file) => file.risk === "MEDIUM");

  const recommendations = [];
  if (highRiskFiles.length) recommendations.push("Review high-risk files manually before merging or deploying.");
  if (dependencyChanges.added.length || dependencyChanges.removed.length) recommendations.push("Review dependency additions/removals and lockfile churn.");
  if (failedCommands.length) recommendations.push("Re-run failed commands after fixes and attach the output to the review.");
  if (sensitiveHits.length) recommendations.push("Rotate any exposed credentials and remove secrets from git history if real values were committed.");
  if (!commands.length) recommendations.push("Run tests/build through `aca run -- ...` or `aca stop --test ... --build ...` for stronger evidence.");

  return {
    generatedAt: new Date().toISOString(),
    baseline: {
      label: input.baseline.label,
      startedAt: input.baseline.startedAt,
      head: input.baseline.head,
      branch: input.baseline.branch,
      cwd: input.baseline.cwd,
      node: input.baseline.node
    },
    current: {
      head: safeGit(["rev-parse", "HEAD"]).trim(),
      status: git(["status", "--short"]),
      commitsSinceBaseline: listCommitsSince(input.baseline.head)
    },
    summary: {
      changedFileCount: changedFiles.length,
      highRiskFileCount: highRiskFiles.length,
      mediumRiskFileCount: mediumRiskFiles.length,
      failedCommandCount: failedCommands.length,
      sensitiveFindingCount: sensitiveHits.length,
      largeChangeCount: largeChanges.length
    },
    changedFiles,
    dependencyChanges,
    sensitiveHits,
    commands,
    failedCommands,
    largeChanges,
    recommendations
  };
}

function renderReport(findings) {
  const lines = [];
  lines.push("# AI Change Audit");
  lines.push("");
  lines.push(`Generated: ${findings.generatedAt}`);
  lines.push(`Task: ${findings.baseline.label}`);
  lines.push(`Baseline: ${findings.baseline.head}${findings.baseline.branch ? ` (${findings.baseline.branch})` : ""}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Changed files: ${findings.summary.changedFileCount}`);
  lines.push(`- High-risk files: ${findings.summary.highRiskFileCount}`);
  lines.push(`- Medium-risk files: ${findings.summary.mediumRiskFileCount}`);
  lines.push(`- Failed commands: ${findings.summary.failedCommandCount}`);
  lines.push(`- Potential secret findings: ${findings.summary.sensitiveFindingCount}`);
  lines.push(`- Large changes: ${findings.summary.largeChangeCount}`);
  lines.push("");

  lines.push("## Commits Since Baseline");
  lines.push("");
  if (!findings.current.commitsSinceBaseline.length) {
    lines.push("No commits were created after the baseline.");
  } else {
    for (const commit of findings.current.commitsSinceBaseline) {
      lines.push(`- ${commit}`);
    }
  }
  lines.push("");

  lines.push("## Review Focus");
  lines.push("");
  if (findings.recommendations.length) {
    for (const item of findings.recommendations) lines.push(`- ${item}`);
  } else {
    lines.push("- No specific review focus detected.");
  }
  lines.push("");

  lines.push("## Changed Files");
  lines.push("");
  if (!findings.changedFiles.length) {
    lines.push("No git-tracked file changes detected.");
  } else {
    lines.push("| Risk | Status | File | Reason |");
    lines.push("| --- | --- | --- | --- |");
    for (const file of findings.changedFiles) {
      lines.push(`| ${file.risk} | ${file.status} | \`${file.path}\` | ${file.reasons.join("<br>")} |`);
    }
  }
  lines.push("");

  lines.push("## Dependency Changes");
  lines.push("");
  if (!findings.dependencyChanges.added.length && !findings.dependencyChanges.removed.length) {
    lines.push("No dependency additions or removals detected in package manifests.");
  } else {
    for (const item of findings.dependencyChanges.added) lines.push(`- Added: \`${item.name}\` ${item.version || ""}`.trim());
    for (const item of findings.dependencyChanges.removed) lines.push(`- Removed: \`${item.name}\` ${item.version || ""}`.trim());
  }
  lines.push("");

  lines.push("## Commands");
  lines.push("");
  if (!findings.commands.length) {
    lines.push("No commands were recorded.");
  } else {
    lines.push("| Exit | Command | Started |");
    lines.push("| --- | --- | --- |");
    for (const cmd of findings.commands) {
      lines.push(`| ${cmd.exitCode} | \`${escapePipes(cmd.command)}\` | ${cmd.startedAt || ""} |`);
    }
  }
  lines.push("");

  lines.push("## Potential Secrets");
  lines.push("");
  if (!findings.sensitiveHits.length) {
    lines.push("No potential secrets detected in the redacted diff.");
  } else {
    for (const hit of findings.sensitiveHits) {
      lines.push(`- ${hit.name}: ${hit.count} occurrence(s)`);
    }
  }
  lines.push("");

  lines.push("## Artifacts");
  lines.push("");
  lines.push(`- Redacted diff: \`${AUDIT_DIR}/${PATCH_FILE}\``);
  lines.push(`- Machine-readable findings: \`${AUDIT_DIR}/${FINDINGS_FILE}\``);
  lines.push(`- Command log: \`${AUDIT_DIR}/commands.log\``);
  lines.push("");
  lines.push("## Notes");
  lines.push("");
  lines.push("This report is evidence-based. It uses git status, git diff, command output, and deterministic path/content rules. It does not rely on an AI model to decide what changed.");
  lines.push("");
  return lines.join("\n");
}

function detectDependencyChanges(diff) {
  const added = [];
  const removed = [];
  const depLine = /^([+-])\s+"([^"]+)":\s+"([^"]+)"/;
  for (const line of diff.split(/\r?\n/)) {
    const match = depLine.exec(line);
    if (!match) continue;
    const item = { name: match[2], version: match[3] };
    if (match[1] === "+") added.push(item);
    if (match[1] === "-") removed.push(item);
  }
  return { added: uniqueDeps(added), removed: uniqueDeps(removed) };
}

function detectSensitiveHits(diff) {
  const hits = [];
  for (const pattern of SENSITIVE_PATTERNS) {
    const matches = diff.match(pattern.re);
    if (matches && matches.length) hits.push({ name: pattern.name, count: matches.length });
  }
  return hits;
}

function redact(text) {
  let result = text;
  for (const pattern of SENSITIVE_PATTERNS) {
    result = result.replace(pattern.re, (match) => {
      if (/^Bearer\s+/i.test(match)) return "Bearer [REDACTED]";
      return `${match.slice(0, 4)}...[REDACTED]`;
    });
  }
  result = result.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[REDACTED_EMAIL]");
  return result;
}

function collectDiff(baseline) {
  const committedDiff = safeGit(["diff", "--binary", `${baseline.head}..HEAD`]);
  const workingDiff = safeGit(["diff", "--binary"]);
  const stagedDiff = safeGit(["diff", "--cached", "--binary"]);
  return [committedDiff, stagedDiff, workingDiff].filter(Boolean).join("\n");
}

function parseChangedFiles(baseline) {
  const fromCommits = parseNameStatus(safeGit(["diff", "--name-status", `${baseline.head}..HEAD`]));
  const fromStatus = git(["status", "--short", "-uall"]).split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const status = line.slice(0, 2).trim() || "??";
      const rawPath = line.slice(3).trim();
      const renamed = rawPath.includes(" -> ");
      const filePath = renamed ? rawPath.split(" -> ").pop() : rawPath;
      return { status, path: normalizePath(filePath) };
    });
  return mergeChangedFiles([...fromCommits, ...fromStatus]).filter((item) => !isOwnArtifact(item.path));
}

function parseNameStatus(output) {
  return output.split(/\r?\n/).filter(Boolean).map((line) => {
    const parts = line.split(/\t/);
    const status = parts[0];
    const filePath = parts[parts.length - 1];
    return { status, path: normalizePath(filePath || "") };
  });
}

function mergeChangedFiles(items) {
  const map = new Map();
  for (const item of items) {
    if (!item.path) continue;
    map.set(item.path, item);
  }
  return [...map.values()];
}

function parseNumstat(baseline) {
  const output = [
    safeGit(["diff", "--numstat", `${baseline.head}..HEAD`]),
    safeGit(["diff", "--cached", "--numstat"]),
    safeGit(["diff", "--numstat"])
  ].filter(Boolean).join("\n");
  return output.split(/\r?\n/).filter(Boolean).map((line) => {
    const [added, deleted, file] = line.split(/\t/);
    return {
      path: normalizePath(file || ""),
      added: /^\d+$/.test(added) ? Number(added) : 0,
      deleted: /^\d+$/.test(deleted) ? Number(deleted) : 0
    };
  }).filter((item) => !isOwnArtifact(item.path));
}

function listCommitsSince(head) {
  const output = safeGit(["log", "--oneline", `${head}..HEAD`]);
  return output.split(/\r?\n/).filter(Boolean);
}

function listGitFiles() {
  return git(["ls-files"]).split(/\r?\n/).filter(Boolean);
}

function hashFile(file) {
  try {
    const buffer = fs.readFileSync(path.resolve(file));
    return crypto.createHash("sha256").update(buffer).digest("hex");
  } catch {
    return null;
  }
}

function runAndRecord(command, kind) {
  const startedAt = new Date().toISOString();
  const result = cp.spawnSync(command, {
    cwd: process.cwd(),
    encoding: "utf8",
    shell: true
  });
  const endedAt = new Date().toISOString();
  const entry = {
    kind,
    command,
    startedAt,
    endedAt,
    exitCode: result.status,
    signal: result.signal || null
  };
  appendJsonl(auditPath("commands.jsonl"), entry);
  appendCommandLog(entry, result.stdout || "", result.stderr || "");
  return entry;
}

function appendCommandLog(entry, stdout, stderr) {
  const block = [
    `\n=== ${entry.startedAt} :: ${entry.command} ===`,
    `exit=${entry.exitCode}${entry.signal ? ` signal=${entry.signal}` : ""}`,
    "--- stdout ---",
    redact(stdout),
    "--- stderr ---",
    redact(stderr),
    "--- end ---\n"
  ].join("\n");
  fs.appendFileSync(auditPath("commands.log"), block);
}

function readCommandJsonl() {
  const file = auditPath("commands.jsonl");
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function appendJsonl(file, value) {
  fs.appendFileSync(file, `${JSON.stringify(value)}\n`);
}

function readBaseline() {
  const file = auditPath(BASELINE_FILE);
  if (!fs.existsSync(file)) throw new Error("No baseline found. Run `aca start` first.");
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function parseOptions(args) {
  const opts = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--label") opts.label = args[++index];
    else if (arg === "--test") opts.test = args[++index];
    else if (arg === "--build") opts.build = args[++index];
    else throw new Error(`Unknown option: ${arg}`);
  }
  return opts;
}

function git(args) {
  const result = cp.spawnSync("git", args, { cwd: process.cwd(), encoding: "utf8" });
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || "git command failed").trim());
  return result.stdout;
}

function safeGit(args) {
  const result = cp.spawnSync("git", args, { cwd: process.cwd(), encoding: "utf8" });
  return result.status === 0 ? result.stdout : "";
}

function assertGitRepo() {
  git(["rev-parse", "--show-toplevel"]);
}

function ensureAuditDir() {
  fs.mkdirSync(AUDIT_DIR, { recursive: true });
}

function auditPath(file) {
  return path.join(AUDIT_DIR, file);
}

function readPackageVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8")).version;
  } catch {
    return "0.0.0";
  }
}

function normalizePath(file) {
  return file.replace(/\\/g, "/").replace(/^"|"$/g, "");
}

function isOwnArtifact(file) {
  const normalized = normalizePath(file);
  return normalized === REPORT_FILE || normalized.startsWith(`${AUDIT_DIR}/`);
}

function highestRisk(risks) {
  if (risks.includes("HIGH")) return "HIGH";
  if (risks.includes("MEDIUM")) return "MEDIUM";
  if (risks.includes("LOW")) return "LOW";
  return null;
}

function uniqueDeps(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.name}@${item.version}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function escapePipes(value) {
  return String(value).replace(/\|/g, "\\|");
}

main();
