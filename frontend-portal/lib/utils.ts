/**
 * Escapes a single value for RFC-4180 CSV output and neutralizes
 * spreadsheet formula-injection prefixes on non-numeric strings.
 */
export function escapeCsvCell(raw: unknown): string {
  if (raw === null || raw === undefined) return '';

  let str = typeof raw === 'object' ? JSON.stringify(raw) : String(raw);

  // Neutralize spreadsheet formula injection while preserving valid negative numbers (e.g. -49.4)
  const isNumeric = /^-?\d+(\.\d+)?$/.test(str.trim());
  if (!isNumeric && /^[=+@\t\r]|^-[^0-9]/.test(str)) {
    str = `'${str}`;
  }

  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Converts an array of plain objects into an RFC-4180 compliant CSV string.
 * When `headers` is omitted, columns are derived from object keys in insertion order.
 */
export function objectsToCsv<T extends Record<string, unknown>>(
  rows: readonly T[],
  headers?: readonly (keyof T & string)[]
): string {
  let columns: string[];
  if (headers && headers.length > 0) {
    columns = [...headers];
  } else {
    const keySet = new Set<string>();
    for (const row of rows) {
      for (const key of Object.keys(row)) {
        keySet.add(key);
      }
    }
    columns = Array.from(keySet);
  }

  if (columns.length === 0) return '';

  const headerLine = columns.map((col) => escapeCsvCell(col)).join(',');
  const dataLines = rows.map((row) =>
    columns.map((col) => escapeCsvCell(row[col])).join(',')
  );
  return [headerLine, ...dataLines].join('\r\n');
}

/**
 * Triggers a client-side file download of CSV content with UTF-8 BOM for Excel compatibility.
 */
export function triggerCsvDownload(filename: string, csvContent: string): void {
  const blob = new Blob([`\uFEFF${csvContent}`], {
    type: 'text/csv;charset=utf-8;',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Converts an array of objects to CSV and immediately downloads the resulting file.
 */
export function downloadObjectsAsCsv<T extends Record<string, unknown>>(
  filename: string,
  rows: readonly T[],
  headers?: readonly (keyof T & string)[]
): void {
  const csv = objectsToCsv(rows, headers);
  if (!csv) return;
  triggerCsvDownload(filename, csv);
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
