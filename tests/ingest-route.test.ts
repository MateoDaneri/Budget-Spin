import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/src/ingest/ingest-itau", () => ({ runItauIngest: vi.fn() }));
import { runItauIngest } from "@/src/ingest/ingest-itau";
import { POST } from "@/app/api/ingest/itau/route";

function request(token = "test-token") {
  return new Request("http://localhost/api/ingest/itau", {
    method: "POST", headers: { Authorization: `Bearer ${token}` }
  });
}

afterEach(() => {
  delete process.env.INGEST_TOKEN;
  vi.resetAllMocks();
});

describe("ingest endpoint", () => {
  it("requires configuration and authorization", async () => {
    delete process.env.INGEST_TOKEN;
    expect((await POST(request())).status).toBe(503);
    process.env.INGEST_TOKEN = "test-token";
    expect((await POST(request("wrong"))).status).toBe(401);
    expect(runItauIngest).not.toHaveBeenCalled();
  });

  it("rejects concurrent runs and permits a new run after completion", async () => {
    process.env.INGEST_TOKEN = "test-token";
    let finish!: (value: { messagesSeen: number; inserted: number; skipped: number }) => void;
    vi.mocked(runItauIngest).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const first = POST(request());
    expect((await POST(request())).status).toBe(409);
    finish({ messagesSeen: 0, inserted: 0, skipped: 0 });
    expect((await first).status).toBe(200);
    vi.mocked(runItauIngest).mockResolvedValueOnce({ messagesSeen: 0, inserted: 0, skipped: 0 });
    expect((await POST(request())).status).toBe(200);
  });

  it("hides internal errors and releases the lock on failure", async () => {
    process.env.INGEST_TOKEN = "test-token";
    vi.mocked(runItauIngest).mockRejectedValueOnce(new Error("sensitive internal detail"));
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false, error: "Ingest failed." });
    vi.mocked(runItauIngest).mockResolvedValueOnce({ messagesSeen: 0, inserted: 0, skipped: 0 });
    expect((await POST(request())).status).toBe(200);
  });
});
