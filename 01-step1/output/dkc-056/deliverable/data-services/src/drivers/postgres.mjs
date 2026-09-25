/**
 * DKC-056 — PostgreSQL-driver (rigtig wire-protokol, ingen ekstern npm-afhængighed).
 *
 * Driveren taler PostgreSQL v3 over `node:net`/`node:tls`:
 *   - SSL-forhandling (SSLRequest → S/N, derefter TLS),
 *   - autentisering med cleartext, MD5 eller SCRAM-SHA-256,
 *   - simpel forespørgsel og udvidet forespørgsel med parametre,
 *   - skemadiscovery gennem information_schema.
 *
 * Fejl er typede: netværksudfald, certifikatrotation, versionsmismatch og
 * afviste forespørgsler giver hver sin kontrollerede fejl (`NetworkError`,
 * `CertificateError`, `VersionMismatchError`, `QueryError`).
 */
import net from "node:net";
import tls from "node:tls";
import { createHash } from "node:crypto";
import { satisfies } from "../../../distribution/src/semver.mjs";
import {
  FrameParser,
  message,
  startupMessage,
  sslRequestMessage,
  cstring,
  int16,
  int32,
  errorText,
  parseRowDescription,
  parseDataRow,
  parseCommandComplete,
  readCString,
} from "./pg-wire.mjs";
import { clientFirst, clientFinal, parseAttributes } from "./scram.mjs";
import { NetworkError, CertificateError, TlsRequiredError, VersionMismatchError, AuthenticationError, QueryError } from "../errors.mjs";

const DEFAULT_CONNECT_TIMEOUT_MS = 5000;

/** Normalisér "16.4 (Ubuntu …)" til SemVer "16.4.0". */
export function parseServerVersion(text) {
  const match = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(String(text ?? ""));
  if (!match) return null;
  return `${match[1]}.${match[2] ?? "0"}.${match[3] ?? "0"}`;
}

/** Oversæt '?'-pladsholdere til '$1..$n' uden at røre '?' i strengliteraler. */
export function convertPlaceholders(sql) {
  let out = "";
  let index = 0;
  let inString = false;
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    if (ch === "'") {
      out += ch;
      if (inString && sql[i + 1] === "'") {
        out += sql[i + 1];
        i += 1;
        continue;
      }
      inString = !inString;
      continue;
    }
    if (ch === "?" && !inString) {
      index += 1;
      out += `$${index}`;
      continue;
    }
    out += ch;
  }
  return out;
}

function connectTcp({ host, port, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(err);
    };
    socket.once("error", (err) => fail(new NetworkError(`kunne ikke forbinde til ${host}:${port}: ${err.message}`, { cause: err })));
    socket.setTimeout(timeoutMs, () => fail(new NetworkError(`timeout efter ${timeoutMs} ms mod ${host}:${port}`)));
    socket.once("connect", () => {
      if (settled) return;
      settled = true;
      socket.setTimeout(0);
      resolve(socket);
    });
  });
}

function upgradeTls(socket, options, mode) {
  return new Promise((resolve, reject) => {
    const onData = (chunk) => {
      const answer = chunk[0];
      if (answer === 0x53) {
        // 'S' — serveren accepterer TLS.
        const secure = tls.connect({ socket, ...options });
        secure.once("secureConnect", () => resolve(secure));
        secure.once("error", (err) => reject(new CertificateError(`TLS-håndtryk fejlede: ${err.message}`, { cause: err })));
      } else if (answer === 0x4e) {
        // 'N' — serveren afviser TLS.
        reject(new TlsRequiredError("serveren afviste TLS, men forbindelsen kræver det"));
      } else {
        reject(new NetworkError("uventet svar på SSLRequest"));
      }
    };
    socket.once("data", onData);
    socket.once("error", (err) => reject(new NetworkError(`netværksfejl under SSL-forhandling: ${err.message}`, { cause: err })));
    socket.write(sslRequestMessage());
  });
}

function fingerprint(der) {
  return createHash("sha256").update(der).digest("hex");
}

class WireSocket {
  constructor(socket) {
    this.socket = socket;
    this.parser = new FrameParser();
    this.queue = [];
    this.waiters = [];
    this.closed = false;
    this.failure = null;
    socket.on("data", (chunk) => {
      for (const msg of this.parser.push(chunk)) this.queue.push(msg);
      this.pump();
    });
    socket.on("error", (err) => {
      this.failure = err;
      this.pump();
    });
    socket.on("close", () => {
      this.closed = true;
      this.pump();
    });
  }

  pump() {
    while (this.waiters.length && (this.queue.length || this.closed || this.failure)) {
      const waiter = this.waiters.shift();
      if (this.queue.length) waiter.resolve(this.queue.shift());
      else waiter.reject(new NetworkError(`forbindelsen blev lukket: ${this.failure?.message ?? "ukendt årsag"}`, { cause: this.failure }));
    }
  }

