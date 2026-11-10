/* eslint-disable security/detect-non-literal-fs-filename -- Paths come from local operator configuration, not email or API data. */
import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { simpleParser } from "mailparser";
import { isItauAviso, UnrecognizedNoticeError, type ItauEmailInput } from "./itau-parser";
import { isItauTransfer } from "./itau-transfer";

const API = "https://gmail.googleapis.com/gmail/v1/users/me";
const MAX_BYTES = 1024 * 1024;
type State = { account: string; mode: "full" | "history"; historyId: string; pageToken?: string; quarantined?: string[] };
type Credentials = { clientId: string; clientSecret: string; refreshToken: string };
type Fetch = typeof fetch;
type GmailResponse = {
  access_token?: string; emailAddress?: string; historyId?: string;
  nextPageToken?: string; labelIds?: string[]; raw?: string; sizeEstimate?: number;
  payload?: { headers?: Array<{ name?: string; value?: string }> };
  messages?: Array<{ id?: string }>;
  history?: Array<{ messagesAdded?: Array<{ message?: { id?: string } }> }>;
};

async function requestJson(url: string, init: RequestInit, fetcher: Fetch): Promise<GmailResponse> {
  for (let attempt = 0; attempt < 4; attempt++) {
    let response: Response;
    try {
      response = await fetcher(url, { ...init, signal: AbortSignal.timeout(30000) });
    } catch {
      if (attempt === 3) throw new Error("Gmail request failed after retries.");
      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
      continue;
    }
    if (response.ok) return await response.json() as GmailResponse;
    if ((response.status === 429 || response.status >= 500) && attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
      continue;
    }
    let reason: string | undefined;
    if (response.status === 403 || response.status === 429) {
      try {
        const body = await response.json() as { error?: { errors?: Array<{ reason?: unknown }> } };
        const candidate = body.error?.errors?.[0]?.reason;
        if (typeof candidate === "string" && ["rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded", "dailyLimitExceeded", "insufficientPermissions", "accessNotConfigured", "forbidden"].includes(candidate)) reason = candidate;
      } catch { /* Do not expose provider response bodies. */ }
    }
    throw new GmailError(response.status, reason);
  }
  throw new Error("Gmail request failed.");
}
export class GmailError extends Error {
  constructor(readonly status: number, readonly reason?: string) { super(`Gmail request failed (${status})${reason ? `: ${reason}` : ""}.`); }
}

async function readCredentials(file: string): Promise<Credentials> {
  const stat = await fs.stat(file);
  if (!stat.isFile() || (stat.mode & 0o077) !== 0) throw new Error("Gmail credential file must be private (mode 0600).");
  const value = JSON.parse(await fs.readFile(file, "utf8"));
  if (typeof value.clientId !== "string" || typeof value.clientSecret !== "string" || typeof value.refreshToken !== "string") throw new Error("Invalid Gmail credential file.");
  return value;
}

async function saveState(file: string, state: State): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, JSON.stringify(state), { mode: 0o600, flag: "wx" });
    await fs.rename(temp, file);
  } finally { await fs.unlink(temp).catch(() => {}); }
}

