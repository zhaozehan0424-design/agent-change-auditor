"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const cp = require("node:child_process");

const root = path.resolve(__dirname, "..");
const cli = path.join(root, "bin", "agent-change-auditor.cjs");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "aca-smoke-"));
const initTemp = fs.mkdtempSync(path.join(os.tmpdir(), "aca-init-smoke-"));

function run(command, args, opts = {}) {
  const result = cp.spawnSync(command, args, {
    cwd: opts.cwd || temp,
    encoding: "utf8",
    shell: false
  });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout;
}

fs.writeFileSync(path.join(initTemp, "app.js"), "console.log('hello');\n");
run(process.execPath, [cli, "init"], { cwd: initTemp });
run("git", ["rev-parse", "HEAD"], { cwd: initTemp });
const initGitignore = fs.readFileSync(path.join(initTemp, ".gitignore"), "utf8");
if (!initGitignore.includes(".agent-auditor/") || !initGitignore.includes("AI_CHANGE_AUDIT*.md")) {
  throw new Error("aca init should add auditor artifacts to .gitignore");
}
run(process.execPath, [cli, "start", "--label", "init smoke"], { cwd: initTemp });

run("git", ["init", "-b", "main"]);
run("git", ["config", "user.name", "Smoke Test"]);
run("git", ["config", "user.email", "smoke@example.invalid"]);
fs.mkdirSync(path.join(temp, "src", "auth"), { recursive: true });
fs.writeFileSync(path.join(temp, "package.json"), JSON.stringify({ scripts: { test: "node -e \"process.exit(0)\"" }, dependencies: {} }, null, 2));
fs.writeFileSync(path.join(temp, "src", "auth", "session.js"), "module.exports = {};\n");
run("git", ["add", "."]);
run("git", ["commit", "-m", "initial"]);

run(process.execPath, [cli, "start", "--label", "smoke"]);
fs.writeFileSync(path.join(temp, "src", "auth", "session.js"), "module.exports = { changed: true };\n");
const packageJson = JSON.parse(fs.readFileSync(path.join(temp, "package.json"), "utf8"));
packageJson.dependencies.jsonwebtoken = "^9.0.0";
fs.writeFileSync(path.join(temp, "package.json"), JSON.stringify(packageJson, null, 2));
run("git", ["add", "src/auth/session.js"]);
run("git", ["commit", "-m", "change auth after baseline"]);
run(process.execPath, [cli, "claim", "I only changed package.json"]);
run(process.execPath, [cli, "stop", "--test", "node -e \"process.exit(0)\"", "--lang", "both"]);

const report = fs.readFileSync(path.join(temp, "AI_CHANGE_AUDIT.md"), "utf8");
const reportZh = fs.readFileSync(path.join(temp, "AI_CHANGE_AUDIT.zh-CN.md"), "utf8");
const reportEn = fs.readFileSync(path.join(temp, "AI_CHANGE_AUDIT.en.md"), "utf8");
if (!report.includes("Authentication or authorization logic changed")) {
  throw new Error("Expected auth risk in report");
}
if (!report.includes("jsonwebtoken")) {
  throw new Error("Expected dependency change in report");
}
if (!report.includes("change auth after baseline")) {
  throw new Error("Expected committed change after baseline in report");
}
if (!report.includes("Agent Claim Check") || !report.includes("src/auth/session.js")) {
  throw new Error("Expected agent claim mismatch in report");
}
if (!reportZh.includes("AI 代码变更审计报告") || !reportZh.includes("Agent 自述对比")) {
  throw new Error("Expected Chinese report");
}
if (!reportEn.includes("AI Change Audit") || !reportEn.includes("Agent Claim Check")) {
  throw new Error("Expected English report");
}
const changedFilesSection = report.split("## Changed Files")[1].split("## Dependency Changes")[0];
if (changedFilesSection.includes(".agent-auditor")) {
  throw new Error("Own audit artifacts should not appear as changed files");
}

console.log("smoke_ok=true");
