/**
 * DKC-056 — test-dobbelt for PostgreSQL.
 *
 * En protokolfast server, der taler PostgreSQL v3 på netværket og udfører
 * forespørgslerne på en rigtig SQLite-motor. Dobbelten bruges til at efterprøve
 * den rigtige driver (SSL-forhandling, auth, simple/udvidede forespørgsler,
 * versionsafvigelse og certifikatfejl) uden en installeret PostgreSQL.
 *
 * Dobbelten er bevidst markeret som mock i baseline: den beviser driverens
 * protokoladfærd, ikke en bestemt PostgreSQL-installations drift.
 */
import net from "node:net";
import tls from "node:tls";
import { createHash, randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { FrameParser, message, cstring, int16, int32, readCString } from "../../src/drivers/pg-wire.mjs";
import { parseAttributes, serverFirst as scramServerFirst, deriveKeys, verifyClientProof, constantTimeEqual } from "../../src/drivers/scram.mjs";

const STARTUP_CODE = 196608;
const SSL_REQUEST_CODE = 80877103;

class MessageReader {
  constructor(socket) {
    this.parser = new FrameParser();
    this.queue = [];
    this.waiters = [];
    this.closed = false;
    this.error = null;
    socket.on("data", (chunk) => {
      this.queue.push(...this.parser.push(chunk));
      this.pump();
    });
    socket.on("error", (err) => {
      this.error = err;
      this.pump();
    });
    socket.on("close", () => {
      this.closed = true;
      this.pump();
    });
  }

  pump() {
    while (this.waiters.length && (this.queue.length || this.error || this.closed)) {
      const waiter = this.waiters.shift();
      if (this.queue.length) waiter.resolve(this.queue.shift());
      else waiter.reject(this.error ?? new Error("forbindelsen blev lukket"));
    }
  }

  next() {
    if (this.queue.length) return Promise.resolve(this.queue.shift());
    if (this.error) return Promise.reject(this.error);
    if (this.closed) return Promise.reject(new Error("forbindelsen blev lukket"));
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }
}

function readStartup(socket) {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    const onData = (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length < 4) return;
      const length = buffer.readInt32BE(0);
      if (buffer.length < length) return;
      socket.removeListener("data", onData);
      resolve(buffer.subarray(0, length));
    };
    socket.on("data", onData);
    socket.once("error", reject);
  });
}

function upgradeServerTls(socket, secureContext) {
  return new Promise((resolve, reject) => {
    const secure = new tls.TLSSocket(socket, { isServer: true, secureContext });
    secure.once("secure", () => resolve(secure));
    secure.once("error", reject);
  });
}

function rowDescription(columns) {
  const parts = [int16(columns.length)];
  for (const name of columns) {
    parts.push(cstring(name), int32(0), int16(0), int32(25), int16(-1), int32(-1), int16(0));
  }
  return message("T", Buffer.concat(parts));
}

function dataRow(values) {
  const parts = [int16(values.length)];
  for (const value of values) {
    if (value === null || value === undefined) {
      parts.push(int32(-1));
      continue;
    }
    const encoded = Buffer.from(String(value), "utf8");
    parts.push(int32(encoded.length), encoded);
  }
  return message("D", Buffer.concat(parts));
}

function commandComplete(tag) {
  return message("C", cstring(tag));
}

function errorResponse(text, code = "42601") {
  return message("E", Buffer.concat([Buffer.from("S"), cstring("ERROR"), Buffer.from("C"), cstring(code), Buffer.from("M"), cstring(text), Buffer.from([0])]));
}

function commandTag(sql) {
  const keyword = sql.trim().split(/\s+/)[0]?.toUpperCase() ?? "OK";
  if (keyword === "INSERT") return "INSERT 0 ";
  if (keyword === "UPDATE") return "UPDATE ";
  if (keyword === "DELETE") return "DELETE ";
  if (keyword === "CREATE") return "CREATE ";
  if (keyword === "ALTER") return "ALTER ";
  if (keyword === "DROP") return "DROP ";
  return `${keyword} `;
}

