/** Fælles fejltyper for identitetsverifikation. */
export class AuthenticationError extends Error {
  constructor(message, { status = 401, code = "unauthenticated" } = {}) {
    super(message);
    this.name = "AuthenticationError";
    this.status = status;
    this.code = code;
  }
}

export class AuthorizationError extends Error {
  constructor(message, { status = 403, code = "forbidden" } = {}) {
    super(message);
    this.name = "AuthorizationError";
    this.status = status;
    this.code = code;
  }
}
