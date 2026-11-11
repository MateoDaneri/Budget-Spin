import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { closeDb } from "@/src/db/client";
import { listCategories, listTransactions, migrate, setTransactionCategory } from "@/src/db/repository";
import { runItauIngest } from "@/src/ingest/ingest-itau";
import type { ItauEmailInput } from "@/src/ingest/itau-parser";

const debit: ItauEmailInput = { subject: "Aviso de consumo aprobado con tarjeta de débito", from: "comunicaciones@itau.com.uy", date: new Date("2026-06-22T20:04:29Z"), messageId: "<debit@example.test>", html: fs.readFileSync(path.resolve(__dirname, "fixtures/itau-debit-synthetic.html"), "utf8") };
const transfer: ItauEmailInput = { subject: "Aviso transferencia realizada", from: "notificaciones@itau.com.uy", date: new Date("2026-01-01T12:00:00Z"), messageId: "<transfer@example.test>", html: "<p>Transferencia realizada desde la cuenta ****0000</p><p>Importe: 123.45 URGP</p><p>Cuenta destino: EJEMPLO</p>" };
let db: string;
beforeEach(() => { db = path.join(os.tmpdir(), `migration-${crypto.randomUUID()}.sqlite`); process.env.DATABASE_PATH = db; process.env.ITAU_IMAP_STATE_DIR = `${db}-state`; process.env.ITAU_IMAP_HOST = "imap.example.test"; process.env.ITAU_IMAP_USER = "reader@example.test"; process.env.ITAU_IMAP_PASSWORD = "synthetic"; closeDb(); migrate(); });
afterEach(() => { closeDb(); for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(db + suffix, { force: true }); fs.rmSync(`${db}-state`, { recursive: true, force: true }); for (const key of ["DATABASE_PATH", "ITAU_IMAP_STATE_DIR", "ITAU_IMAP_HOST", "ITAU_IMAP_USER", "ITAU_IMAP_PASSWORD"]) delete process.env[key]; });

// A new mailbox cursor (changed account or UIDVALIDITY) re-reads notices that were
// already imported; Message-ID deduplication must keep the rows and their categories.
it("preserves imported history and categories when a re-read mailbox sees the same debit and transfer", async () => {
  expect((await runItauIngest({ fetcher: async () => ({ messages: [debit, transfer], cursor: { uidValidity: "41", lastUid: 2 }, hasMore: false }) })).inserted).toBe(2);
  const original = listTransactions();
  const purchase = original.find((row) => row.kind === "purchase")!;
  const food = listCategories("expense").find((category) => category.name === "Food")!;
  setTransactionCategory(purchase.id, food.id);
  const result = await runItauIngest({ fetcher: async () => ({ messages: [debit, transfer], cursor: { uidValidity: "42", lastUid: 2 }, hasMore: false }) });
  expect(result).toEqual({ messagesSeen: 2, inserted: 0, skipped: 2 });
  const after = listTransactions();
  expect(after).toHaveLength(2);
  expect(after.find((row) => row.id === purchase.id)?.categoryId).toBe(food.id);
  expect(after.find((row) => row.kind === "transfer_out")?.categoryId).toBeNull();
});
