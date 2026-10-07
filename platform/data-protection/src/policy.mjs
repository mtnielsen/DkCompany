/**
 * DKC-047 — den kanoniske beskyttelsespolitik.
 *
 * Adskilt fra registry.mjs, så runtimen kan læse politikken uden at trække
 * conformance/Ajv ind. Politikken er ren data; håndhævelsen ligger i guard.mjs.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const accessPolicyPath = join(here, "..", "policy", "access-policy.json");

let cached = null;

export function defaultAccessPolicy() {
  if (!cached) cached = JSON.parse(readFileSync(accessPolicyPath, "utf8"));
  return cached;
}
