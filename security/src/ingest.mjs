/**
 * 3.4 — Indsamling af rå scanneroutput til én normaliseret SecurityFindings-pakke.
 *
 * De committede rå filer er repræsentative samples, så normaliseringen kan
 * testes deterministisk. I CI kører Trivy rigtigt og rapporten uploades som
 * artefakt; i produktion erstatter live-rapporter samplet, og den normaliserede
 * pakke går videre til OSCAL-emitteren.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeFalco, normalizeTrivy, normalizeWazuh } from "./normalize.mjs";

export const SAMPLE_SCANNERS = [
  { file: "trivy-app.json", kind: "trivy", capturedAt: "2025-09-01T10:00:00Z", target: "platform-repo" },
  { file: "falco-events.json", kind: "falco", capturedAt: "2025-09-01T10:05:00Z", target: "runtime:platform" },
  { file: "wazuh-alerts.json", kind: "wazuh", capturedAt: "2025-09-01T10:10:00Z", target: "siem:platform" },
];

const sha256File = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

export function buildBundle({ root }) {
  const rawDir = join(root, "security", "raw");
  const reports = [];

  for (const spec of SAMPLE_SCANNERS) {
    const path = join(rawDir, spec.file);
    if (!existsSync(path)) continue;
    const raw = JSON.parse(readFileSync(path, "utf8"));
    const artifact = { uri: `security/raw/${spec.file}`, sha256: sha256File(path) };
    const meta = { capturedAt: spec.capturedAt, artifact, target: spec.target };
    if (spec.kind === "trivy") reports.push(normalizeTrivy(raw, { ...meta, target: raw.ArtifactName ?? spec.target }));
    else if (spec.kind === "falco") reports.push(normalizeFalco(raw, meta));
    else reports.push(normalizeWazuh(raw, meta));
  }

  const generatedAt = reports.map((r) => r.capturedAt).sort().pop() ?? "2025-09-01T00:00:00Z";
  return { apiVersion: "contracts.platform/v1alpha1", kind: "SecurityFindings", generatedAt, reports };
}
