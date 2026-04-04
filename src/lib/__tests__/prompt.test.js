/**
 * Tests for cli/lib/prompt.js
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We test isInteractive and the logic structure;
// actual readline interactions need a real TTY, so we test the branching.

describe('prompt utilities', () => {
  let prompt;

  beforeEach(async () => {
    prompt = await import('../prompt.js');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('isInteractive returns false when stdin.isTTY is falsy', () => {
    const orig = process.stdin.isTTY;
    process.stdin.isTTY = undefined;
    expect(prompt.isInteractive()).toBe(false);
    process.stdin.isTTY = orig;
  });

  it('isInteractive returns true when stdin.isTTY is true', () => {
    const orig = process.stdin.isTTY;
    process.stdin.isTTY = true;
    expect(prompt.isInteractive()).toBe(true);
    process.stdin.isTTY = orig;
  });
});
