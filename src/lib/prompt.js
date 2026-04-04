/**
 * Lightweight interactive prompts using Node.js readline.
 * No external dependencies — works with Node 18+.
 */

import { createInterface } from 'node:readline';

function createRl() {
  return createInterface({ input: process.stdin, output: process.stderr });
}

/**
 * Ask a single question. Returns the trimmed answer.
 */
export async function ask(question, { defaultValue, secret = false } = {}) {
  const rl = createRl();
  const suffix = defaultValue ? ` [${defaultValue}]` : '';

  // For secret input, mute output
  if (secret) {
    process.stderr.write(`${question}${suffix}: `);
    rl.output = null;
    // Hide characters as they're typed
    process.stdin.on('data', () => {}); // consume
  }

  try {
    const answer = await new Promise((resolve) => {
      rl.question(`${question}${suffix}: `, resolve);
    });
    if (secret) process.stderr.write('\n');
    return answer.trim() || defaultValue || '';
  } finally {
    rl.close();
  }
}

/**
 * Ask a yes/no question. Returns true/false.
 */
export async function confirm(question, { defaultValue = false } = {}) {
  const hint = defaultValue ? '[Y/n]' : '[y/N]';
  const answer = await ask(`${question} ${hint}`);
  if (!answer) return defaultValue;
  return ['y', 'yes'].includes(answer.toLowerCase());
}

/**
 * Show a numbered list and ask the user to pick one.
 * Returns the selected item from choices array.
 */
export async function select(question, choices, { display } = {}) {
  process.stderr.write(`${question}\n`);
  choices.forEach((c, i) => {
    const label = display ? display(c) : String(c);
    process.stderr.write(`  ${i + 1}) ${label}\n`);
  });
  const answer = await ask('Choose');
  const idx = parseInt(answer, 10) - 1;
  if (idx < 0 || idx >= choices.length) {
    throw new Error(`Invalid selection: ${answer}`);
  }
  return choices[idx];
}

/**
 * Returns true if stdin is a TTY (interactive terminal).
 */
export function isInteractive() {
  return Boolean(process.stdin.isTTY);
}
