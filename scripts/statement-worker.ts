import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  parseStatementItems,
  type StatementText,
} from "../src/ingest/itau-statement";
const MAX_BYTES = 4 * 1024 * 1024,
  MAX_PAGES = 12,
  MAX_ITEMS = 40000;
async function main() {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const b = Buffer.from(chunk);
    size += b.length;
    if (size > MAX_BYTES) throw Error("input limit");
    chunks.push(b);
  }
  if (!size) throw Error("empty");
  const options = {
    data: new Uint8Array(Buffer.concat(chunks)),
    isEvalSupported: false,
    enableScripting: false,
    disableFontFace: true,
    useSystemFonts: false,
    enableXfa: false,
    stopAtErrors: true,
    verbosity: 0,
  };
  const task = getDocument(options);
  try {
    const doc = await task.promise;
    if (!doc.numPages || doc.numPages > MAX_PAGES) throw Error("page limit");
    const pages: StatementText[][] = [];
    let count = 0;
    for (let n = 1; n <= doc.numPages; n++) {
      const content = await (await doc.getPage(n)).getTextContent();
      count += content.items.length;
      if (count > MAX_ITEMS) throw Error("item limit");
      const page: StatementText[] = [];
      for (const item of content.items) {
        if (!("str" in item)) continue;
        if (
          item.str.length > 1000 ||
          !Number.isFinite(item.transform[4]) ||
          !Number.isFinite(item.transform[5])
        )
          throw Error("invalid item");
        page.push({
          x: item.transform[4],
          y: item.transform[5],
          str: item.str,
        });
      }
      pages.push(page);
    }
    const summary = parseStatementItems(pages);
    if (!summary) throw Error("unrecognized");
    process.stdout.write(JSON.stringify(summary));
  } finally {
    await task.destroy();
  }
}
main().catch(() => {
  process.stderr.write("Statement could not be processed.\n");
  process.exitCode = 1;
});
