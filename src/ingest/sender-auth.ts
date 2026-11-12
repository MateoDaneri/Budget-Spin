// Sender authentication verdict for bank notices (MEJ-002, observation mode).
//
// Scope: pure functions, no I/O. The verdict is recorded per imported notice and
// shown in /transactions; nothing is blocked or excluded from totals because of it.
//
// Trust model (RFC 8601): only the Authentication-Results header written by the
// receiving mailbox provider is meaningful. It is identified by its authserv-id
// and is the topmost instance; any instance below it may have been written by the
// sender. Every input here is attacker-influenced text, so each step is bounded:
// a per-header length cap, a header count cap, hand-written scanners and fixed,
// anchored regular expressions without nested quantifiers.

export const SENDER_AUTH_VERDICTS = ["pass", "fail", "none"] as const;
export type SenderAuthVerdict = (typeof SENDER_AUTH_VERDICTS)[number];

/** Longest Authentication-Results value that is parsed; longer instances count as unreadable. */
export const MAX_AUTH_RESULTS_LENGTH = 8 * 1024;
/** Only the topmost instances are kept; the trusted one is expected near the top. */
export const MAX_AUTH_RESULTS_HEADERS = 32;
const MAX_RESULTS_PER_HEADER = 64;
const HEADER_NAME = "authentication-results";

export function isSenderAuthVerdict(value: unknown): value is SenderAuthVerdict {
  return typeof value === "string" && (SENDER_AUTH_VERDICTS as readonly string[]).includes(value);
}

/**
 * The trusted authserv-id of the receiving mailbox provider, from
 * ITAU_IMAP_AUTHSERV_ID. Unset or blank means "use the topmost header only",
 * which is weaker: it relies on the provider always adding its own header.
 */
export function readTrustedAuthservId(env: NodeJS.ProcessEnv = process.env): string | null {
  const value = env.ITAU_IMAP_AUTHSERV_ID?.trim().toLowerCase();
  return value ? value : null;
}

/**
 * Authentication-Results values in message order (topmost first), from the raw
 * header lines a mail parser exposes. An oversized instance is kept as "" so it
 * still occupies its position (it can never be trusted or parsed).
 */
export function authenticationResultsValues(lines: ReadonlyArray<{ key: string; line: string }> | undefined): string[] {
  const values: string[] = [];
  for (const entry of lines ?? []) {
    if (values.length >= MAX_AUTH_RESULTS_HEADERS) break;
    if (typeof entry.key !== "string" || entry.key.toLowerCase() !== HEADER_NAME || typeof entry.line !== "string") continue;
    const colon = entry.line.indexOf(":");
    const value = colon >= 0 && entry.line.slice(0, colon).trim().toLowerCase() === HEADER_NAME ? entry.line.slice(colon + 1) : entry.line;
    values.push(value.length > MAX_AUTH_RESULTS_LENGTH ? "" : value);
  }
  return values;
}

export type AuthResult = { method: string; result: string; properties: ReadonlyMap<string, string> };
export type ParsedAuthenticationResults = { authservId: string; results: AuthResult[] };

// methodspec: method [ "/" version ] "=" result. The optional version is an
// empty alternative instead of "?" so no quantifier is nested in another.
const METHOD_SPEC = /^([a-z0-9][a-z0-9_-]{0,31})(?:\/[0-9]{1,4}|)=([a-z]{1,16})$/i;
// propspec: ptype "." property "=" pvalue (pvalue may be a quoted string)
const PROPERTY_SPEC = /^([a-z]{1,16})\.([a-z0-9_-]{1,32})=(.{1,1024})$/i;
const AUTHSERV_ID = /^[!-~]{1,255}$/;
const DNS_LABEL = /^[a-z0-9-]{1,63}$/;

/**
 * Parses one Authentication-Results value. Returns null for anything that is
 * not a well-formed header (empty, oversized, unbalanced comment or quote,
 * missing authserv-id). Unknown or malformed resinfo entries are skipped.
 */
export function parseAuthenticationResults(value: string): ParsedAuthenticationResults | null {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_AUTH_RESULTS_LENGTH) return null;
  const segments = tokenize(value);
  if (!segments || segments[0].length === 0) return null;
  const authservId = unquote(segments[0][0]).toLowerCase();
  if (!AUTHSERV_ID.test(authservId)) return null;
  const results: AuthResult[] = [];
  for (const tokens of segments.slice(1, 1 + MAX_RESULTS_PER_HEADER)) {
    if (tokens.length === 0) continue;
    const method = METHOD_SPEC.exec(tokens[0]);
    if (!method) continue; // "none", reason-only or garbage entries
    const properties = new Map<string, string>();
    for (const token of tokens.slice(1)) {
      const property = PROPERTY_SPEC.exec(token);
      if (!property) continue; // reason=..., stray text
      const key = `${property[1].toLowerCase()}.${property[2].toLowerCase()}`;
      if (!properties.has(key)) properties.set(key, unquote(property[3]));
    }
    results.push({ method: method[1].toLowerCase(), result: method[2].toLowerCase(), properties });
  }
  return { authservId, results };
}

