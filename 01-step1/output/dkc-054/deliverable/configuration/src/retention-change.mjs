/**
 * DKC-054 — preview af retentionændringer.
 *
 * En retentionændring er ikke bare et tal. Previewet viser hvilke dataklasser
 * og databærende artefakter ændringen berører, og afviser enhver ændring der
 * forkorter en WORM-beskyttet klasse eller bryder et legal hold eller den
 * menneskeligt vedtagne ramme. En tilladt ændring kræver stadig en navngiven
 * menneskelig autorisation.
 */
import { KNOWN_DATA_CLASSES, PROTECTED_DATA_CLASSES } from "./model.mjs";

const DATA_REGISTER_PATH = "compliance/data-register.json";

/**
 * @param {object} opts
 * @param {object} opts.current    Nuværende retention pr. dataklasse.
 * @param {Array}  opts.requested  [{ dataClass, toDays }]
 * @param {Array}  opts.holds      [{ dataClass, legalHoldRef, worm, until }]
 * @param {object} opts.frame      { frameRef, approvedBy, approvedAt, minRetentionDays, maxRetentionDays }
 * @param {object} opts.dataRegister  Kanonisk register (records/artifacts pr. dataklasse).
 * @param {object} opts.authorization Navngiven menneskelig autorisation.
 */
export function previewRetentionChange({
  installationId = "acme-prod",
  changeId,
  current,
  requested,
  holds = [],
  frame,
  dataRegister = null,
  authorization,
  now = Date.now(),
} = {}) {
  const problems = [];
  if (!frame || !frame.frameRef) problems.push({ path: "/frames", message: "en menneskeligt vedtaget ramme kræves" });
  if (!authorization || !/^[a-z][a-z0-9-]*\|/.test(authorization.humanSubject ?? "")) {
    problems.push({ path: "/authorization", message: "retentionændringer kræver en navngiven menneskelig autorisation" });
  }
  if (!Array.isArray(requested) || requested.length === 0) problems.push({ path: "/requested", message: "mindst én anmodet ændring kræves" });

  const currentMap = new Map((current ?? []).map((c) => [c.dataClass, c]));
  const holdMap = new Map((holds ?? []).map((h) => [h.dataClass, h]));
  const affected = new Map();
  const decisions = [];

  for (const [i, change] of (requested ?? []).entries()) {
    const from = currentMap.get(change.dataClass);
    const fromDays = change.fromDays ?? from?.retentionDays ?? 0;
    const toDays = change.toDays;
    const hold = holdMap.get(change.dataClass);
    const base = { dataClass: change.dataClass, records: 0, personalData: PROTECTED_DATA_CLASSES.includes(change.dataClass), artifacts: [] };
    affected.set(change.dataClass, { ...(affected.get(change.dataClass) ?? base), records: (affected.get(change.dataClass)?.records ?? 0) + 1 });

    if (!KNOWN_DATA_CLASSES.includes(change.dataClass)) {
      decisions.push({ dataClass: change.dataClass, allowed: false, reason: `ukendt dataklasse '${change.dataClass}'` });
      continue;
    }
    if (!Number.isInteger(toDays) || toDays < 1) {
      decisions.push({ dataClass: change.dataClass, allowed: false, reason: "retention skal være et positivt heltal" });
      continue;
    }
    if (frame && (toDays < frame.minRetentionDays || toDays > frame.maxRetentionDays)) {
      decisions.push({ dataClass: change.dataClass, allowed: false, reason: `uden for den vedtagne ramme [${frame.minRetentionDays}, ${frame.maxRetentionDays}]` });
      continue;
    }
    if (hold) {
      const untilDays = hold.until ? Math.ceil((Date.parse(hold.until) - now) / 86400000) : Infinity;
      if (toDays < untilDays) {
        decisions.push({ dataClass: change.dataClass, allowed: false, reason: `legal hold '${hold.legalHoldRef}' kræver mindst ${untilDays} dage` });
        continue;
      }
    }
    if (hold?.worm === true || from?.worm === true) {
      if (toDays < fromDays) {
        decisions.push({ dataClass: change.dataClass, allowed: false, reason: "WORM-beskyttet retention må ikke forkortes" });
        continue;
      }
    }
    decisions.push({ dataClass: change.dataClass, allowed: true, reason: `inden for rammen '${frame.frameRef}'` });
  }

  // Berig de berørte klasser med den kanoniske registers records/artefakter.
  for (const [dataClass, entry] of affected.entries()) {
    const fromRegister = dataRegister?.entries?.find?.((e) => (e.dataCategories ?? []).includes(dataClass));
    if (fromRegister) {
      entry.records = fromRegister.records ?? entry.records;
      entry.artifacts = fromRegister.artifacts ?? entry.artifacts;
    }
    if (entry.artifacts.length === 0) entry.artifacts = [`retention/${dataClass}`];
  }

  return {
    apiVersion: "contracts.platform/v1alpha1",
    kind: "RetentionChangePreview",
    metadata: {
      name: `retention-change-${changeId ?? "preview"}`.slice(0, 60),
      version: "1.0.0",
      description: "Preview af retentionændring med berørte data, holds, WORM og menneskelig ramme.",
    },
    installationId,
    changeId: changeId ?? "change-preview",
    requested: (requested ?? []).map((r) => ({ dataClass: r.dataClass, fromDays: r.fromDays ?? currentMap.get(r.dataClass)?.retentionDays ?? 0, toDays: r.toDays })),
    affectedDataClasses: [...affected.values()].sort((a, b) => a.dataClass.localeCompare(b.dataClass)),
    holds: [...holdMap.values()].map((h) => ({ dataClass: h.dataClass, legalHoldRef: h.legalHoldRef ?? "none", worm: h.worm === true, until: h.until ?? null })),
    frames: frame
      ? { frameRef: frame.frameRef, approvedBy: frame.approvedBy, approvedAt: frame.approvedAt, maxRetentionDays: frame.maxRetentionDays, minRetentionDays: frame.minRetentionDays }
      : { frameRef: "missing", approvedBy: "missing", approvedAt: new Date(now).toISOString(), maxRetentionDays: 1, minRetentionDays: 1 },
    decisions,
    requiresHumanApproval: true,
    authorization: authorization ?? { humanSubject: "missing", role: "missing", grantedAt: new Date(now).toISOString(), expiresAt: new Date(now).toISOString(), decisionDigest: "0".repeat(64) },
    ...(problems.length ? { problems } : {}),
  };
}