/** Each page is checkpointed only after all its messages have been handled. */
export async function syncGmail(options: {
  credentialsPath: string; statePath: string;
  process: (message: ItauEmailInput) => Promise<void> | void;
  fetcher?: Fetch;
}): Promise<{ quarantined: number }> {
  const fetcher = options.fetcher ?? fetch;
  const credentials = await readCredentials(options.credentialsPath);
  const token = await requestJson("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: credentials.clientId, client_secret: credentials.clientSecret, refresh_token: credentials.refreshToken, grant_type: "refresh_token" })
  }, fetcher);
  if (typeof token.access_token !== "string") throw new Error("Gmail token response invalid.");
  const headers = { Authorization: `Bearer ${token.access_token}` };
  const get = (url: string) => requestJson(url, { headers }, fetcher);
  const profile = await get(`${API}/profile`);
  if (typeof profile.emailAddress !== "string" || typeof profile.historyId !== "string") throw new Error("Gmail profile response invalid.");
  const account = createHash("sha256").update(profile.emailAddress.toLowerCase()).digest("hex");
  let state: State;
  try { state = JSON.parse(await fs.readFile(options.statePath, "utf8")) as State; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    state = { account, mode: "full", historyId: profile.historyId };
    await saveState(options.statePath, state);
  }
  if (state.account !== account || !["full", "history"].includes(state.mode) || !/^\d+$/.test(state.historyId)) throw new Error("Gmail checkpoint does not match the account or is invalid.");
  if (state.quarantined !== undefined && (!Array.isArray(state.quarantined) || state.quarantined.length > 1000 || state.quarantined.some((id) => typeof id !== "string" || !/^[a-zA-Z0-9_-]+$/.test(id)))) throw new Error("Gmail quarantine invalid.");
  const processId = async (id: string): Promise<"processed" | "irrelevant" | "quarantined" | "unavailable"> => {
      // Inspect only the two headers needed for matching before downloading a body.
      const metadata = await get(`${API}/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`);
      if (!Array.isArray(metadata.labelIds) || !metadata.labelIds.includes("INBOX")) return "unavailable";
      if (!Array.isArray(metadata.payload?.headers)) throw new Error("Gmail metadata response incomplete.");
      const headers = metadata.payload.headers.filter((header) => /^(from|subject)$/i.test(header.name ?? ""))
        .map((header) => ({ ...header, value: typeof header.value === "string" ? header.value.replace(/[\r\n]+[ \t]*/g, " ") : header.value }));
      if (headers.some((header) => typeof header.value !== "string" || /[\r\n]/.test(header.value))) return "quarantined";
      const parsedHeaders = await simpleParser(headers.map((header) => `${header.name}: ${header.value}`).join("\r\n") + "\r\n\r\n");
      const candidate: ItauEmailInput = { subject: parsedHeaders.subject ?? "", from: parsedHeaders.from?.value.length === 1 ? (parsedHeaders.from.value[0].address ?? "") : "", date: new Date(NaN), messageId: "", html: "" };
      if (!isItauAviso(candidate) && !isItauTransfer(candidate)) return "irrelevant";
      const message = await get(`${API}/messages/${id}?format=raw`);
      if (!Array.isArray(message.labelIds) || !message.labelIds.includes("INBOX")) return "unavailable";
      if (typeof message.raw !== "string" || typeof message.sizeEstimate !== "number" || message.sizeEstimate > MAX_BYTES || message.raw.length > Math.ceil(MAX_BYTES * 4 / 3) + 4) throw new Error("Gmail message exceeds size limit or is incomplete.");
      const source = Buffer.from(message.raw, "base64url");
      if (source.length > MAX_BYTES) throw new Error("Gmail message exceeds size limit.");
      const parsed = await simpleParser(source);
      try { await options.process({ subject: parsed.subject ?? "", from: parsed.from?.value.length === 1 ? (parsed.from.value[0].address ?? "") : "", date: parsed.date ?? new Date(NaN), messageId: parsed.messageId ?? "", html: typeof parsed.html === "string" ? parsed.html : (parsed.textAsHtml ?? "") }); } catch (error) { if (error instanceof UnrecognizedNoticeError) return "quarantined"; throw error; }
      return "processed";
  };
  // Retry a bounded rotating batch; archived or missing items remain available for review.
  if (state.quarantined?.length) {
    const retry = state.quarantined.slice(0, 50), remaining = state.quarantined.slice(50);
    for (const id of retry) {
      let result: "processed" | "irrelevant" | "quarantined" | "unavailable";
      try { result = await processId(id); }
      catch (error) { if (error instanceof GmailError && error.status === 404) { remaining.push(id); continue; } throw error; }
      if (result === "quarantined" || result === "unavailable") remaining.push(id);
    }
    state = { ...state, quarantined: remaining };
    await saveState(options.statePath, state);
  }
  for (let page = 0; page < 2; page++) {
    const url = new URL(`${API}/${state.mode === "full" ? "messages" : "history"}`);
    url.searchParams.set("maxResults", "50");
    if (state.mode === "full") url.searchParams.set("labelIds", "INBOX");
    else { url.searchParams.set("startHistoryId", state.historyId); url.searchParams.set("historyTypes", "messageAdded"); }
    if (state.pageToken) url.searchParams.set("pageToken", state.pageToken);
    let result: GmailResponse;
    try { result = await get(url.toString()); }
    catch (error) {
      if (state.mode === "history" && error instanceof GmailError && error.status === 404) {
        state = { account, mode: "full", historyId: profile.historyId, quarantined: state.quarantined };
        await saveState(options.statePath, state);
        continue;
      }
      throw error;
    }
    const ids: Array<string | undefined> = state.mode === "full"
      ? (result.messages ?? []).map((entry: { id?: string }) => entry.id)
      : (result.history ?? []).flatMap((entry: { messagesAdded?: Array<{ message?: { id?: string } }> }) => (entry.messagesAdded ?? []).map((item) => item.message?.id));
    const quarantined = new Set(state.quarantined ?? []);
    for (const id of new Set(ids)) {
      if (typeof id !== "string" || !/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("Invalid Gmail message ID.");
      const outcome = await processId(id);
      if (outcome === "quarantined") quarantined.add(id);
      else if (outcome === "processed" || outcome === "irrelevant") quarantined.delete(id);
      if (quarantined.size > 1000) throw new Error("Gmail quarantine limit exceeded.");
    }
    state = { ...state, quarantined: [...quarantined] };
    if (result.nextPageToken) state = { ...state, pageToken: result.nextPageToken };
    else if (state.mode === "full") state = { account, mode: "history", historyId: state.historyId, quarantined: state.quarantined };
    else {
      if (typeof result.historyId !== "string" || !/^\d+$/.test(result.historyId)) throw new Error("Gmail history response invalid.");
      await saveState(options.statePath, { account, mode: "history", historyId: result.historyId, quarantined: state.quarantined });
      return { quarantined: state.quarantined?.length ?? 0 };
    }
    await saveState(options.statePath, state);
  }
  return { quarantined: state.quarantined?.length ?? 0 };
}
