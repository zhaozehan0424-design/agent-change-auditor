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
const CLAIM_FILE = "claim.md";
const REPORT_FILE = "AI_CHANGE_AUDIT.md";
const REPORT_EN_FILE = "AI_CHANGE_AUDIT.en.md";
const REPORT_ZH_FILE = "AI_CHANGE_AUDIT.zh-CN.md";

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
    if (command === "init") return initRepo(args);
    if (command === "start") return start(args);
    if (command === "claim") return claim(args);
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
  aca init [--no-snapshot]
  aca start [--label "task name"]
  aca claim "agent said it only changed README"
  aca claim --file agent-summary.md
  aca run -- <command...>
  aca stop [--test "npm test"] [--build "npm run build"] [--lang en|zh-CN|both]
  aca finish [--test "npm test"] [--build "npm run build"] [--lang en|zh-CN|both]
  aca report [--lang en|zh-CN|both]

What it does:
  init    Initializes a local git repo and initial snapshot when needed.
  start   Records the current git state as a baseline.
  claim   Records what the agent claims it changed for later comparison.
  run     Runs a command and appends stdout/stderr to the audit log.
  stop    Manually ends the audit window and writes AI_CHANGE_AUDIT.md.
  finish  Alias for stop.
  report  Regenerates AI_CHANGE_AUDIT.md from the latest findings.
