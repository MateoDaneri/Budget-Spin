import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/src/auth/session", () => ({ getCurrentSession: vi.fn() }));
vi.mock("@/src/db/repository", () => ({ listCurrencies: vi.fn() }));
vi.mock("@/src/finance/fx-rate", () => ({ fetchLatestFxRate: vi.fn() }));
import { getCurrentSession } from "@/src/auth/session";
import { listCurrencies } from "@/src/db/repository";
import { fetchLatestFxRate } from "@/src/finance/fx-rate";
import { GET } from "@/app/api/fx-rate/route";

const SESSION = { userId: "local", username: "user" };
const request = () => new Request("http://localhost/api/fx-rate?base=USD&quote=UYU");

afterEach(() => {
  vi.resetAllMocks();
});

describe("/api/fx-rate", () => {
  it("returns 401 JSON without a session and does no work", async () => {
    vi.mocked(getCurrentSession).mockResolvedValueOnce(null);
    const response = await GET(request());
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized." });
    expect(listCurrencies).not.toHaveBeenCalled();
    expect(fetchLatestFxRate).not.toHaveBeenCalled();
  });

  it("serves the rate with a session", async () => {
    vi.mocked(getCurrentSession).mockResolvedValueOnce(SESSION);
    vi.mocked(listCurrencies).mockReturnValueOnce([{ code: "USD" }, { code: "UYU" }] as ReturnType<typeof listCurrencies>);
    const rate = { base: "USD", quote: "UYU", rate: 40, date: "2026-01-01", source: "frankfurter" as const };
    vi.mocked(fetchLatestFxRate).mockResolvedValueOnce(rate);
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(rate);
  });

  it("hides provider errors behind a fixed message", async () => {
    vi.mocked(getCurrentSession).mockResolvedValueOnce(SESSION);
    vi.mocked(listCurrencies).mockReturnValueOnce([{ code: "USD" }, { code: "UYU" }] as ReturnType<typeof listCurrencies>);
    vi.mocked(fetchLatestFxRate).mockRejectedValueOnce(new Error("FX provider returned HTTP 503 internal detail"));
    const response = await GET(request());
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Could not fetch FX rate." });
  });
});