export async function createFakePostgres(options = {}) {
  const {
    auth = "cleartext",
    user = "app",
    password = "secret",
    database = "appdb",
    serverVersion = "16.4",
    tls: tlsFiles = null,
    init = null,
  } = options;

  const db = new DatabaseSync(":memory:");
  db.exec("ATTACH ':memory:' AS information_schema");
  if (init) db.exec(init);

  const sockets = new Set();
  const secureContext = tlsFiles ? tls.createSecureContext({ key: tlsFiles.key, cert: tlsFiles.cert }) : null;

  function refreshInformationSchema() {
    db.exec("DROP TABLE IF EXISTS information_schema.columns");
    db.exec(
      "CREATE TABLE information_schema.columns(table_schema TEXT, table_name TEXT, column_name TEXT, data_type TEXT, ordinal_position INTEGER)"
    );
    const insert = db.prepare("INSERT INTO information_schema.columns VALUES (?,?,?,?,?)");
    for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%'").all()) {
      for (const column of db.prepare("SELECT name, type, cid FROM pragma_table_info(?)").all(name)) {
        insert.run("main", name, column.name, column.type ?? "", column.cid + 1);
      }
    }
  }

  function runStatement(sql, params) {
    if (/information_schema\.columns/i.test(sql)) refreshInformationSchema();
    const text = sql.replace(/\$(\d+)/g, "?");
    const statement = db.prepare(text);
    if (/^\s*(select|with|pragma|explain)\b/i.test(text)) {
      const rows = statement.all(...params);
      const columns = statement.columns().map((c) => c.name);
      return { rows, columns, tag: `SELECT ${rows.length}` };
    }
    const result = statement.run(...params);
    return { rows: [], columns: [], tag: `${commandTag(text)}${result.changes}` };
  }

  async function sendResult(socket, sql, params) {
    try {
      const { rows, columns, tag } = runStatement(sql, params);
      if (columns.length) socket.write(rowDescription(columns));
      for (const row of rows) socket.write(dataRow(columns.map((c) => row[c])));
      socket.write(commandComplete(tag));
    } catch (err) {
      socket.write(errorResponse(err.message));
    }
  }

  async function authenticate(socket, reader) {
    if (auth === "trust") {
      socket.write(message("R", int32(0)));
      return true;
    }
    if (auth === "cleartext") {
      socket.write(message("R", int32(3)));
      const msg = await reader.next();
      const supplied = readCString(msg.payload, 0).value;
      if (!constantTimeEqual(supplied, password)) {
        socket.write(errorResponse("password authentication failed for user", "28P01"));
        return false;
      }
      socket.write(message("R", int32(0)));
      return true;
    }
    if (auth === "md5") {
      const salt = randomBytes(4);
      socket.write(message("R", Buffer.concat([int32(5), salt])));
      const msg = await reader.next();
      const supplied = readCString(msg.payload, 0).value;
      const inner = createHash("md5").update(password + user).digest("hex");
      const expected = `md5${createHash("md5").update(inner + salt.toString("latin1")).digest("hex")}`;
      if (supplied !== expected) {
        socket.write(errorResponse("password authentication failed for user", "28P01"));
        return false;
      }
      socket.write(message("R", int32(0)));
      return true;
    }
    if (auth === "scram") {
      socket.write(message("R", Buffer.concat([int32(10), Buffer.from("SCRAM-SHA-256\0\0", "latin1")])));
      const initial = await reader.next();
      const mechanism = readCString(initial.payload, 0);
      const length = initial.payload.readInt32BE(mechanism.next);
      const clientFirst = initial.payload.toString("utf8", mechanism.next + 4, mechanism.next + 4 + length);
      const bare = parseAttributes(clientFirst.replace(/^n,,/, ""));
      const { serverFirst, combinedNonce, salt, iterations } = scramServerFirst(bare.r);
      socket.write(message("R", Buffer.concat([int32(11), Buffer.from(serverFirst, "utf8")])));

      const finalMsg = await reader.next();
      const clientFinal = finalMsg.payload.toString("utf8");
      const withoutProof = clientFinal.slice(0, clientFinal.lastIndexOf(",p="));
      const proof = clientFinal.slice(clientFinal.lastIndexOf(",p=") + 3);
      const authMessage = `${clientFirst.replace(/^n,,/, "")},${serverFirst},${withoutProof}`;
      void combinedNonce;
      if (!verifyClientProof(password, salt, iterations, authMessage, proof)) {
        socket.write(errorResponse("password authentication failed for user", "28P01"));
        return false;
      }
      const { serverSignature } = deriveKeys(password, salt, iterations, authMessage);
      socket.write(message("R", Buffer.concat([int32(12), Buffer.from(`v=${serverSignature.toString("base64")}`, "utf8")])));
      return true;
    }
    socket.write(errorResponse(`uunderstøttet auth-metode '${auth}'`));
    return false;
  }

  async function handleConnection(rawSocket) {
    let socket = rawSocket;
    sockets.add(rawSocket);
    try {
      let startup = await readStartup(socket);
      if (startup.length >= 8 && startup.readInt32BE(4) === SSL_REQUEST_CODE) {
        if (!secureContext) {
          socket.write("N");
        } else {
          socket.write("S");
          socket = await upgradeServerTls(socket, secureContext);
          sockets.add(socket);
          startup = await readStartup(socket);
        }
      }
      if (startup.readInt32BE(4) !== STARTUP_CODE) {
        socket.write(errorResponse("uventet startup-pakke"));
        socket.end();
        return;
      }
      const parameters = {};
      let offset = 8;
      while (offset < startup.length && startup[offset] !== 0) {
        const key = readCString(startup, offset);
        const value = readCString(startup, key.next);
        parameters[key.value] = value.value;
        offset = value.next;
      }

      const reader = new MessageReader(socket);
      void database;
      const ok = await authenticate(socket, reader);
      if (!ok) {
        socket.end();
        return;
      }
      socket.write(message("S", Buffer.concat([cstring("server_version"), cstring(serverVersion)])));
      socket.write(message("S", Buffer.concat([cstring("client_encoding"), cstring("UTF8")])));
      socket.write(message("K", Buffer.concat([int32(process.pid), int32(123456)])));
      socket.write(message("Z", Buffer.from("I", "latin1")));

      let parsedSql = null;
      let boundParams = [];
      let columnsSent = false;

      for (;;) {
        const msg = await reader.next();
        if (msg.type === "X") {
          socket.end();
          return;
        }
        if (msg.type === "Q") {
          const sql = readCString(msg.payload, 0).value;
          await sendResult(socket, sql, []);
          socket.write(message("Z", Buffer.from("I", "latin1")));
          continue;
        }
        if (msg.type === "P") {
          const name = readCString(msg.payload, 0);
          const query = readCString(msg.payload, name.next);
          parsedSql = query.value;
          boundParams = [];
          columnsSent = false;
          socket.write(message("1", Buffer.alloc(0)));
          continue;
        }
        if (msg.type === "B") {
          let offset2 = 0;
          const portal = readCString(msg.payload, offset2);
          const statement = readCString(msg.payload, portal.next);
          offset2 = statement.next;
          const formatCount = msg.payload.readInt16BE(offset2);
          offset2 += 2 + formatCount * 2;
          const paramCount = msg.payload.readInt16BE(offset2);
          offset2 += 2;
          boundParams = [];
          for (let i = 0; i < paramCount; i += 1) {
            const length = msg.payload.readInt32BE(offset2);
            offset2 += 4;
            if (length === -1) {
              boundParams.push(null);
              continue;
            }
            boundParams.push(msg.payload.toString("utf8", offset2, offset2 + length));
            offset2 += length;
          }
          socket.write(message("2", Buffer.alloc(0)));
          continue;
        }
        if (msg.type === "D") {
          // Describe portal: send RowDescription if the statement returns rows.
          if (parsedSql && /^\s*(select|with|pragma|explain)\b/i.test(parsedSql)) {
            const statement = db.prepare(parsedSql);
            socket.write(rowDescription(statement.columns().map((c) => c.name)));
          } else {
            socket.write(message("n", Buffer.alloc(0)));
          }
          columnsSent = true;
          continue;
        }
        if (msg.type === "E") {
          if (parsedSql) {
            try {
              const { rows, columns, tag } = runStatement(parsedSql, boundParams);
              for (const row of rows) socket.write(dataRow(columns.map((c) => row[c])));
              socket.write(commandComplete(tag));
            } catch (err) {
              socket.write(errorResponse(err.message));
            }
          }
          continue;
        }
        if (msg.type === "S") {
          socket.write(message("Z", Buffer.from("I", "latin1")));
          continue;
        }
        void columnsSent;
      }
    } catch {
      try {
        socket.destroy();
      } catch {
        /* allerede lukket */
      }
    }
  }

  const server = net.createServer((socket) => {
    void handleConnection(socket);
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;

  return {
    port,
    host: "127.0.0.1",
    database,
    user,
    password,
    db,
    async close() {
      for (const socket of sockets) {
        try {
          socket.destroy();
        } catch {
          /* ignoreret */
        }
      }
      await new Promise((resolve) => server.close(resolve));
      db.close();
    },
  };
}
