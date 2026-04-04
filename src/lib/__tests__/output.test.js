/**
 * Tests for cli/lib/output.js
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('output', () => {
  let logSpy;
  let errSpy;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
  });

  it('should print table with headers and rows', async () => {
    const { printTable } = await import('../output.js');
    printTable(
      [{ name: 'Alice', role: 'admin' }, { name: 'Bob', role: 'user' }],
      ['name', 'role'],
    );
    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('NAME');
    expect(output).toContain('ROLE');
    expect(output).toContain('Alice');
    expect(output).toContain('Bob');
  });

  it('should print "(no results)" for empty table', async () => {
    const { printTable } = await import('../output.js');
    printTable([], ['name']);
    expect(logSpy).toHaveBeenCalledWith('(no results)');
  });

  it('should print JSON', async () => {
    const { printJson } = await import('../output.js');
    printJson({ foo: 'bar' });
    const output = logSpy.mock.calls[0][0];
    expect(JSON.parse(output)).toEqual({ foo: 'bar' });
  });

  it('should print compact JSON', async () => {
    const { printJson } = await import('../output.js');
    printJson({ foo: 'bar' }, { compact: true });
    const output = logSpy.mock.calls[0][0];
    expect(output).toBe('{"foo":"bar"}');
  });

  it('getFormatter(json) should return JSON printer', async () => {
    const { getFormatter } = await import('../output.js');
    const fmt = getFormatter('json');
    fmt.print({ a: 1 });
    const output = logSpy.mock.calls[0][0];
    expect(JSON.parse(output)).toEqual({ a: 1 });
  });

  it('getFormatter(table) should print key:value for single objects', async () => {
    const { getFormatter } = await import('../output.js');
    const fmt = getFormatter('table');
    fmt.print({ name: 'Test', status: 'ok' });
    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('name: Test');
    expect(output).toContain('status: ok');
  });

  it('withErrorHandler should catch and format errors', async () => {
    const { withErrorHandler } = await import('../output.js');
    const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit');
    });

    const handler = withErrorHandler(async () => {
      const err = new Error('Something broke');
      err.response = { error: { user_message: 'Friendly error message' } };
      throw err;
    });

    await expect(handler()).rejects.toThrow('exit');
    expect(errSpy).toHaveBeenCalledWith('error: Friendly error message');
    mockExit.mockRestore();
  });

  // ── dryRun tests ─────────────────────────────────────────────────

  it('dryRun returns false when flag is absent', async () => {
    const { dryRun } = await import('../output.js');
    expect(dryRun({}, 'POST /v1/foo')).toBe(false);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('dryRun returns true and prints action when flag is set', async () => {
    const { dryRun } = await import('../output.js');
    const result = dryRun({ dryRun: true }, 'POST /v1/foo', { bar: 1 });
    expect(result).toBe(true);
    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('[dry-run] POST /v1/foo');
    expect(output).toContain('"bar": 1');
  });

  it('dryRun without payload only prints action line', async () => {
    const { dryRun } = await import('../output.js');
    dryRun({ dryRun: true }, 'DELETE /v1/thing');
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0]).toBe('[dry-run] DELETE /v1/thing');
  });
});