/**
 * Verdict for one message:
 * - pass: dmarc=pass for the From domain, or dkim=pass whose signing domain
 *   (header.d, else the domain of header.i) equals the From domain or is a parent
 *   of it (aligned);
 * - fail: dmarc=fail; dmarc=pass for a different domain than From; or dkim
 *   results present but none passes aligned;
 * - none: no trusted header, or it carries no dkim/dmarc result.
 */
export function senderAuthVerdict(values: readonly string[] | undefined, fromAddress: string, trustedAuthservId: string | null): SenderAuthVerdict {
  const trusted = selectTrusted(values ?? [], trustedAuthservId);
  if (!trusted) return "none";
  const at = fromAddress.lastIndexOf("@");
  const fromDomain = at > 0 ? normalizeDomain(fromAddress.slice(at + 1)) : null;
  const dkim = trusted.results.filter((result) => result.method === "dkim");
  const dmarc = trusted.results.filter((result) => result.method === "dmarc");
  if (dmarc.some((result) => result.result === "fail")) return "fail";
  const dmarcPasses = dmarc.filter((result) => result.result === "pass");
  if (fromDomain && dmarcPasses.some((result) => normalizeDomain(result.properties.get("header.from") ?? "") === fromDomain)) return "pass";
  // A pass evaluated for another domain than the visible From is not a pass for this message.
  if (dmarcPasses.some((result) => result.properties.has("header.from"))) return "fail";
  if (fromDomain && dkim.some((result) => {
    if (result.result !== "pass") return false;
    const signing = signingDomain(result);
    return signing !== null && (signing === fromDomain || fromDomain.endsWith(`.${signing}`));
  })) return "pass";
  if (dkim.length > 0) return "fail";
  return "none";
}

/** With a configured authserv-id: topmost instance carrying it. Without: the topmost instance only. */
function selectTrusted(values: readonly string[], trustedAuthservId: string | null): ParsedAuthenticationResults | null {
  const wanted = trustedAuthservId?.trim().toLowerCase();
  if (!wanted) return values.length ? parseAuthenticationResults(values[0]) : null;
  for (const value of values.slice(0, MAX_AUTH_RESULTS_HEADERS)) {
    const parsed = parseAuthenticationResults(value);
    if (parsed && parsed.authservId === wanted) return parsed;
  }
  return null;
}

function signingDomain(result: AuthResult): string | null {
  const d = result.properties.get("header.d");
  if (d !== undefined) return normalizeDomain(d);
  const i = result.properties.get("header.i");
  if (i === undefined) return null;
  return normalizeDomain(i.slice(i.lastIndexOf("@") + 1));
}

/** Lower-case LDH domain with at least two labels; anything else is null. */
export function normalizeDomain(raw: string): string | null {
  let domain = raw.trim().toLowerCase();
  if (domain.endsWith(".")) domain = domain.slice(0, -1);
  if (domain.length === 0 || domain.length > 253) return null;
  const labels = domain.split(".");
  if (labels.length < 2) return null;
  for (const label of labels) {
    if (!DNS_LABEL.test(label) || label.startsWith("-") || label.endsWith("-")) return null;
  }
  return domain;
}

/**
 * Splits a header value into ";"-separated segments of whitespace-separated
 * tokens. Comments (nested parentheses) are dropped, quoted strings are kept
 * whole, folded whitespace counts as a separator. Linear single pass; returns
 * null on an unbalanced comment or quote.
 */
function tokenize(value: string): string[][] | null {
  const segments: string[][] = [[]];
  let token = "";
  let depth = 0;
  let quoted = false;
  const flush = () => {
    if (token) segments[segments.length - 1].push(token);
    token = "";
  };
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    if (quoted) {
      if (char === "\\" && index + 1 < value.length) {
        token += char + value[index + 1];
        index++;
        continue;
      }
      token += char;
      if (char === "\"") quoted = false;
      continue;
    }
    if (depth > 0) {
      if (char === "\\") index++;
      else if (char === "(") depth++;
      else if (char === ")") depth--;
      continue;
    }
    if (char === "(") { flush(); depth = 1; continue; }
    if (char === ")") return null;
    if (char === "\"") { quoted = true; token += char; continue; }
    if (char === ";") { flush(); segments.push([]); continue; }
    if (char === " " || char === "\t" || char === "\r" || char === "\n") { flush(); continue; }
    token += char;
  }
  if (quoted || depth > 0) return null;
  flush();
  return segments.map(mergeEquals);
}

/** Re-joins "dkim = pass" / "header.d= example.com" split by whitespace or a comment. */
function mergeEquals(tokens: string[]): string[] {
  const merged: string[] = [];
  for (const token of tokens) {
    const last = merged.length - 1;
    const previous = last >= 0 ? merged[last] : "";
    const previousOpen = previous.indexOf("=") === previous.length - 1 && previous.length > 0;
    const continues = token.startsWith("=") && previous.length > 0 && !previous.includes("=");
    if (previousOpen || continues) merged[last] = previous + token;
    else merged.push(token);
  }
  return merged;
}

function unquote(value: string): string {
  if (value.length < 2 || !value.startsWith("\"") || !value.endsWith("\"")) return value;
  let out = "";
  for (let index = 1; index < value.length - 1; index++) {
    if (value[index] === "\\" && index + 1 < value.length - 1) index++;
    out += value[index];
  }
  return out;
}
