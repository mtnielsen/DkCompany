import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

/**
 * Git-historikken er den komplette change log (NIS2). Denne funktion gør den
 * maskinlæsbar og markerer, om hver commit er DCO-signeret.
 */
export function generateChangelog({ cwd, from, to } = {}) {
  const range = from && to ? `${from}..${to}` : undefined;
  const format = "%H%x1f%an%x1f%ae%x1f%aI%x1f%B%x1e";
  const args = ["log", `--pretty=format:${format}`];
  if (range) args.push(range);

  const raw = execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  return raw
    .split("\x1e")
    .map((record) => record.replace(/^\n+/, ""))
    .filter((record) => record.trim().length > 0)
    .map((record) => {
      const [hash, author, email, date, ...bodyParts] = record.split("\x1f");
      const body = bodyParts.join("\x1f").trim();
      const signedOffBy = [...body.matchAll(/^Signed-off-by: (.+)$/gim)].map((m) => m[1].trim());
      const subject = body.split("\n")[0] ?? "";
      return {
        hash,
        author,
        email,
        date,
        subject,
        signedOff: signedOffBy.length > 0,
        signedOffBy,
        files: filesForCommit(hash, cwd),
        body,
      };
    });
}

function filesForCommit(hash, cwd) {
  const out = execFileSync("git", ["show", "--name-only", "--format=", hash], { cwd, encoding: "utf8" });
  return out.split("\n").map((l) => l.trim()).filter(Boolean);
}

export function toJsonl(entries) {
  return entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
}

export function writeChangelog(path, entries) {
  writeFileSync(path, toJsonl(entries));
}

/** Returnerer de commits der mangler sign-off. */
export function unsignedCommits(entries) {
  return entries.filter((e) => !e.signedOff);
}
