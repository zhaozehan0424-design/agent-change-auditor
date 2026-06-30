"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const requiredFiles = [
  "README.md",
  "CHANGELOG.md",
  "MAINTENANCE.md",
  "REPOSITORY_STATUS.md",
  "SECURITY.md",
  "CONTRIBUTING.md",
  "LICENSE",
  "package.json",
  "bin/agent-change-auditor.cjs",
  "scripts/check-syntax.cjs",
  "scripts/smoke-test.cjs",
  "scripts/check-public-repo.cjs",
  ".github/workflows/ci.yml",
  ".github/ISSUE_TEMPLATE/bug_report.md",
  ".github/pull_request_template.md",
  "docs/self-audit/AI_CHANGE_AUDIT.md"
];

const missing = requiredFiles.filter((file) => !fs.existsSync(path.join(root, file)));
if (missing.length > 0) {
  console.error(`missing_files=${missing.join(",")}`);
  process.exit(1);
}

const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
if (!packageJson.repository || !String(packageJson.repository.url || "").includes("agent-change-auditor")) {
  console.error("package_repository_missing");
  process.exit(1);
}

const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
for (const snippet of ["aca start", "aca stop", "aca claim", "REPOSITORY_STATUS.md", "docs/self-audit/AI_CHANGE_AUDIT.md", "MIT"]) {
  if (!readme.includes(snippet)) {
    console.error(`missing_readme_snippet=${snippet}`);
    process.exit(1);
  }
}

console.log("public_repo_ok=true");
