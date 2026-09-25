/**
 * DKC-056 — TLS-testfixtures.
 *
 * Genererer en CA og to servercertifikater i en midlertidig mappe med openssl,
 * så private nøgler aldrig committes. Certifikaterne bruges kun af
 * test-dobbeltens TLS-server. Returnerer stier og leaf-fingeraftryk.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let cached = null;

export function hasOpenssl() {
  try {
    execFileSync("openssl", ["version"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

export function tlsFixtures() {
  if (cached) return cached;
  const dir = mkdtempSync(join(tmpdir(), "dkc-tls-"));
  const run = (...args) => execFileSync("openssl", args, { cwd: dir, stdio: "pipe" });
  const subject = (cn) => `/CN=${cn}`;

  run("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", "ca1.key", "-out", "ca1.crt", "-days", "3650", "-subj", subject("dkc-test-ca-1"));
  run("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", "ca2.key", "-out", "ca2.crt", "-days", "3650", "-subj", subject("dkc-test-ca-2"));
  writeFileSync(
    join(dir, "san.cnf"),
    "subjectAltName=DNS:localhost,IP:127.0.0.1\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n"
  );
  for (const [name, ca] of [["server1", "ca1"], ["server2", "ca2"]]) {
    run("req", "-newkey", "rsa:2048", "-nodes", "-keyout", `${name}.key`, "-out", `${name}.csr`, "-subj", subject("localhost"));
    run("x509", "-req", "-in", `${name}.csr`, "-CA", `${ca}.crt`, "-CAkey", `${ca}.key`, "-CAcreateserial", "-out", `${name}.crt`, "-days", "3650", "-extfile", "san.cnf");
  }

  const read = (file) => readFileSync(join(dir, file));
  const fingerprintOf = (file) => {
    const pem = readFileSync(join(dir, file), "utf8");
    const der = Buffer.from(pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, ""), "base64");
    return createHash("sha256").update(der).digest("hex");
  };

  cached = {
    dir,
    ca1: read("ca1.crt"),
    ca2: read("ca2.crt"),
    server1: { key: read("server1.key"), cert: read("server1.crt") },
    server2: { key: read("server2.key"), cert: read("server2.crt") },
    server1Fingerprint: fingerprintOf("server1.crt"),
    server2Fingerprint: fingerprintOf("server2.crt"),
    cleanup: () => {
      rmSync(dir, { recursive: true, force: true });
      cached = null;
    },
  };
  return cached;
}
