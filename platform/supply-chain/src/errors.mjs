/**
 * Typede, kontrollerede fejl i forsyningskæden.
 *
 * En afvist digest eller signatur er en beslutning, ikke et nedbrud. Derfor
 * bærer fejlen en stabil `code`, så en kalder kan skelne «pladsholder-digest»
 * fra «ukendt nøgle» uden at læse prosa.
 */
export class SupplyChainError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SupplyChainError";
    this.code = code;
  }
}

export function assert(condition, code, message) {
  if (!condition) throw new SupplyChainError(code, message);
}
