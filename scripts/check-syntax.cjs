"use strict";

const cp = require("node:child_process");

const files = [
  "bin/agent-change-auditor.cjs",
  "scripts/check-syntax.cjs",
  "scripts/smoke-test.cjs"
];

for (const file of files) {
  const result = cp.spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    process.exit(result.status);
  }
}

console.log(`syntax_ok=${files.length}`);
