/** Small dependency-free PDF writer for operational report exports. */
export function buildReportPdf(title: string, lines: string[]): Buffer {
  const width = 595.28;
  const height = 841.89;
  const margin = 42;
  const clean = (value: string) => value
    .replace(/₹/g, 'Rs.').replace(/€/g, 'EUR').replace(/[–—]/g, '-')
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[^\x20-\x7e]/g, '?');
  const escape = (value: string) => clean(value).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const chunks: string[][] = [];
  let page: string[] = [];
  for (const line of lines) {
    const text = clean(line);
    const limit = 108;
    for (let offset = 0; offset < Math.max(text.length, 1); offset += limit) page.push(text.slice(offset, offset + limit));
    if (page.length >= 58) { chunks.push(page); page = []; }
  }
  if (page.length || !chunks.length) chunks.push(page);
  const objects: string[] = [];
  const add = (body: string) => { objects.push(body); return objects.length; };
  const catalog = add('');
  const pagesId = add('');
  const regular = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const bold = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const pageIds: number[] = [];
  chunks.forEach((rows, index) => {
    const ops = [
      'BT /F2 16 Tf 1 0 0 1 42 798 Tm (' + escape(title) + ') Tj ET',
      `BT /F1 8 Tf 1 0 0 1 42 782 Tm (Generated ${new Date().toISOString()} | Page ${index + 1} of ${chunks.length}) Tj ET`,
      '0.6 w 42 773 m 553 773 l S',
      ...rows.map((row, rowIndex) => `BT /F1 8 Tf 1 0 0 1 ${margin} ${754 - rowIndex * 12} Tm (${escape(row)}) Tj ET`),
    ].join('\n');
    const content = add(`<< /Length ${Buffer.byteLength(ops, 'latin1')} >>\nstream\n${ops}\nendstream`);
    pageIds.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 ${regular} 0 R /F2 ${bold} 0 R >> >> /Contents ${content} 0 R >>`));
  });
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
  let output = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, index) => { offsets.push(Buffer.byteLength(output, 'latin1')); output += `${index + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = Buffer.byteLength(output, 'latin1');
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`;
  output += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(output, 'latin1');
}