`);
}

function initRepo(args) {
  const opts = parseOptions(args, { allowNoSnapshot: true });
  const wasRepo = isGitRepo();
  if (!wasRepo) {
    const init = cp.spawnSync("git", ["init", "-b", "main"], { cwd: process.cwd(), encoding: "utf8" });
    if (init.status !== 0) {
      const fallback = cp.spawnSync("git", ["init"], { cwd: process.cwd(), encoding: "utf8" });
      if (fallback.status !== 0) throw new Error((fallback.stderr || fallback.stdout || "git init failed").trim());
    }
    console.log("git_repo_initialized=true");
  } else {
    console.log("git_repo_initialized=already_exists");
  }

  ensureToolGitignoreEntries();

  if (opts.noSnapshot) {
    console.log("snapshot=skipped");
    console.log("next=git add . && git commit -m \"Initial snapshot\" && aca start --label \"your task\"");
    return;
  }

  if (hasGitCommit()) {
    console.log("snapshot=already_has_commits");
    console.log("next=aca start --label \"your task\"");
    return;
  }

  ensureLocalGitIdentity();
  git(["add", "."]);
  const diffCached = safeGit(["diff", "--cached", "--name-only"]).trim();
  if (diffCached) {
    git(["commit", "-m", "Initial snapshot"]);
    console.log("snapshot=created");
  } else {
    git(["commit", "--allow-empty", "-m", "Initial empty snapshot"]);
    console.log("snapshot=created_empty");
  }
  console.log(`head=${git(["rev-parse", "HEAD"]).trim()}`);
  console.log("next=aca start --label \"your task\"");
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
  removeIfExists(auditPath(CLAIM_FILE));
  console.log(`baseline_saved=${auditPath(BASELINE_FILE)}`);
  console.log(`head=${baseline.head}`);
}

function claim(args) {
  assertGitRepo();
  ensureAuditDir();
  const parsed = parseClaimArgs(args);
  const claimText = redact(parsed.text.trim());
  if (!claimText) throw new Error("claim requires text, for example: aca claim \"I only changed README.md\"");
  fs.writeFileSync(auditPath(CLAIM_FILE), `${claimText}\n`);
  console.log(`claim_saved=${auditPath(CLAIM_FILE)}`);
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
  const lang = normalizeLang(opts.lang);
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
  const reports = writeReports(findings, lang);
  for (const file of reports) console.log(`report_written=${path.resolve(file)}`);
  console.log(`findings_written=${auditPath(FINDINGS_FILE)}`);
}

function report(args = []) {
  const opts = parseOptions(args);
  const lang = normalizeLang(opts.lang);
  const findingsPath = auditPath(FINDINGS_FILE);
  if (!fs.existsSync(findingsPath)) throw new Error("No findings found. Run `aca stop` first.");
  const findings = JSON.parse(fs.readFileSync(findingsPath, "utf8"));
  const reports = writeReports(findings, lang);
  for (const file of reports) console.log(`report_written=${path.resolve(file)}`);
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

  const dependencyChanges = detectDependencyChanges(input.baseline.head);
  const sensitiveHits = detectSensitiveHits(input.diff);
  const commandLog = readCommandJsonl();
  const commands = [...commandLog, ...input.commandResults];
  const claimText = readClaim();
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
    claim: analyzeClaim(claimText, changedFiles),
    commands,
    failedCommands,
    largeChanges,
    recommendations
  };
}

function writeReports(findings, lang) {
  const written = [];
  if (lang === "both") {
    fs.writeFileSync(REPORT_FILE, renderReport(findings));
    fs.writeFileSync(REPORT_EN_FILE, renderReport(findings));
    writeUtf8Bom(REPORT_ZH_FILE, renderZhReport(findings));
    written.push(REPORT_FILE, REPORT_EN_FILE, REPORT_ZH_FILE);
    return written;
  }
  if (lang === "zh-CN") {
    writeUtf8Bom(REPORT_FILE, renderZhReport(findings));
    writeUtf8Bom(REPORT_ZH_FILE, renderZhReport(findings));
    written.push(REPORT_FILE, REPORT_ZH_FILE);
    return written;
  }
  fs.writeFileSync(REPORT_FILE, renderReport(findings));
  fs.writeFileSync(REPORT_EN_FILE, renderReport(findings));
  written.push(REPORT_FILE, REPORT_EN_FILE);
  return written;
}

function writeUtf8Bom(file, text) {
  fs.writeFileSync(file, `\uFEFF${text}`, "utf8");
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

  lines.push("## Agent Claim Check");
  lines.push("");
  if (!findings.claim || !findings.claim.text) {
    lines.push("No agent claim was recorded. Use `aca claim \"...\"` before `aca stop` to compare the agent's self-report with the actual diff.");
  } else {
    lines.push("Agent claimed:");
    lines.push("");
    lines.push(`> ${findings.claim.text.replace(/\r?\n/g, "\n> ")}`);
    lines.push("");
    if (!findings.claim.omittedChangedFiles.length && !findings.claim.claimedButNotChanged.length) {
      lines.push("No obvious mismatch detected by the filename-based claim check.");
    } else {
      if (findings.claim.omittedChangedFiles.length) {
        lines.push("Changed files not mentioned by the claim:");
        for (const file of findings.claim.omittedChangedFiles) lines.push(`- \`${file}\``);
      }
      if (findings.claim.claimedButNotChanged.length) {
        lines.push("Files mentioned by the claim but not changed:");
        for (const file of findings.claim.claimedButNotChanged) lines.push(`- \`${file}\``);
      }
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

function renderZhReport(findings) {
  const lines = [];
  lines.push("# AI 代码变更审计报告");
  lines.push("");
  lines.push(`生成时间：${findings.generatedAt}`);
  lines.push(`任务：${findings.baseline.label}`);
  lines.push(`基线：${findings.baseline.head}${findings.baseline.branch ? ` (${findings.baseline.branch})` : ""}`);
  lines.push("");
  lines.push("## 摘要");
  lines.push("");
  lines.push(`- 变更文件数：${findings.summary.changedFileCount}`);
  lines.push(`- 高风险文件：${findings.summary.highRiskFileCount}`);
  lines.push(`- 中风险文件：${findings.summary.mediumRiskFileCount}`);
  lines.push(`- 失败命令：${findings.summary.failedCommandCount}`);
  lines.push(`- 潜在密钥发现：${findings.summary.sensitiveFindingCount}`);
  lines.push(`- 大规模变更：${findings.summary.largeChangeCount}`);
  lines.push("");

  lines.push("## 基线之后的提交");
  lines.push("");
  if (!findings.current.commitsSinceBaseline.length) {
    lines.push("基线之后没有新的提交。");
  } else {
    for (const commit of findings.current.commitsSinceBaseline) {
      lines.push(`- ${commit}`);
    }
  }
  lines.push("");

  lines.push("## Agent 自述对比");
  lines.push("");
  if (!findings.claim || !findings.claim.text) {
    lines.push("没有记录 agent 自述。可以在 `aca stop` 前运行 `aca claim \"...\"`，把 agent 自己说的改动和真实 diff 做对比。");
  } else {
    lines.push("Agent 自述：");
    lines.push("");
    lines.push(`> ${findings.claim.text.replace(/\r?\n/g, "\n> ")}`);
    lines.push("");
    if (!findings.claim.omittedChangedFiles.length && !findings.claim.claimedButNotChanged.length) {
      lines.push("基于文件名的检查没有发现明显不一致。");
    } else {
      if (findings.claim.omittedChangedFiles.length) {
        lines.push("真实改动中存在，但 agent 没提到的文件：");
        for (const file of findings.claim.omittedChangedFiles) lines.push(`- \`${file}\``);
      }
      if (findings.claim.claimedButNotChanged.length) {
        lines.push("Agent 提到了，但实际没有变化的文件：");
        for (const file of findings.claim.claimedButNotChanged) lines.push(`- \`${file}\``);
      }
    }
  }
  lines.push("");

  lines.push("## 审查重点");
  lines.push("");
  if (findings.recommendations.length) {
    for (const item of findings.recommendations) lines.push(`- ${translateRecommendation(item)}`);
  } else {
    lines.push("- 没有检测到特别的审查重点。");
  }
  lines.push("");

  lines.push("## 变更文件");
  lines.push("");
  if (!findings.changedFiles.length) {
    lines.push("没有检测到 git 跟踪的项目文件变更。");
  } else {
    lines.push("| 风险 | 状态 | 文件 | 原因 |");
    lines.push("| --- | --- | --- | --- |");
    for (const file of findings.changedFiles) {
      lines.push(`| ${translateRisk(file.risk)} | ${translateStatus(file.status)} | \`${file.path}\` | ${file.reasons.map(translateReason).join("<br>")} |`);
    }
  }
  lines.push("");

  lines.push("## 依赖变化");
  lines.push("");
  if (!findings.dependencyChanges.added.length && !findings.dependencyChanges.removed.length) {
    lines.push("没有在依赖清单中检测到依赖新增或移除。");
  } else {
    for (const item of findings.dependencyChanges.added) lines.push(`- 新增：\`${item.name}\` ${item.version || ""}`.trim());
    for (const item of findings.dependencyChanges.removed) lines.push(`- 移除：\`${item.name}\` ${item.version || ""}`.trim());
  }
  lines.push("");

  lines.push("## 命令记录");
  lines.push("");
  if (!findings.commands.length) {
    lines.push("没有记录命令。");
  } else {
    lines.push("| 退出码 | 命令 | 开始时间 |");
    lines.push("| --- | --- | --- |");
    for (const cmd of findings.commands) {
      lines.push(`| ${cmd.exitCode} | \`${escapePipes(cmd.command)}\` | ${cmd.startedAt || ""} |`);
    }
  }
  lines.push("");

  lines.push("## 潜在密钥");
  lines.push("");
  if (!findings.sensitiveHits.length) {
    lines.push("没有在脱敏后的 diff 中检测到潜在密钥。");
  } else {
    for (const hit of findings.sensitiveHits) {
      lines.push(`- ${hit.name}：${hit.count} 处`);
    }
  }
  lines.push("");

  lines.push("## 产物");
  lines.push("");
  lines.push(`- 脱敏 diff：\`${AUDIT_DIR}/${PATCH_FILE}\``);
  lines.push(`- 机器可读结果：\`${AUDIT_DIR}/${FINDINGS_FILE}\``);
  lines.push(`- 命令日志：\`${AUDIT_DIR}/commands.log\``);
  lines.push("");
  lines.push("## 说明");
  lines.push("");
  lines.push("这份报告基于证据生成：git status、git diff、命令输出以及确定性的路径/内容规则。它不依赖 AI 模型判断改了什么。");
  lines.push("");
  return lines.join("\n");
}

function detectDependencyChanges(baselineHead) {
  const added = [];
  const removed = [];
  const files = getChangedPathSet(baselineHead).filter((file) => path.basename(file) === "package.json");
  for (const file of files) {
    const before = readPackageJsonFromGit(baselineHead, file);
    const after = readPackageJsonFromWorkingTree(file);
    const beforeDeps = collectDependencyMap(before);
    const afterDeps = collectDependencyMap(after);
    for (const [name, version] of afterDeps.entries()) {
      if (!beforeDeps.has(name)) added.push({ name, version, file });
      else if (beforeDeps.get(name) !== version) {
        removed.push({ name, version: beforeDeps.get(name), file });
        added.push({ name, version, file });
      }
    }
    for (const [name, version] of beforeDeps.entries()) {
      if (!afterDeps.has(name)) removed.push({ name, version, file });
    }
  }
  return { added: uniqueDeps(added), removed: uniqueDeps(removed) };
}

function getChangedPathSet(baselineHead) {
  const output = [
    safeGit(["diff", "--name-only", `${baselineHead}..HEAD`]),
    safeGit(["diff", "--cached", "--name-only"]),
    safeGit(["diff", "--name-only"])
  ].filter(Boolean).join("\n");
  return [...new Set(output.split(/\r?\n/).filter(Boolean).map(normalizePath))];
}

function readPackageJsonFromGit(ref, file) {
  const text = safeGit(["show", `${ref}:${file}`]);
  return parseJsonOrEmpty(text);
}

function readPackageJsonFromWorkingTree(file) {
  const full = path.resolve(file);
  if (!fs.existsSync(full)) return {};
  return parseJsonOrEmpty(fs.readFileSync(full, "utf8"));
}

function parseJsonOrEmpty(text) {
  if (!text || !text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function collectDependencyMap(pkg) {
  const result = new Map();
  for (const section of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
    const deps = pkg && typeof pkg[section] === "object" && pkg[section] ? pkg[section] : {};
    for (const [name, version] of Object.entries(deps)) {
      result.set(name, String(version));
    }
  }
  return result;
}

function detectSensitiveHits(diff) {
  const hits = [];
  for (const pattern of SENSITIVE_PATTERNS) {
    const matches = diff.match(pattern.re);
    if (matches && matches.length) hits.push({ name: pattern.name, count: matches.length });
  }
  return hits;
}

function readClaim() {
  const file = auditPath(CLAIM_FILE);
  if (!fs.existsSync(file)) return "";
  return redact(fs.readFileSync(file, "utf8").trim());
}

function analyzeClaim(text, changedFiles) {
  if (!text) return { text: "", mentionedChangedFiles: [], omittedChangedFiles: [], claimedButNotChanged: [] };
  const lower = text.toLowerCase();
  const mentionedChangedFiles = [];
  const omittedChangedFiles = [];
  for (const file of changedFiles) {
    const full = file.path.toLowerCase();
    const base = path.basename(file.path).toLowerCase();
    if (lower.includes(full) || lower.includes(base)) mentionedChangedFiles.push(file.path);
    else omittedChangedFiles.push(file.path);
  }

  const claimedPaths = extractClaimedPaths(text);
  const actual = new Set(changedFiles.map((file) => file.path.toLowerCase()));
  const actualBase = new Set(changedFiles.map((file) => path.basename(file.path).toLowerCase()));
  const claimedButNotChanged = claimedPaths.filter((file) => {
    const normalized = normalizePath(file).toLowerCase();
    return !actual.has(normalized) && !actualBase.has(path.basename(normalized));
  });
  return { text, mentionedChangedFiles, omittedChangedFiles, claimedButNotChanged };
}

function extractClaimedPaths(text) {
  const found = new Set();
  const patterns = [
    /`([^`]+\.[A-Za-z0-9]{1,12})`/g,
    /(?:^|\s)([A-Za-z0-9_.\-\\/]+\.[A-Za-z0-9]{1,12})(?=\s|$|,|;|。|，)/g
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      found.add(normalizePath(match[1].trim()));
    }
  }
  return [...found];
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

function parseOptions(args, config = {}) {
  const opts = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--label") opts.label = args[++index];
    else if (arg === "--test") opts.test = args[++index];
    else if (arg === "--build") opts.build = args[++index];
    else if (arg === "--lang") opts.lang = args[++index];
    else if (arg === "--no-snapshot" && config.allowNoSnapshot) opts.noSnapshot = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  return opts;
}

function parseClaimArgs(args) {
  if (!args.length) return { text: "" };
  if (args[0] === "--file") {
    const file = args[1];
    if (!file) throw new Error("claim --file requires a path");
    return { text: fs.readFileSync(path.resolve(file), "utf8") };
  }
  return { text: args.join(" ") };
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
  if (!isGitRepo()) {
    throw new Error([
      "Current directory is not a git repository.",
      "Run this inside your project directory, or initialize a local snapshot first:",
      "  aca init",
      "Then start an audit:",
      "  aca start --label \"your task\""
    ].join("\n"));
  }
  if (!hasGitCommit()) {
    throw new Error([
      "This git repository has no commits yet, so there is no baseline HEAD.",
      "Create an initial snapshot first:",
      "  aca init",
      "or manually run:",
      "  git add . && git commit -m \"Initial snapshot\""
    ].join("\n"));
  }
}

function isGitRepo() {
  const result = cp.spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: process.cwd(), encoding: "utf8" });
  return result.status === 0;
}

function hasGitCommit() {
  const result = cp.spawnSync("git", ["rev-parse", "--verify", "HEAD"], { cwd: process.cwd(), encoding: "utf8" });
  return result.status === 0;
}

function ensureLocalGitIdentity() {
  const name = safeGit(["config", "user.name"]).trim();
  const email = safeGit(["config", "user.email"]).trim();
  if (!name) git(["config", "user.name", "Agent Change Auditor"]);
  if (!email) git(["config", "user.email", "agent-change-auditor@example.invalid"]);
}

function ensureToolGitignoreEntries() {
  const file = path.resolve(".gitignore");
  const entries = [".agent-auditor/", "AI_CHANGE_AUDIT*.md"];
  const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const lines = existing.split(/\r?\n/);
  const missing = entries.filter((entry) => !lines.includes(entry));
  if (!missing.length) {
    console.log("gitignore=already_configured");
    return;
  }
  const prefix = existing && !existing.endsWith("\n") ? "\n" : "";
  fs.appendFileSync(file, `${prefix}${missing.join("\n")}\n`);
  console.log(`gitignore_added=${missing.join(",")}`);
}

function ensureAuditDir() {
  fs.mkdirSync(AUDIT_DIR, { recursive: true });
}

function auditPath(file) {
  return path.join(AUDIT_DIR, file);
}

function removeIfExists(file) {
  if (fs.existsSync(file)) fs.rmSync(file, { force: true });
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
  return /^AI_CHANGE_AUDIT(\.[A-Za-z0-9-]+)?\.md$/.test(normalized) || normalized.startsWith(`${AUDIT_DIR}/`);
}

function normalizeLang(lang) {
  const value = String(lang || "en").toLowerCase();
  if (value === "both") return "both";
  if (value === "zh" || value === "zh-cn" || value === "cn") return "zh-CN";
  if (value === "en" || value === "en-us") return "en";
  throw new Error(`Unsupported language: ${lang}. Use en, zh-CN, or both.`);
}

function translateRisk(risk) {
  return { HIGH: "高", MEDIUM: "中", LOW: "低" }[risk] || risk;
}

function translateStatus(status) {
  return {
    M: "修改",
    A: "新增",
    D: "删除",
    R: "重命名",
    C: "复制",
    "??": "未跟踪"
  }[status] || status;
}

function translateReason(reason) {
  return {
    "Authentication or authorization logic changed.": "认证或授权逻辑发生变化。",
    "Environment, secret, or deployment config changed.": "环境变量、密钥或部署配置发生变化。",
    "CI/CD workflow changed.": "CI/CD 工作流发生变化。",
    "MCP or agent tool configuration changed.": "MCP 或 agent 工具配置发生变化。",
    "Dependency manifest changed.": "依赖清单发生变化。",
    "Lockfile changed; review dependency churn.": "锁文件发生变化，需要检查依赖波动。",
    "Server, middleware, API route, or backend entrypoint changed.": "服务端、中间件、API 路由或后端入口发生变化。",
    "Database schema or migration changed.": "数据库 schema 或迁移发生变化。",
    "Documentation changed.": "文档发生变化。",
    "General source or asset change.": "普通源码或资源变更。"
  }[reason] || reason;
}

function translateRecommendation(item) {
  return {
    "Review high-risk files manually before merging or deploying.": "合并或部署前，请人工审查高风险文件。",
    "Review dependency additions/removals and lockfile churn.": "请审查依赖新增/移除以及锁文件变化。",
    "Re-run failed commands after fixes and attach the output to the review.": "修复后请重新运行失败命令，并把输出附到审查中。",
    "Rotate any exposed credentials and remove secrets from git history if real values were committed.": "如果真实密钥被提交，请轮换凭据并从 git 历史中移除密钥。",
    "Run tests/build through `aca run -- ...` or `aca stop --test ... --build ...` for stronger evidence.": "建议通过 `aca run -- ...` 或 `aca stop --test ... --build ...` 记录测试/构建命令，以获得更强证据。"
  }[item] || item;
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
