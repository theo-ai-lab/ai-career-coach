/**
 * minimal-pdf.mjs
 *
 * Builds a minimal single-page PDF (as a Buffer) whose page draws the given
 * text with the built-in Helvetica font. Used by scripts/verify-live.mjs to
 * exercise the /api/upload -> /api/query path against a deployment without
 * shipping a binary fixture, and by lib/upload-pipeline.test.ts to prove the
 * app's own PDF extractor can read exactly what the verifier uploads (so the
 * verifier can never false-flag a healthy deployment with an unparseable
 * probe file).
 *
 * Plain Node ESM on purpose: no dependencies, no TypeScript, so the verifier
 * runs with `node` alone. The xref offsets are computed, not hand-counted;
 * every byte is ASCII so string offsets equal byte offsets.
 */

/**
 * Escape a line for a PDF literal string: backslash, parens. Non-ASCII
 * characters are replaced with "?" so that string offsets equal byte offsets
 * (the xref table depends on that) and the built-in Helvetica encoding stays
 * valid.
 */
function escapePdfText(line) {
  return line
    .replace(/[^\x20-\x7e]/g, "?")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

/**
 * @param {string} text  Text content; newlines become new lines on the page.
 * @returns {Buffer} A valid PDF document.
 */
export function buildMinimalPdf(text) {
  const lines = String(text).split("\n").map(escapePdfText);
  const streamParts = ["BT", "/F1 12 Tf", "14 TL", "72 720 Td"];
  for (const line of lines) {
    streamParts.push(`(${line}) Tj`, "T*");
  }
  streamParts.push("ET");
  const stream = streamParts.join("\n");

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] " +
      "/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf +=
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n` +
    `startxref\n${xrefStart}\n%%EOF\n`;

  // Return an UNPOOLED buffer. Buffer.from(string) hands back a view into
  // Node's shared 8KB buffer pool (non-zero byteOffset into a larger
  // ArrayBuffer); the pdf.js build bundled with pdf-parse reads the view's
  // whole underlying ArrayBuffer, so a pooled buffer makes it parse
  // neighboring pool bytes instead of this document ("bad XRef entry" —
  // verified empirically against pdf-parse@1.1.4).
  const bytes = Buffer.alloc(pdf.length);
  bytes.write(pdf, "latin1");
  return bytes;
}
