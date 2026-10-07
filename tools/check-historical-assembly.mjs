#!/usr/bin/env node
import { mkdtempSync, rmSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const workspace = resolve(fileURLToPath(new URL("..", import.meta.url)));
const assembler = resolve(workspace, "tools/assemble-platform.mjs");
const target = mkdtempSync(resolve(workspace, ".historical-assembly-check-"));
const targetArg = relative(workspace, target).split(/[\\/]/).join("/");

function run(args) {
  const result = spawnSync(process.execPath, [assembler, ...args], { cwd: workspace, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
}

try {
  run(["--target", targetArg]);
  if (!process.exitCode) run(["--target", targetArg, "--check"]);
} finally {
  const absoluteTarget = resolve(workspace, targetArg);
  if (!absoluteTarget.startsWith(`${workspace}${process.platform === "win32" ? "\\" : "/"}`)) {
    throw new Error("historical assembly cleanup target escaped the workspace");
  }
  rmSync(absoluteTarget, { recursive: true, force: true });
}
