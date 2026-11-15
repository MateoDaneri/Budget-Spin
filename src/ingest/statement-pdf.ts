import { spawn } from "node:child_process";
import { validStatementSummary, type StatementSummary } from "./itau-statement";
const MAX_BYTES = 4 * 1024 * 1024;
/** Bounded child; no credential environment, no disk writes, generic errors only. */
export async function readStatementPdf(
  pdf: Uint8Array,
  options: {
    worker?: string;
    pdfjs?: string;
    sandbox?: string;
    timeoutMs?: number;
  } = {},
): Promise<StatementSummary> {
  if (!pdf.length || pdf.length > MAX_BYTES)
    throw new Error("Statement unavailable.");
  const worker = options.worker ?? "/app/statement-worker.mjs";
  const pdfjs = options.pdfjs ?? "/app/node_modules/pdfjs-dist";
  return await new Promise((resolve, reject) => {
    const sandbox = options.sandbox ?? "/app/pdf-sandbox";
    const child = spawn(
      /* turbopackIgnore: true */ sandbox,
      [
        process.execPath,
        "--permission",
        `--allow-fs-read=${worker}`,
        `--allow-fs-read=${pdfjs}`,
        "--max-old-space-size=128",
        worker,
      ],
      {
        cwd: "/tmp",
        env: { NODE_ENV: "production" },
        stdio: ["pipe", "pipe", "ignore"],
      },
    );
    let output = "",
      settled = false;
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error("Statement unavailable."));
    }, options.timeoutMs ?? 10000);
    function finish(error?: Error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        reject(error);
        return;
      }
      try {
        const value = JSON.parse(output) as StatementSummary;
        if (!validStatementSummary(value)) throw Error();
        resolve(value);
      } catch {
        reject(new Error("Statement unavailable."));
      }
    }
    child.on("error", () => finish(new Error("Statement unavailable.")));
    child.stdout.on("data", (part: Buffer) => {
      output += part.toString("utf8");
      if (output.length > 2048) {
        child.kill("SIGKILL");
        finish(new Error("Statement unavailable."));
      }
    });
    child.on("close", (code) =>
      finish(code === 0 ? undefined : new Error("Statement unavailable.")),
    );
    child.stdin.on("error", () => {});
    child.stdin.end(pdf);
  });
}
