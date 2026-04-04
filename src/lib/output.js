/**
 * CLI Output Formatters — table, JSON, and quiet modes.
 */

/**
 * Print data as a formatted table.
 * @param {Object[]} rows - Array of objects
 * @param {string[]} columns - Keys to display (in order)
 * @param {Object} [opts]
 * @param {Object} [opts.headers] - Map of key → display header (defaults to key)
 */
export function printTable(rows, columns, { headers = {} } = {}) {
  if (!rows.length) {
    console.log('(no results)');
    return;
  }

  const displayHeaders = columns.map(c => headers[c] || c.toUpperCase());
  const widths = columns.map((col, i) =>
    Math.max(
      displayHeaders[i].length,
      ...rows.map(r => String(r[col] ?? '').length),
    ),
  );

  const sep = widths.map(w => '─'.repeat(w + 2)).join('┼');
  const headerLine = columns
    .map((_, i) => ` ${displayHeaders[i].padEnd(widths[i])} `)
    .join('│');

  console.log(headerLine);
  console.log(sep);

  for (const row of rows) {
    const line = columns
      .map((col, i) => ` ${String(row[col] ?? '').padEnd(widths[i])} `)
      .join('│');
    console.log(line);
  }
}

/**
 * Print data as JSON (pretty or compact).
 */
export function printJson(data, { compact = false } = {}) {
  console.log(JSON.stringify(data, null, compact ? 0 : 2));
}

/**
 * Choose an output formatter based on --output flag value.
 * @param {'table'|'json'|'json-compact'} format
 * @returns {{ print: Function, printList: Function }}
 */
export function getFormatter(format = 'table') {
  if (format === 'json') {
    return {
      print: (data) => printJson(data),
      printList: (rows) => printJson(rows),
    };
  }
  if (format === 'json-compact') {
    return {
      print: (data) => printJson(data, { compact: true }),
      printList: (rows) => printJson(rows, { compact: true }),
    };
  }
  return {
    print: (data) => {
      for (const [key, value] of Object.entries(data)) {
        console.log(`${key}: ${value}`);
      }
    },
    printList: (rows, columns, opts) => printTable(rows, columns, opts),
  };
}

/**
 * Print an error message to stderr and exit with code 1.
 */
export function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

/**
 * Print a dry-run notice and return true if --dry-run is active.
 * Usage: if (dryRun(opts, 'POST /v1/credentials/revoke', body)) return;
 */
export function dryRun(opts, action, payload) {
  if (!opts.dryRun) return false;
  console.log(`[dry-run] ${action}`);
  if (payload !== undefined) {
    console.log(JSON.stringify(payload, null, 2));
  }
  return true;
}

/**
 * Wrap an async command handler to catch errors and print them.
 */
export function withErrorHandler(fn) {
  return async (...args) => {
    try {
      await fn(...args);
    } catch (err) {
      const msg = err?.response?.error?.user_message || err?.message || String(err);
      fail(msg);
    }
  };
}
