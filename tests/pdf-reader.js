import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";

/** Parse downloads with Mozilla's PDF reader in CI; no system tools required. */
export async function readPdf(buffer) {
  const task = getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: false,
    isEvalSupported: false,
    disableFontFace: true,
  });
  try {
    const document = await task.promise;
    const pages = [];
    for (let index = 1; index <= document.numPages; index++) {
      const page = await document.getPage(index);
      const content = await page.getTextContent();
      const operations = await page.getOperatorList();
      const viewport = page.getViewport({ scale: 1 });
      const items = content.items.filter(
        (item) => typeof item.str === "string",
      );
      pages.push({
        width: viewport.width,
        height: viewport.height,
        items,
        lines: items.map((item) => item.str),
        text: items
          .map((item) => item.str + (item.hasEOL ? "\n" : " "))
          .join(""),
        hasImage: operations.fnArray.some((operation) =>
          [
            OPS.paintImageXObject,
            OPS.paintInlineImageXObject,
            OPS.paintImageXObjectRepeat,
          ].includes(operation),
        ),
      });
      page.cleanup();
    }
    const metadata = await document.getMetadata();
    return { text: pages.map((page) => page.text).join("\n"), pages, metadata };
  } finally {
    await task.destroy();
  }
}
