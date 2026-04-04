/**
 * Tests exposing output.js edge cases.
 *
 * Issue 3.1: getFormatter('table').print() throws on null/undefined/array/number input
 * Issue 3.2: withErrorHandler produces "error: null" for non-Error throws
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('output edge cases', () => {
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

  // ── Issue 3.1: table formatter crashes on non-object input ────────

  describe('table formatter with non-object input', () => {
    it('BUG: table print throws TypeError on null input', async () => {
      const { getFormatter } = await import('../output.js');
      const fmt = getFormatter('table');

      // Object.entries(null) → TypeError
      expect(() => fmt.print(null)).toThrow(TypeError);
    });

    it('BUG: table print throws TypeError on undefined input', async () => {
      const { getFormatter } = await import('../output.js');
      const fmt = getFormatter('table');

      // Object.entries(undefined) → TypeError
      expect(() => fmt.print(undefined)).toThrow(TypeError);
    });

    it('BUG: table print iterates array indices instead of properties', async () => {
      const { getFormatter } = await import('../output.js');
      const fmt = getFormatter('table');

      // Object.entries([1, 2, 3]) → [["0", 1], ["1", 2], ["2", 3]]
      fmt.print([1, 2, 3]);
      const output = logSpy.mock.calls.map(c => c[0]).join('\n');

      // Prints "0: 1", "1: 2", "2: 3" — not meaningful for CLI users
      expect(output).toContain('0: 1');
      expect(output).toContain('1: 2');
    });

    it('BUG: table print produces empty output for number input', async () => {
      const { getFormatter } = await import('../output.js');
      const fmt = getFormatter('table');

      // Object.entries(42) → [] — no output
      fmt.print(42);
      expect(logSpy).not.toHaveBeenCalled();
    });

    it('BUG: table print iterates string char positions', async () => {
      const { getFormatter } = await import('../output.js');
      const fmt = getFormatter('table');

      // Object.entries("hello") → [["0","h"], ["1","e"], ...]
      fmt.print('hello');
      const output = logSpy.mock.calls.map(c => c[0]).join('\n');
      expect(output).toContain('0: h');
    });
  });

  // ── Issue 3.2: withErrorHandler with non-Error values ─────────────

  describe('withErrorHandler with non-Error throws', () => {
    it('BUG: thrown null produces "error: null"', async () => {
      const { withErrorHandler } = await import('../output.js');
      const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('exit');
      });

      const handler = withErrorHandler(async () => {
        throw null;
      });

      await expect(handler()).rejects.toThrow('exit');
      // String(null) = "null" — not a useful error message
      expect(errSpy).toHaveBeenCalledWith('error: null');

      mockExit.mockRestore();
    });

    it('BUG: thrown undefined produces "error: undefined"', async () => {
      const { withErrorHandler } = await import('../output.js');
      const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('exit');
      });

      const handler = withErrorHandler(async () => {
        throw undefined;
      });

      await expect(handler()).rejects.toThrow('exit');
      expect(errSpy).toHaveBeenCalledWith('error: undefined');

      mockExit.mockRestore();
    });

    it('thrown string is used as error message', async () => {
      const { withErrorHandler } = await import('../output.js');
      const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('exit');
      });

      const handler = withErrorHandler(async () => {
        throw 'something went wrong';
      });

      await expect(handler()).rejects.toThrow('exit');
      // String("something went wrong") = "something went wrong"
      expect(errSpy).toHaveBeenCalledWith('error: something went wrong');

      mockExit.mockRestore();
    });

    it('thrown number produces "error: <number>"', async () => {
      const { withErrorHandler } = await import('../output.js');
      const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('exit');
      });

      const handler = withErrorHandler(async () => {
        throw 404;
      });

      await expect(handler()).rejects.toThrow('exit');
      expect(errSpy).toHaveBeenCalledWith('error: 404');

      mockExit.mockRestore();
    });
  });
});
