/**
 * Pure model of dsh-route-balance: balance formatting and wallet aggregation.
 * No React, no DOM, no Remote — `lib/client.js` inlines this file, and the test
 * suite exercises it directly.
 *
 * The higher-level model (sources, entries, snapshots, the polling store) lives
 * in `lib/registry.js`; this file only knows how to turn provider amounts into
 * display text.
 */

/** Display symbols for the currency codes the providers use. */
const SYMBOLS = { CNY: "¥", USD: "$", HKD: "HK$", EUR: "€", JPY: "¥" };

/** @returns the display symbol for one currency code. */
export function currencySymbol(currency) {
  return SYMBOLS[currency] ?? (currency ? currency + " " : "");
}

/** Round one non-negative decimal string to `digits` places, half-up, on integers only. */
export function roundDecimalString(text, digits) {
  if (typeof text !== 'string' && typeof text !== 'number') return null;
  const raw = String(text ?? "").trim();
  if (!/^\d+(?:\.\d+)?$/.test(raw)) return null;
  const [whole, fraction = ""] = raw.split(".");
  const keep = fraction.slice(0, digits);
  const next = fraction.slice(digits, digits + 1);
  let value = BigInt(whole + keep.padEnd(digits, "0"));
  if (next !== "" && Number(next) >= 5) value += 1n;
  const text2 = value.toString().padStart(digits + 1, "0");
  return digits === 0 ? text2 : text2.slice(0, -digits) + "." + text2.slice(-digits);
}

/** Group the integer part with separators; leaves the fraction untouched. */
export function groupDigits(text) {
  const [whole, fraction] = String(text).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction === undefined ? grouped : grouped + "." + fraction;
}

/**
 * Format one provider balance string: two decimals normally, four for sub-cent
 * remainders, and the raw string when it is not a plain decimal (the DeepSeek
 * Platform may answer `5.0000000000000000`).
 */
export function formatAmount(text) {
  const value = roundDecimalString(text, 2);
  if (value === null) return String(text ?? "");
  const amount = asNumber(text);
  if (value === "0.00" && amount !== null && amount > 0) {
    const precise = roundDecimalString(text, 4);
    return precise === null ? String(text) : groupDigits(precise);
  }
  return groupDigits(value);
}

/** @returns a plain-decimal amount, or null when the string is not one. */
export function asNumber(text) {
  if (typeof text === "number") return Number.isFinite(text) && text >= 0 ? text : null;
  if (typeof text !== "string") return null;
  const raw = text.trim();
  // The account API can spell a measured zero as 0E-16; this is not unknown.
  if (/^0+(?:\.0+)?[Ee][+-]?\d+$/.test(raw)) return 0;
  if (!/^\d+(?:\.\d+)?$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/** @returns whether the string is a usable non-negative balance amount. */
export function isAmount(text) {
  return asNumber(text) !== null;
}

/**
 * Strict "this really is a number" test for values that arrive as JSON.
 *
 * `Number(value)` is not enough: it turns `null` into a confident 0, `""` into 0,
 * `true` into 1 and `false` into 0 — which is how a missing field became a
 * trustworthy balance. Booleans, null, undefined, empty strings, arrays and
 * objects are all rejected here; only a finite number or a plain decimal string
 * passes. Whitespace around a decimal string is tolerated because providers pad.
 *
 * @returns `true` when `value` is a finite number or a plain decimal string.
 */
export function isNumeric(value) {
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'string') return false;
  const raw = value.trim();
  if (raw === '' || !/^-?\d+(?:\.\d+)?$/.test(raw)) return false;
  return Number.isFinite(Number(raw));
}

/** @returns one wallet list with unusable members dropped. */
export function walletsOf(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((wallet) => wallet !== null && typeof wallet === "object" && typeof wallet.currency === "string" && /^[A-Z]{3,8}$/.test(wallet.currency) && wallet.balance !== undefined);
}

/**
 * Sum wallet amounts that share a currency.
 * @returns [{currency, balance}] in first-seen currency order.
 */
export function totalsByCurrency(wallets) {
  const totals = new Map();
  for (const wallet of walletsOf(wallets)) {
    const amount = asNumber(wallet.balance);
    if (amount === null) continue;
    const currency = wallet.currency;
    totals.set(currency, (totals.get(currency) ?? 0) + amount);
  }
  return [...totals].filter(([, total]) => Number.isFinite(total)).map(([currency, total]) => ({ currency, balance: total.toFixed(8) }));
}

/** @returns the currency whose total is the headline figure, or null. */
export function headline(wallets) {
  const totals = totalsByCurrency(wallets);
  if (totals.length === 0) return null;
  let best = totals[0];
  for (const entry of totals) if (Number(entry.balance) > Number(best.balance)) best = entry;
  return best;
}

/** @returns the formatted amounts of one entry's wallets, if it carries any. */
export function entryAmounts(entry) {
  return totalsByCurrency(entry?.wallets).map((total) => ({
    currency: total.currency,
    text: currencySymbol(total.currency) + formatAmount(total.balance),
  }));
}

/** @returns an unavailable entry for a source that cannot answer right now. */
export function unavailableEntry(id, label, reason, at) {
  return {
    id: String(id ?? "unknown"),
    label: String(label ?? id ?? "unknown"),
    at,
    kind: "unavailable",
    detail: typeof reason === "string" ? reason : undefined,
  };
}

/** Never display arbitrary Remote or thrown-error messages in the page. */
export function describeError(error) {
  const known = ["gateway/cancelled", "gateway/unauthorized", "gateway/forbidden", "gateway/timeout", "gateway/unavailable"];
  if (known.includes(error?.code)) return error.code;
  if (error?.name === "TimeoutError") return "读取超时，请稍后重试";
  if (error?.name === "AbortError") return "读取已取消";
  return "读取失败，请检查连接和账号状态";
}

/**
 * The calling-UI identity every DeepSeek Platform-reaching account call needs.
 * @param version - this plugin's version.
 * @param navigatorLike - `navigator` (or a stand-in with `language`).
 * @param now - current date.
 */
export function clientMetadata(version, navigatorLike, now) {
  const language = typeof navigatorLike?.language === "string" ? navigatorLike.language : "zh-CN";
  const date = now ?? new Date();
  return {
    version,
    locale: language,
    timezoneOffsetSeconds: -date.getTimezoneOffset() * 60,
  };
}
