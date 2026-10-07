/**
 * DKC-057 — backendvælger for backupmål.
 *
 * Et mål beskriver sin protokol; vælgeren afbilder den til en konkret backend.
 * Ukendte/ikke-validerede protokoller afvises frem for at falde tilbage til
 * noget uforudsigeligt. En `nas`-profil kan køre over filsystem-backenden når
 * der gives en lokal rod (fx et monteret drev); ellers er den ikke understøttet.
 */
import { createFilesystemBackend } from "./filesystem.mjs";
import { createS3Backend } from "./s3.mjs";
import { BackupTargetError } from "../errors.mjs";

export function createBackendForTarget(target, { credentials = null, localRoot = null, tls = null, now = () => Date.now(), requestFn = undefined } = {}) {
  if (!target) throw new BackupTargetError("createBackendForTarget kræver et mål", "target_error");
  const url = target.endpoint?.url ?? "";
  const type = target.targetType;

  if (type === "object-store" || type === "cloud" || /^s3:\/\//.test(url)) {
    if (!credentials) throw new BackupTargetError("objektlager-backenden kræver opløste credentials", "credentials_error");
    return createS3Backend({
      endpoint: url.replace(/^s3:\/\//, "https://"),
      region: target.endpoint.region,
      bucket: target.endpoint.bucket,
      pathPrefix: target.endpoint.pathPrefix ?? "",
      credentials,
      tls: tls ?? { verify: target.tls?.verify, minVersion: target.tls?.minVersion, certSha256: target.tls?.certSha256 },
      now,
      requestFn,
    });
  }

  if (type === "nas" || type === "sftp") {
    const root = localRoot ?? (/^file:\/\//.test(url) ? url.slice("file://".length) : null);
    if (!root) throw new BackupTargetError(`backenden for '${type}' er ikke understøttet uden en lokal/monteret rod`, "unsupported_capability");
    return createFilesystemBackend({ rootDir: root, now });
  }

  throw new BackupTargetError(`ukendt backupmålstype '${type}'`, "unsupported_capability");
}

export { createFilesystemBackend, createS3Backend };