/**
 * Semantisk kontrol af et færdigt preview: beslutningerne skal følge reglerne,
 * og en ændring må kun være anvendelig, når alle beslutninger er tilladte og
 * der findes en menneskelig autorisation.
 */
export function retentionPreviewProblems(preview, { now = Date.now() } = {}) {
  const problems = [];
  const at = (path, message) => problems.push({ path, message });
  if (!/^[a-z][a-z0-9-]*\|/.test(preview?.authorization?.humanSubject ?? "")) at("/authorization/humanSubject", "previewet mangler en navngiven menneskelig autorisation");
  const frame = preview?.frames ?? {};
  if ((preview?.frames?.minRetentionDays ?? 0) > (preview?.frames?.maxRetentionDays ?? 0)) at("/frames", "rammens minimum overstiger maksimum");
  const decisionClasses = new Set((preview?.decisions ?? []).map((d) => d.dataClass));
  for (const req of preview?.requested ?? []) {
    if (!decisionClasses.has(req.dataClass)) at("/decisions", `dataklassen '${req.dataClass}' mangler en beslutning`);
    const decision = (preview?.decisions ?? []).find((d) => d.dataClass === req.dataClass);
    if (!decision) continue;
    if (decision.allowed) {
      if (req.toDays < frame.minRetentionDays || req.toDays > frame.maxRetentionDays) at(`/decisions/${req.dataClass}`, "en tilladt ændring ligger uden for rammen");
    }
  }
  for (const hold of preview?.holds ?? []) {
    const req = (preview?.requested ?? []).find((r) => r.dataClass === hold.dataClass);
    if (!req) continue;
    const decision = (preview?.decisions ?? []).find((d) => d.dataClass === hold.dataClass);
    const untilDays = hold.until ? Math.ceil((Date.parse(hold.until) - now) / 86400000) : Infinity;
    if (decision?.allowed && req.toDays < untilDays) at(`/decisions/${hold.dataClass}`, "en tilladt ændring bryder et legal hold");
    if (decision?.allowed && hold.worm && req.toDays < req.fromDays) at(`/decisions/${hold.dataClass}`, "en tilladt ændring forkorter WORM-retention");
  }
  return problems;
}
