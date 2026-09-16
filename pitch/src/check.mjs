/**
 * 4.3 — Efterprøvning af pitch-decket.
 *
 * Hver slide har en Bevis-linje med backtick-referencer. Denne checker
 * efterprøver, at hvert `make`-mål findes i Makefile, og at hver sti findes på
 * disken. Dermed kan decket ikke love noget, repoet ikke kan vise.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const DECK_REL = "docs/pitch/deck.md";

export function extractEvidence(markdown) {
  const evidence = [];
  for (const line of markdown.split("\n")) {
    const match = line.match(/\*\*Bevis:\*\*\s*(.+)$/);
    if (!match) continue;
    const spans = [...match[1].matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    evidence.push({ text: match[1].trim(), spans });
  }
  return evidence;
}

export function makeTargets(makefileText) {
  const targets = new Set();
  for (const line of makefileText.split("\n")) {
    const match = line.match(/^([a-zA-Z0-9_-]+):/);
    if (match) targets.add(match[1]);
  }
  return targets;
}

export function checkDeck({ markdown, makefileText, repoRoot, exists = existsSync, minEvidence = 10 }) {
  const problems = [];
  const targets = makeTargets(makefileText);
  const evidence = extractEvidence(markdown);

  if (evidence.length < minEvidence) {
    problems.push(`decket har kun ${evidence.length} bevis-linjer; forventer mindst ${minEvidence}`);
  }
  for (const item of evidence) {
    if (item.spans.length === 0) problems.push(`bevis uden backtick-reference: '${item.text}'`);
    for (const span of item.spans) {
      if (span.startsWith("make ")) {
        const target = span.split(/\s+/)[1];
        if (target && !targets.has(target)) problems.push(`ukendt make-mål '${target}' i bevis '${span}'`);
      } else if (span.includes("/")) {
        if (!exists(join(repoRoot, span))) problems.push(`sti findes ikke: '${span}'`);
      }
    }
  }
  return { ok: problems.length === 0, problems, evidence };
}

export function check({ repoRoot }) {
  const markdown = readFileSync(join(repoRoot, DECK_REL), "utf8");
  const makefileText = readFileSync(join(repoRoot, "Makefile"), "utf8");
  return checkDeck({ markdown, makefileText, repoRoot });
}
