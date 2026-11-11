/* eslint-disable security/detect-non-literal-fs-filename -- The output path is selected from fixed constants. */
import { writeFile, chown } from "node:fs/promises";
const kind = process.argv[2];
const targets = { splitwise: "/app/data/splitwise-api-key" };
if (!Object.hasOwn(targets, kind)) throw new Error("Specify splitwise.");
const chunks = [];
let length = 0;
for await (const chunk of process.stdin) {
  length += chunk.length;
  if (length > 16384) throw new Error("Credential input is too large.");
  chunks.push(chunk);
}
const contents = Buffer.concat(chunks).toString("utf8");
if (!contents.trim() || /\s/.test(contents.trim())) throw new Error("Invalid Splitwise credential format.");
await writeFile(targets[kind], contents, { flag: "wx", mode: 0o600 });
if (process.getuid?.() === 0) await chown(targets[kind], 1000, 1000);
console.log("Credential stored privately.");
