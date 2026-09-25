/**
 * DKC-056 — PostgreSQL v3-wire-protokol (frontend/backend).
 *
 * Kun den del af protokollen, driveren har brug for: startup, SSL-forhandling,
 * autentisering (cleartext, MD5, SCRAM-SHA-256), simpel forespørgsel,
 * udvidet forespørgsel med parametre og Terminate. Rammen er bygget, så en
 * test-dobbelt kan tale præcis samme protokol.
 */

export function cstring(value) {
  return Buffer.from(`${value}\0`, "utf8");
}

export function int16(value) {
  const b = Buffer.allocUnsafe(2);
  b.writeInt16BE(value, 0);
  return b;
}

export function int32(value) {
  const b = Buffer.allocUnsafe(4);
  b.writeInt32BE(value, 0);
  return b;
}

/** Byg en type-præfikset besked. `length` dækker sig selv, men ikke type-byten. */
export function message(type, payload = Buffer.alloc(0)) {
  const head = Buffer.allocUnsafe(5);
  head.write(type, 0, "latin1");
  head.writeInt32BE(4 + payload.length, 1);
  return Buffer.concat([head, payload]);
}

/** StartupMessage: int32 længde, int32 protokolversion, key/value-cstrings, NUL. */
export function startupMessage(params) {
  const parts = [int32(196608)];
  for (const [key, value] of Object.entries(params)) parts.push(cstring(key), cstring(String(value)));
  parts.push(Buffer.from([0]));
  const body = Buffer.concat(parts);
  return Buffer.concat([int32(body.length + 4), body]);
}

/** SSLRequest: int32 længde 8, int32 magic 80877103. */
export function sslRequestMessage() {
  return Buffer.concat([int32(8), int32(80877103)]);
}

/** CancelRequest bruges ikke, men holdes dokumenteret. */
export const CANCEL_REQUEST_CODE = 80877102;

/** Parser inkrementelle chunks til komplette, type-præfikse de budskaber. */
export class FrameParser {
  constructor() {
    this.buffer = Buffer.alloc(0);
  }

  push(chunk) {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    const out = [];
    while (this.buffer.length >= 5) {
      const length = this.buffer.readInt32BE(1);
      const total = 1 + length;
      if (this.buffer.length < total) break;
      out.push({ type: String.fromCharCode(this.buffer[0]), payload: this.buffer.subarray(5, total) });
      this.buffer = this.buffer.subarray(total);
    }
    return out;
  }
}

/** Læs en NUL-termineret streng fra `buffer` ved `offset`. */
export function readCString(buffer, offset = 0) {
  const end = buffer.indexOf(0, offset);
  if (end < 0) throw new Error("uafsluttet cstring i protokolbesked");
  return { value: buffer.toString("utf8", offset, end), next: end + 1 };
}

/** Læs alle felter i en ErrorResponse/NoticeResponse. */
export function parseErrorFields(payload) {
  const fields = {};
  let offset = 0;
  while (offset < payload.length && payload[offset] !== 0) {
    const code = String.fromCharCode(payload[offset]);
    const { value, next } = readCString(payload, offset + 1);
    fields[code] = value;
    offset = next;
  }
  return fields;
}

/** Menneske-læsbar fejltekst fra en ErrorResponse. */
export function errorText(payload) {
  const fields = parseErrorFields(payload);
  const severity = fields.S ?? "ERROR";
  const code = fields.C ? ` (${fields.C})` : "";
  return `${severity}${code}: ${fields.M ?? "ukendt fejl"}`;
}

/** Parse RowDescription til kolonne-metadata. */
export function parseRowDescription(payload) {
  const count = payload.readInt16BE(0);
  let offset = 2;
  const columns = [];
  for (let i = 0; i < count; i += 1) {
    const name = readCString(payload, offset);
    offset = name.next;
    const tableOid = payload.readInt32BE(offset);
    offset += 4;
    const columnAttr = payload.readInt16BE(offset);
    offset += 2;
    const dataTypeID = payload.readInt32BE(offset);
    offset += 4;
    const dataTypeSize = payload.readInt16BE(offset);
    offset += 2;
    const typeModifier = payload.readInt32BE(offset);
    offset += 4;
    const format = payload.readInt16BE(offset);
    offset += 2;
    columns.push({ name: name.value, tableOid, columnAttr, dataTypeID, dataTypeSize, typeModifier, format });
  }
  return columns;
}

/** Parse DataRow til en liste af strenge (eller null). */
export function parseDataRow(payload, columns) {
  const count = payload.readInt16BE(0);
  let offset = 2;
  const values = [];
  for (let i = 0; i < count; i += 1) {
    const length = payload.readInt32BE(offset);
    offset += 4;
    if (length === -1) {
      values.push(null);
      continue;
    }
    values.push(payload.toString("utf8", offset, offset + length));
    offset += length;
  }
  const row = {};
  for (let i = 0; i < count; i += 1) row[columns[i]?.name ?? `col${i}`] = values[i];
  return row;
}

/** Parse CommandComplete-tag, fx "SELECT 3" eller "INSERT 0 1". */
export function parseCommandComplete(payload) {
  const { value } = readCString(payload, 0);
  const [tag, ...rest] = value.trim().split(/\s+/);
  return { tag, detail: value.trim(), count: rest.length ? Number(rest[rest.length - 1]) : null };
}
