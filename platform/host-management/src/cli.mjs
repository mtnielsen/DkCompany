#!/usr/bin/env node
/**
 * DKC-058 — operatør-CLI for host- og OS-administration.
 *
 *   node host-management/src/cli.mjs status
 *   node host-management/src/cli.mjs enroll
 *   node host-management/src/cli.mjs enable --actor oidc|anna.andersen
 *   node host-management/src/cli.mjs plan <hostRef>
 *   node host-management/src/cli.mjs capacity <hostRef> --cpu 0.95 --memory 0.5 --disk 0.8
 *   node host-management/src/cli.mjs runbooks
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot, loadEnrollment, loadHostProfile, loadPlatforms, knownHostRunbooks } from "./model.mjs";
import { enrollHost, enableManagement, inventorySummary } from "./enrollment.mjs";
import { evaluateCapacity } from "./capacity.mjs";
import { planHostOperation } from "./operations.mjs";

function print(value) {
  process.stdout.write((typeof value === "string" ? value : JSON.stringify(value, null, 2)) + "\n");
}

function args() {
  const out = { _: [] };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const value = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
      out[key] = value;
    } else out._.push(argv[i]);
  }
  return out;
}

const a = args();
const command = a._[0];
const enrollment = loadEnrollment(repoRoot);
const profile = loadHostProfile(repoRoot);
const platforms = loadPlatforms(repoRoot);

if (command === "status") {
  print({ inventory: inventorySummary(enrollment), management: enrollment.management, profile: profile.metadata.name, platform: enrollment.host.platformRef });
} else if (command === "enroll") {
  const result = enrollHost({ enrollment, actor: { kind: "human", subject: a.actor ?? enrollment.bootstrap.performedBy }, platforms, profile });
  print({ ok: result.ok, enabled: result.enabled, problems: result.problems });
  process.exit(result.ok ? 0 : 1);
} else if (command === "enable") {
  const result = enableManagement({ enrollment, actor: { kind: "human", subject: a.actor ?? "oidc|anna.andersen" }, role: { id: a.role ?? "platform-owner" }, profileRef: profile.metadata.name, now: Date.now() });
  print(result.ok ? { ok: true, management: result.enrollment.management } : result);
  process.exit(result.ok ? 0 : 1);
} else if (command === "plan") {
  const hostRef = a._[1] ?? enrollment.host.id;
  print(planHostOperation({ operation: { operation: { id: "cli-plan", verb: a.verb ?? "diagnose", target: `host/${hostRef}`, parameters: {}, dryRun: true }, hostRef, scope: { mode: "single-server", nodeCount: 1, canary: { hostRef, waitSeconds: 120 } } } }));
} else if (command === "capacity") {
  const hostRef = a._[1] ?? enrollment.host.id;
  print(evaluateCapacity({ hostRef, readings: { cpu: Number(a.cpu), memory: Number(a.memory), disk: Number(a.disk) }, owner: enrollment.ownership.ownerSubject }));
} else if (command === "runbooks") {
  print([...knownHostRunbooks(repoRoot).keys()]);
} else {
  console.log("Kommandoer: status | enroll | enable | plan <hostRef> | capacity <hostRef> | runbooks");
  process.exit(command ? 2 : 0);
}