  read() {
    if (this.queue.length) return Promise.resolve(this.queue.shift());
    if (this.failure) return Promise.reject(new NetworkError(`forbindelsen fejlede: ${this.failure.message}`, { cause: this.failure }));
    if (this.closed) return Promise.reject(new NetworkError("forbindelsen blev lukket"));
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }

  write(buffer) {
    return new Promise((resolve, reject) => {
      this.socket.write(buffer, (err) => (err ? reject(new NetworkError(`kunne ikke skrive til forbindelsen: ${err.message}`, { cause: err })) : resolve()));
    });
  }

  end() {
    try {
      this.socket.end();
    } catch {
      /* allerede lukket */
    }
  }
}

export function createPostgresDriver(config = {}) {
  const {
    host,
    port = 5432,
    user,
    password = "",
    database = "postgres",
    ssl = { mode: "disable" },
    supportedRanges = [],
    applicationName = "dkcompany-data-services",
    connectTimeoutMs = DEFAULT_CONNECT_TIMEOUT_MS,
    maxRows = 10000,
  } = config;

  let wire = null;
  let parameters = {};
  let serverVersion = null;

  function assertConfigured() {
    if (!host) throw new NetworkError("postgres-driveren mangler en host");
    if (!user) throw new AuthenticationError("postgres-driveren mangler en bruger");
  }

  async function authenticate() {
    for (;;) {
      const msg = await wire.read();
      if (msg.type === "R") {
        const code = msg.payload.readInt32BE(0);
        if (code === 0) continue;
        if (code === 3) {
          await wire.write(message("p", cstring(password)));
          continue;
        }
        if (code === 5) {
          const salt = msg.payload.subarray(4, 8);
          const inner = createHash("md5").update(password + user).digest("hex");
          const outer = createHash("md5").update(inner + salt.toString("latin1")).digest("hex");
          await wire.write(message("p", cstring(`md5${outer}`)));
          continue;
        }
        if (code === 10) {
          await authenticateScram(msg.payload.subarray(4));
          continue;
        }
        throw new AuthenticationError(`uunderstøttet autentiseringsmetode (kode ${code})`);
      }
      if (msg.type === "E") throw new AuthenticationError(`autentisering fejlede: ${errorText(msg.payload)}`);
      if (msg.type === "S") captureParameter(msg.payload);
      if (msg.type === "Z") return;
    }
  }

  async function authenticateScram(mechanismsPayload) {
    const mechanisms = mechanismsPayload.toString("latin1").split("\0").filter(Boolean);
    if (!mechanisms.includes("SCRAM-SHA-256")) {
      throw new AuthenticationError(`serveren tilbyder ikke SCRAM-SHA-256 (tilbyder: ${mechanisms.join(", ") || "ingen"})`);
    }
    const { clientFirstBare, clientFirst: firstMessage, clientNonce } = clientFirst(user);
    const payload = Buffer.concat([cstring("SCRAM-SHA-256"), int32(Buffer.byteLength(firstMessage)), Buffer.from(firstMessage, "utf8")]);
    await wire.write(message("p", payload));

    const serverFirstMsg = await wire.read();
    if (serverFirstMsg.type === "E") throw new AuthenticationError(`SCRAM fejlede: ${errorText(serverFirstMsg.payload)}`);
    if (serverFirstMsg.type !== "R" || serverFirstMsg.payload.readInt32BE(0) !== 11) {
      throw new AuthenticationError("uventet SCRAM-svar fra serveren");
    }
    const serverFirstText = serverFirstMsg.payload.toString("utf8", 4);
    const attrs = parseAttributes(serverFirstText);
    if (!(attrs.r ?? "").startsWith(clientNonce)) {
      throw new AuthenticationError("serverens SCRAM-nonce matcher ikke klientens");
    }
    const { clientFinal: finalMessage, serverSignature, authMessage } = clientFinal(password, clientFirstBare, serverFirstText);
    await wire.write(message("p", Buffer.from(finalMessage, "utf8")));

    const serverFinal = await wire.read();
    if (serverFinal.type === "E") throw new AuthenticationError(`SCRAM fejlede: ${errorText(serverFinal.payload)}`);
    if (serverFinal.type !== "R" || serverFinal.payload.readInt32BE(0) !== 12) {
      throw new AuthenticationError("uventet SCRAM-afslutning fra serveren");
    }
    const finalText = serverFinal.payload.toString("utf8", 4);
    const finalAttrs = parseAttributes(finalText);
    if (finalAttrs.v && finalAttrs.v !== serverSignature.toString("base64")) {
      throw new AuthenticationError("serverens SCRAM-signatur kunne ikke verificeres");
    }
    void authMessage;
  }

  function captureParameter(payload) {
    const key = readCString(payload, 0);
    const value = readCString(payload, key.next);
    parameters[key.value] = value.value;
    if (key.value === "server_version") serverVersion = parseServerVersion(value.value);
  }

  async function readResult(reader) {
    const result = { columns: [], rows: [], rowCount: 0, command: null };
    for (;;) {
      const msg = await wire.read();
      if (msg.type === "T") result.columns = parseRowDescription(msg.payload);
      else if (msg.type === "D") {
        if (result.rows.length >= maxRows) throw new QueryError(`forespørgslen overstiger maxRows (${maxRows})`);
        result.rows.push(parseDataRow(msg.payload, result.columns));
      } else if (msg.type === "C") result.command = parseCommandComplete(msg.payload);
      else if (msg.type === "E") throw new QueryError(errorText(msg.payload));
      else if (msg.type === "Z") break;
      // 'N' (notice), '1' (ParseComplete), '2' (BindComplete), 'n' (NoData), 's' (PortalSuspended) ignoreres.
    }
    result.rowCount = result.rows.length;
    return result;
  }

  async function simpleQuery(sql) {
    await wire.write(message("Q", cstring(sql)));
    return readResult();
  }

  async function extendedQuery(sql, params) {
    const text = convertPlaceholders(sql);
    await wire.write(message("P", Buffer.concat([cstring(""), cstring(text), int16(0)])));
    const parts = [cstring(""), cstring(""), int16(0), int16(params.length)];
    for (const value of params) {
      if (value === null || value === undefined) {
        parts.push(int32(-1));
        continue;
      }
      const encoded = Buffer.from(value instanceof Date ? value.toISOString() : String(value), "utf8");
      parts.push(int32(encoded.length), encoded);
    }
    parts.push(int16(0));
    await wire.write(message("B", Buffer.concat(parts)));
    await wire.write(message("D", Buffer.concat([Buffer.from("P", "latin1"), cstring("")])));
    await wire.write(message("E", Buffer.concat([cstring(""), int32(0)])));
    await wire.write(message("S", Buffer.alloc(0)));
    return readResult();
  }

  async function discoverSchema({ schemas = [] } = {}) {
    const allowed = new Set(schemas);
    const sql =
      "SELECT table_schema, table_name, column_name, data_type FROM information_schema.columns ORDER BY table_schema, table_name, ordinal_position";
    const { rows } = await simpleQuery(sql);
    const bySchema = new Map();
    for (const row of rows) {
      const schema = row.table_schema;
      if (allowed.size && !allowed.has(schema)) continue;
      if (!bySchema.has(schema)) bySchema.set(schema, new Map());
      const tables = bySchema.get(schema);
      if (!tables.has(row.table_name)) tables.set(row.table_name, []);
      tables.get(row.table_name).push({ name: row.column_name, type: row.data_type });
    }
    return {
      schemas: [...bySchema.entries()]
        .map(([name, tables]) => ({ name, tables: [...tables.entries()].map(([table, columns]) => ({ name: table, columns })) }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  return {
    kind: "postgres",

    async connect() {
      assertConfigured();
      const mode = ssl?.mode ?? "disable";
      const raw = await connectTcp({ host, port, timeoutMs: connectTimeoutMs });
      let socket = raw;
      let tlsInfo = { enabled: false, mode };

      if (mode !== "disable") {
        const options = { servername: host, minVersion: ssl?.minVersion ? `TLSv${ssl.minVersion}` : "TLSv1.2" };
        if (ssl?.ca) options.ca = ssl.ca;
        const pin = ssl?.certSha256 ?? null;
        if (pin) options.rejectUnauthorized = false;
        else if (mode === "verify-ca" || mode === "verify-full") {
          options.rejectUnauthorized = true;
          if (mode === "verify-ca") options.checkServerIdentity = () => undefined;
        } else {
          options.rejectUnauthorized = false;
        }
        socket = await upgradeTls(raw, options, mode);
        if (pin) {
          const cert = socket.getPeerCertificate();
          const actual = cert?.raw ? fingerprint(cert.raw) : null;
          if (actual !== pin) {
            socket.destroy();
            throw new CertificateError(`certifikatets SHA-256 (${actual ?? "ukendt"}) matcher ikke det pinnede certifikat (${pin}); certifikatrotation skal godkendes`);
          }
        }
        tlsInfo = { enabled: true, mode, protocol: socket.getProtocol() };
      }

      wire = new WireSocket(socket);
      await wire.write(startupMessage({ user, database, application_name: applicationName }));
      await authenticate();

      if (supportedRanges.length && serverVersion) {
        const supported = supportedRanges.some((range) => satisfies(serverVersion, range));
        if (!supported) {
          await this.close();
          throw new VersionMismatchError(
            `serverversion ${serverVersion} er ikke understøttet (kræver ${supportedRanges.join(" eller ")})`
          );
        }
      }
      return { engine: "postgresql", version: serverVersion, tls: tlsInfo, parameters: { ...parameters } };
    },

    async query(sql, params = []) {
      if (!wire) throw new NetworkError("postgres-driveren er ikke forbundet");
      return params.length ? extendedQuery(sql, params) : simpleQuery(sql);
    },

    discoverSchema,

    async close() {
      if (!wire) return;
      try {
        await wire.write(message("X", Buffer.alloc(0)));
      } catch {
        /* forbindelsen kan allerede være væk */
      }
      wire.end();
      wire = null;
    },
  };
}
