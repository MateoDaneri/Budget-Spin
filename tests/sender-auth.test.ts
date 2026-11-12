import { simpleParser } from "mailparser";
import { describe, expect, it } from "vitest";
import {
  authenticationResultsValues, MAX_AUTH_RESULTS_HEADERS, MAX_AUTH_RESULTS_LENGTH, normalizeDomain,
  parseAuthenticationResults, readTrustedAuthservId, senderAuthVerdict
} from "@/src/ingest/sender-auth";

// Synthetic identifiers only (RFC 2606 / RFC 6761 reserved names).
const FROM = "avisos@bank.example";
const RECEIVER = "mx.receiver.example";

const verdict = (values: string[], from = FROM, trusted: string | null = null) => senderAuthVerdict(values, from, trusted);

describe("parseAuthenticationResults", () => {
  it("parses the RFC 8601 'none' example (authserv-id with version, no results)", () => {
    expect(parseAuthenticationResults(" example.org 1; none")).toEqual({ authservId: "example.org", results: [] });
  });

  it("parses multiple resinfo entries with comments and folded whitespace (RFC 8601 B.4)", () => {
    const parsed = parseAuthenticationResults(" example.com;\r\n          auth=pass (cram-md5) smtp.auth=sender@example.net;\r\n          spf=pass smtp.mailfrom=example.net");
    expect(parsed?.authservId).toBe("example.com");
    expect(parsed?.results.map((result) => [result.method, result.result])).toEqual([["auth", "pass"], ["spf", "pass"]]);
    expect(parsed?.results[0].properties.get("smtp.auth")).toBe("sender@example.net");
    expect(parsed?.results[1].properties.get("smtp.mailfrom")).toBe("example.net");
  });

  it("keeps several dkim results (RFC 8601 B.6)", () => {
    const parsed = parseAuthenticationResults(" mail-router.example.net;\r\n\tdkim=pass (good signature) header.d=newyork.example.com\r\n\t\theader.b=oINEO8hg;\r\n\tdkim=fail (bad signature) header.d=newyork.example.com\r\n\t\theader.b=EToRSuvU");
    expect(parsed?.results.map((result) => [result.method, result.result, result.properties.get("header.d")])).toEqual([
      ["dkim", "pass", "newyork.example.com"], ["dkim", "fail", "newyork.example.com"]
    ]);
  });

  it("ignores semicolons and parentheses inside nested comments and quoted strings", () => {
    const parsed = parseAuthenticationResults(`${RECEIVER} (relay; v=1 (inner; x)); dkim=pass (ok; "quoted (not a comment)") header.d="bank.example" header.s=sel; dmarc/1=pass header.from=bank.example`);
    expect(parsed?.results.map((result) => [result.method, result.result])).toEqual([["dkim", "pass"], ["dmarc", "pass"]]);
    expect(parsed?.results[0].properties.get("header.d")).toBe("bank.example");
  });

  it("accepts whitespace and comments around '=' and lower-cases method and result", () => {
    const parsed = parseAuthenticationResults(`${RECEIVER}; DKIM = PASS header.d = (signer) Bank.Example`);
    expect(parsed?.results[0]).toMatchObject({ method: "dkim", result: "pass" });
    expect(parsed?.results[0].properties.get("header.d")).toBe("Bank.Example");
  });

  it("does not merge a base64 header.b value ending in '=' with the next property", () => {
    const parsed = parseAuthenticationResults(`${RECEIVER}; dkim=pass header.b=abc+/12= header.d=bank.example`);
    expect(parsed?.results[0].properties.get("header.d")).toBe("bank.example");
  });

  it("rejects empty, oversized, unbalanced and authserv-id-less input", () => {
    expect(parseAuthenticationResults("")).toBeNull();
    expect(parseAuthenticationResults(`${RECEIVER}; dkim=pass header.d=bank.example (unclosed`)).toBeNull();
    expect(parseAuthenticationResults(`${RECEIVER}; dkim=pass) header.d=bank.example`)).toBeNull();
    expect(parseAuthenticationResults(`${RECEIVER}; dkim=pass header.d="bank.example`)).toBeNull();
    expect(parseAuthenticationResults("; dkim=pass header.d=bank.example")).toBeNull();
    expect(parseAuthenticationResults(`${RECEIVER}; dkim=pass header.d=bank.example ${"x".repeat(MAX_AUTH_RESULTS_LENGTH)}`)).toBeNull();
  });

  it("skips garbage resinfo entries without throwing", () => {
    const parsed = parseAuthenticationResults(`${RECEIVER}; ===; dkim=; =pass; dkim=pass\u0000 header.d=bank.example; é=pass; dkim=pass header.d=bank.example`);
    expect(parsed?.results).toHaveLength(1);
  });

  it("stays fast on pathological input at the length cap", () => {
    const inputs = ["(".repeat(MAX_AUTH_RESULTS_LENGTH), `${RECEIVER};${"a=".repeat(4000)}`, `${RECEIVER}; ${"dkim=pass ".repeat(800)}`, `${RECEIVER}${";".repeat(8000)}`, "\"\\".repeat(4000)];
    const started = performance.now();
    for (const input of inputs) expect(() => parseAuthenticationResults(input)).not.toThrow();
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe("normalizeDomain", () => {
  it("accepts LDH domains with at least two labels and rejects the rest", () => {
    expect(normalizeDomain("Bank.Example.")).toBe("bank.example");
    expect(normalizeDomain("example")).toBeNull();
    expect(normalizeDomain("-bank.example")).toBeNull();
    expect(normalizeDomain("bank..example")).toBeNull();
    expect(normalizeDomain("bank.example/evil")).toBeNull();
    expect(normalizeDomain("")).toBeNull();
  });
});

describe("senderAuthVerdict", () => {
  it("passes on dmarc=pass for the From domain", () => {
    expect(verdict([`${RECEIVER}; spf=pass smtp.mailfrom=bank.example; dmarc=pass (p=REJECT) header.from=bank.example`])).toBe("pass");
  });

  it("passes on dkim=pass with an equal signing domain, from header.d or header.i", () => {
    expect(verdict([`${RECEIVER}; dkim=pass header.d=bank.example header.s=sel`])).toBe("pass");
    expect(verdict([`${RECEIVER}; dkim=pass header.i=@bank.example`])).toBe("pass");
  });

  it("passes when the signing domain is a parent of the From domain (sub-domain alignment)", () => {
    expect(verdict([`${RECEIVER}; dkim=pass header.d=bank.example`], "avisos@mail.bank.example")).toBe("pass");
  });

  it("does not treat a child signing domain as aligned with its parent From domain", () => {
    expect(verdict([`${RECEIVER}; dkim=pass header.d=mail.bank.example`])).toBe("fail");
  });

  it("fails on dkim=pass signed by an unaligned domain", () => {
    expect(verdict([`${RECEIVER}; dkim=pass header.d=esp.example`])).toBe("fail");
  });

  it("fails on look-alike signing domains", () => {
    expect(verdict([`${RECEIVER}; dkim=pass header.d=bank.example.evil.test`])).toBe("fail");
    expect(verdict([`${RECEIVER}; dkim=pass header.d=evilbank.example`])).toBe("fail");
    expect(verdict([`${RECEIVER}; dkim=pass header.d=ank.example`])).toBe("fail");
    expect(verdict([`${RECEIVER}; dmarc=pass header.from=bank.example.evil.test`])).toBe("fail");
  });

  it("does not let a single-label signing domain align", () => {
    expect(verdict([`${RECEIVER}; dkim=pass header.d=example`])).toBe("fail");
  });

  it("fails on dkim=fail, dkim=none and dmarc=fail (dmarc=fail wins over an aligned dkim pass)", () => {
    expect(verdict([`${RECEIVER}; dkim=fail header.d=bank.example`])).toBe("fail");
    expect(verdict([`${RECEIVER}; dkim=none (no signature)`])).toBe("fail");
    expect(verdict([`${RECEIVER}; dkim=pass header.d=bank.example; dmarc=fail header.from=bank.example`])).toBe("fail");
  });

  it("passes when one of several dkim signatures passes aligned", () => {
    expect(verdict([`${RECEIVER}; dkim=fail header.d=bank.example; dkim=pass header.d=esp.example; dkim=pass header.d=bank.example`])).toBe("pass");
  });

  it("returns none without a header, without dkim/dmarc results, or with an unreadable top header", () => {
    expect(verdict([])).toBe("none");
    expect(senderAuthVerdict(undefined, FROM, null)).toBe("none");
    expect(verdict([`${RECEIVER}; none`])).toBe("none");
    expect(verdict([`${RECEIVER}; spf=pass smtp.mailfrom=bank.example`])).toBe("none");
    expect(verdict(["", `${RECEIVER}; dkim=pass header.d=bank.example`])).toBe("none");
    expect(verdict(["garbage (", `${RECEIVER}; dkim=pass header.d=bank.example`])).toBe("none");
  });

  it("cannot align when the From address has no usable domain", () => {
    expect(verdict([`${RECEIVER}; dkim=pass header.d=bank.example`], "")).toBe("fail");
    expect(verdict([`${RECEIVER}; dmarc=pass header.from=bank.example`], "not-an-address")).toBe("fail");
  });

  describe("trust selection", () => {
    const spoofedLower = `${RECEIVER}; dkim=pass header.d=bank.example; dmarc=pass header.from=bank.example`;
    const realTop = `${RECEIVER}; dkim=fail header.d=bank.example; dmarc=fail header.from=bank.example`;

    it("without a configured authserv-id uses only the topmost header", () => {
      expect(verdict([realTop, spoofedLower])).toBe("fail");
      expect(verdict([`${RECEIVER}; spf=pass smtp.mailfrom=bank.example`, spoofedLower])).toBe("none");
    });

    it("with a configured authserv-id uses the topmost header carrying it, case-insensitively", () => {
      expect(verdict([realTop, spoofedLower], FROM, RECEIVER)).toBe("fail");
      expect(verdict([realTop, spoofedLower], FROM, "MX.Receiver.Example")).toBe("fail");
      const internalRelay = "relay.internal.example; dkim=pass header.d=bank.example";
      expect(verdict([internalRelay, realTop], FROM, RECEIVER)).toBe("fail");
    });

    it("never trusts a header whose authserv-id does not match the configured one", () => {
      expect(verdict(["attacker.example; dkim=pass header.d=bank.example; dmarc=pass header.from=bank.example"], FROM, RECEIVER)).toBe("none");
      expect(verdict([`${RECEIVER}.evil.test; dmarc=pass header.from=bank.example`], FROM, RECEIVER)).toBe("none");
    });
  });
});

describe("readTrustedAuthservId", () => {
  // Next types ProcessEnv with a required NODE_ENV, so a partial env needs an explicit widening.
  const env = (vars: Record<string, string>) => vars as unknown as NodeJS.ProcessEnv;
  it("trims and lower-cases the variable; blank means unset", () => {
    expect(readTrustedAuthservId(env({ ITAU_IMAP_AUTHSERV_ID: "  MX.Receiver.Example " }))).toBe(RECEIVER);
    expect(readTrustedAuthservId(env({ ITAU_IMAP_AUTHSERV_ID: "   " }))).toBeNull();
    expect(readTrustedAuthservId(env({}))).toBeNull();
  });
});

describe("authenticationResultsValues", () => {
  it("keeps only Authentication-Results instances, in order, without the field name", () => {
    expect(authenticationResultsValues([
      { key: "authentication-results", line: `Authentication-Results: ${RECEIVER}; dkim=fail` },
      { key: "arc-authentication-results", line: "ARC-Authentication-Results: i=1; other.example; dkim=pass" },
      { key: "authentication-results", line: "authentication-results: lower.example; dkim=pass" }
    ])).toEqual([` ${RECEIVER}; dkim=fail`, " lower.example; dkim=pass"]);
    expect(authenticationResultsValues(undefined)).toEqual([]);
  });

  it("keeps the position of an oversized instance and caps the number of instances", () => {
    const big = { key: "authentication-results", line: `Authentication-Results: ${RECEIVER}; ${"x".repeat(MAX_AUTH_RESULTS_LENGTH)}` };
    const small = { key: "authentication-results", line: `Authentication-Results: ${RECEIVER}; dkim=pass` };
    expect(authenticationResultsValues([big, small])).toEqual(["", ` ${RECEIVER}; dkim=pass`]);
    expect(authenticationResultsValues(Array.from({ length: MAX_AUTH_RESULTS_HEADERS + 5 }, () => small))).toHaveLength(MAX_AUTH_RESULTS_HEADERS);
  });

  it("reads the topmost instance first from a message parsed by mailparser", async () => {
    const raw = [
      `Authentication-Results: ${RECEIVER};`,
      "\tdkim=fail header.d=bank.example;",
      "\tdmarc=fail header.from=bank.example",
      "Authentication-Results: spoofed.example; dkim=pass header.d=bank.example",
      `From: ${FROM}`,
      "Subject: synthetic",
      "Message-ID: <synthetic@example.test>",
      "",
      "body"
    ].join("\r\n");
    const parsed = await simpleParser(Buffer.from(raw));
    const values = authenticationResultsValues(parsed.headerLines);
    expect(values).toHaveLength(2);
    expect(parseAuthenticationResults(values[0])?.authservId).toBe(RECEIVER);
    expect(senderAuthVerdict(values, FROM, null)).toBe("fail");
  });
});
