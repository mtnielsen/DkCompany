/**
 * DKC-034 — prisopslag, valutaomregning og prissætning af en forbrugshændelse.
 *
 * En pris vælges efter måler og det tidspunkt hændelsen indtraf på, så en
 * prisændring ikke efterregner historiske hændelser. Mangler der en pris,
 * returneres en eksplicit fejl — den regnes aldrig som nul. Valutaer må ikke
 * blandes: hændelsens valuta, prisens valuta og rapportens valuta skal kunne
 * forbindes med en vekselkurs.
 */

/** Afrund til to decimaler, så rapporter er deterministiske. */
export function round(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Den pris der var aktiv for en måler på et givet tidspunkt, ellers null. */
export function activePrice(book, meter, at) {
  const atMs = typeof at === "number" ? at : Date.parse(at);
  const candidates = (book?.prices ?? []).filter((price) => {
    if (price.meter !== meter) return false;
    const from = Date.parse(price.effectiveFrom);
    if (!(from <= atMs)) return false;
    if (price.effectiveTo && !(atMs < Date.parse(price.effectiveTo))) return false;
    return true;
  });
  candidates.sort((a, b) => Date.parse(b.effectiveFrom) - Date.parse(a.effectiveFrom));
  return candidates[0] ?? null;
}

/** Vekselkurs mellem to valutaer (direkte eller omvendt), ellers null. */
export function fxRate(book, from, to) {
  if (from === to) return 1;
  const direct = (book?.fxRates ?? []).find((r) => r.from === from && r.to === to);
  if (direct) return direct.rate;
  const inverse = (book?.fxRates ?? []).find((r) => r.from === to && r.to === from);
  if (inverse) return 1 / inverse.rate;
  return null;
}

/** Omregn et beløb; kaster hvis der ikke findes en kurs. */
export function convert(book, amount, from, to) {
  const rate = fxRate(book, from, to);
  if (rate === null) throw new Error(`manglende vekselkurs ${from}->${to}`);
  return amount * rate;
}

/**
 * Prissæt én forbrugshændelse.
 *
 * @returns `{ ok: true, amount, priceId, currency }` eller
 *          `{ ok: false, reason }` hvor `reason` er `missing-price` eller
 *          `currency-inconsistency`.
 */
export function priceUsageEvent(event, book, { reportCurrency = book?.defaultCurrency ?? "EUR" } = {}) {
  const price = activePrice(book, event.meter, event.occurredAt);
  if (!price) {
    return { ok: false, reason: "missing-price", detail: `ingen aktiv pris for måleren '${event.meter}' på ${event.occurredAt}` };
  }
  if (event.currency !== price.currency && fxRate(book, event.currency, price.currency) === null) {
    return { ok: false, reason: "currency-inconsistency", detail: `hændelsens valuta '${event.currency}' kan ikke forbindes med prisens valuta '${price.currency}'` };
  }
  if (fxRate(book, price.currency, reportCurrency) === null) {
    return { ok: false, reason: "currency-inconsistency", detail: `prisens valuta '${price.currency}' kan ikke omregnes til rapportvalutaen '${reportCurrency}'` };
  }
  const raw = event.quantity * price.unitPrice;
  const amount = round(convert(book, raw, price.currency, reportCurrency));
  return {
    ok: true,
    amount,
    priceId: price.id,
    unitPrice: price.unitPrice,
    currency: price.currency,
    reportCurrency,
  };
}
