import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/src/splitwise/sync", () => ({ syncSplitwise: vi.fn() }));
import { syncSplitwise } from "@/src/splitwise/sync";
import { POST } from "@/app/api/ingest/splitwise/route";
const TOKEN = "synthetic-splitwise-token-0123456789abcdef";
const request = (token: string) => new Request("http://localhost/api/ingest/splitwise", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
afterEach(() => { delete process.env.INGEST_TOKEN; vi.resetAllMocks(); });
describe("Splitwise scheduler endpoint", () => {
  it("requires authorization and hides failures", async () => {
    expect((await POST(request("x"))).status).toBe(503);
    process.env.INGEST_TOKEN = TOKEN;
    expect((await POST(request("wrong"))).status).toBe(401);
    vi.mocked(syncSplitwise).mockRejectedValueOnce(new Error("private"));
    const response = await POST(request(TOKEN));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("private");
  });
  it("prevents overlapping passes", async () => {
    process.env.INGEST_TOKEN = TOKEN;
    let finish!: () => void;
    vi.mocked(syncSplitwise).mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    const first = POST(request(TOKEN));
    expect((await POST(request(TOKEN))).status).toBe(409);
    finish();
    expect((await first).status).toBe(200);
  });
});
