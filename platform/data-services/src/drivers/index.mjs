/**
 * DKC-056 — drivervælger. Vælger en understøttet driver ud fra profilens eller
 * datakildens motorfamilie. Ukendte familier afvises frem for at falde tilbage
 * til noget uforudsigeligt.
 */
import { createPostgresDriver } from "./postgres.mjs";
import { createSqliteDriver } from "./sqlite.mjs";
import { DataServiceError } from "../errors.mjs";

export function createDriver(family, config = {}) {
  if (family === "postgresql") return createPostgresDriver({ ...config, ssl: config.ssl ?? { mode: "disable" } });
  if (family === "sqlite") return createSqliteDriver(config);
  throw new DataServiceError(`ingen driver for motoren '${family}'`, { code: "unsupported_engine" });
}

/** Byg en driver for en databaseprofil og brug profilens testede versionsintervaller. */
export function createDriverForProfile(profile, config = {}) {
  const ranges = (profile?.engine?.supportedVersions ?? []).filter((v) => v.tested === true).map((v) => v.range);
  return createDriver(profile?.engine?.family, { ...config, supportedRanges: ranges });
}

/** Byg en driver for en datakilde. */
export function createDriverForSource(source, config = {}) {
  return createDriver(source?.engine?.family, config);
}
