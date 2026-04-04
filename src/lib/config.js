/**
 * CLI Configuration — reads ~/.marty/config.json + environment variables.
 *
 * Precedence (highest wins):
 *   1. Environment variables (MARTY_API_URL, MARTY_API_KEY, …)
 *   2. Config file (~/.marty/config.json)
 *   3. Built-in defaults
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const CONFIG_DIR = join(homedir(), '.marty');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
const CREDENTIALS_FILE = join(CONFIG_DIR, 'credentials.json');

const DEFAULTS = {
  apiUrl: 'http://localhost:8000',
  organizationId: null,
};

function ensureConfigDir() {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
}

function readJsonFile(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return {};
  }
}

function writeJsonFile(path, data) {
  ensureConfigDir();
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
}

// ── Public API ──────────────────────────────────────────────────────

export function loadConfig() {
  const file = readJsonFile(CONFIG_FILE);
  return {
    apiUrl: process.env.MARTY_API_URL || file.apiUrl || DEFAULTS.apiUrl,
    organizationId: process.env.MARTY_ORG_ID || file.organizationId || DEFAULTS.organizationId,
  };
}

export function saveConfig(updates) {
  const existing = readJsonFile(CONFIG_FILE);
  writeJsonFile(CONFIG_FILE, { ...existing, ...updates });
}

export function loadCredentials() {
  return readJsonFile(CREDENTIALS_FILE);
}

export function saveCredentials(creds) {
  writeJsonFile(CREDENTIALS_FILE, creds);
}

export function clearCredentials() {
  writeJsonFile(CREDENTIALS_FILE, {});
}

export function getConfigDir() {
  return CONFIG_DIR;
}
