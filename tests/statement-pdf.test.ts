import { beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { readStatementPdf } from "@/src/ingest/statement-pdf";
const root = process.cwd(),
  sandbox = path.join(root, "node_modules/.cache/pdf-sandbox"),
  worker = path.join(root, "node_modules/.cache/statement-worker.mjs"),
  pdfjs = path.join(root, "node_modules/pdfjs-dist");
beforeAll(() => {
  execFileSync(
    path.join(root, "node_modules/.bin/esbuild"),
    [
      "scripts/statement-worker.ts",
      "--bundle",
      "--platform=node",
      "--format=esm",
      "--packages=external",
      `--outfile=${worker}`,
    ],
    { cwd: root, stdio: "ignore" },
  );
  execFileSync(
    "gcc",
    [
      "-O2",
      "-Wall",
      "-Wextra",
      "-Werror",
      "scripts/pdf-sandbox.c",
      "-o",
      sandbox,
    ],
    { cwd: root, stdio: "ignore" },
  );
});
function pdf(): Buffer {
  const stream =
    "BT /F1 12 Tf 1 0 0 1 491 727 Tm (01/01/2026) Tj 1 0 0 1 132 690 Tm (10/01/2026) Tj 1 0 0 1 206 690 Tm (10/02/2026) Tj 1 0 0 1 275 674 Tm (X.X./10/01/2026) Tj 1 0 0 1 50 592 Tm (SALDO DEL ESTADO DE CUENTA ANTERIOR) Tj 1 0 0 1 50 500 Tm (SALDO CONTADO) Tj 1 0 0 1 430 500 Tm (1.234,56) Tj ET";
  const parts = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let data = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 0; i < parts.length; i++) {
    offsets.push(Buffer.byteLength(data));
    data += `${i + 1} 0 obj\n${parts[i]}\nendobj\n`;
  }
  const x = Buffer.byteLength(data);
  data += `xref\n0 ${parts.length + 1}\n0000000000 65535 f \n`;
  for (const n of offsets.slice(1))
    data += `${String(n).padStart(10, "0")} 00000 n \n`;
  data += `trailer\n<< /Size ${parts.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return Buffer.from(data);
}
describe("untrusted PDF worker", () => {
  it("extracts a synthetic labeled summary in a restricted child", async () => {
    expect(await readStatementPdf(pdf(), { worker, pdfjs, sandbox })).toEqual({
      issuedOn: "2026-01-01",
      dueDate: "2026-01-10",
      totalUyuMinor: 123456,
      totalUsdMinor: null,
    });
  });
  it("blocks network sockets at the OS level", () => {
    const output = execFileSync(
      sandbox,
      [
        process.execPath,
        "-e",
        "const net=require('node:net');const s=net.createConnection({host:'127.0.0.1',port:9});s.on('error',e=>{process.stdout.write(e.code);process.exit(0)});s.on('connect',()=>process.exit(2))",
      ],
      { encoding: "utf8", timeout: 5000 },
    );
    expect(output).toBe("EPERM");
  });
  it("cannot read unrelated host files", () => {
    const code =
      "try{require('node:fs').readFileSync('/etc/passwd');process.exit(2)}catch(e){process.stdout.write(e.code)}";
    expect(
      execFileSync(sandbox, [process.execPath, "--permission", "-e", code], {
        encoding: "utf8",
        timeout: 5000,
      }),
    ).toBe("ERR_ACCESS_DENIED");
  });
  it("rejects corrupt and oversized input without reporting its contents", async () => {
    await expect(
      readStatementPdf(Buffer.from("private content"), {
        worker,
        pdfjs,
        sandbox,
      }),
    ).rejects.toThrow("Statement unavailable.");
    await expect(
      readStatementPdf(Buffer.alloc(4 * 1024 * 1024 + 1), {
        worker,
        pdfjs,
        sandbox,
      }),
    ).rejects.toThrow("Statement unavailable.");
  });
});
