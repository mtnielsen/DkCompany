import { execFileSync } from "node:child_process";
import { arch, platform, release } from "node:os";

/**
 * Fang det miljø, en baselinekørsel er foretaget i.
 *
 * Formålet er, at en rapport altid kan spores til et commit, en Node-version og
 * en maskine — og at det er tydeligt, om kørslen skete lokalt eller i CI.
 * Der fanges bevidst ingen credentials, tokens eller miljøvariabler med
 * hemmeligt indhold; kun versionsstrenge og offentlige CI-identifikatorer.
 */
export function captureEnvironment({ repo }) {
  const git = (args, fallback = null) => {
    try {
      return execFileSync("git", args, {
        cwd: repo,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      return fallback;
    }
  };

  const npm = (() => {
    try {
      return execFileSync("npm", ["--version"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      return null;
    }
  })();

  // Begræns status til det undersøgte repo, så urelaterede arbejdstræer ikke
  // registreres som "dirty".
  const dirtyRaw = git(["status", "--porcelain", "--", "."], "");
  const dirtyFiles = dirtyRaw ? dirtyRaw.split("\n").map((l) => l.trim()).filter(Boolean) : [];

  return {
    capturedAt: new Date().toISOString(),
    node: process.version,
    npm,
    platform: platform(),
    arch: arch(),
    osRelease: release(),
    execPath: process.execPath,
    cwd: process.cwd(),
    ci: Boolean(process.env.CI || process.env.GITHUB_ACTIONS),
    github: {
      repository: process.env.GITHUB_REPOSITORY ?? null,
      runId: process.env.GITHUB_RUN_ID ?? null,
      sha: process.env.GITHUB_SHA ?? null,
      workflow: process.env.GITHUB_WORKFLOW ?? null,
    },
    git: {
      commit: git(["rev-parse", "HEAD"]),
      shortCommit: git(["rev-parse", "--short", "HEAD"]),
      branch: git(["rev-parse", "--abbrev-ref", "HEAD"]),
      dirty: dirtyFiles.length > 0,
      dirtyFiles,
    },
  };
}
