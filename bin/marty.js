#!/usr/bin/env node

// npm distribution adapter only. All CLI behavior lives in the Rust binary.
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const target = `${process.platform}-${process.arch}`;
const packageNames = {
  'darwin-arm64': '@elevenid/marty-cli-darwin-arm64',
  'darwin-x64': '@elevenid/marty-cli-darwin-x64',
  'linux-arm64': '@elevenid/marty-cli-linux-arm64',
  'linux-x64': '@elevenid/marty-cli-linux-x64',
  'win32-arm64': '@elevenid/marty-cli-win32-arm64',
  'win32-x64': '@elevenid/marty-cli-win32-x64',
};

function installedBinary(packageName) {
  if (!packageName) return null;
  try {
    const packagePath = require.resolve(`${packageName}/package.json`);
    return join(dirname(packagePath), 'bin', process.platform === 'win32' ? 'marty.exe' : 'marty');
  } catch {
    return null;
  }
}

function developmentBinary() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const executable = process.platform === 'win32' ? 'marty.exe' : 'marty';
  for (const profile of ['release', 'debug']) {
    const candidate = join(root, 'target', profile, executable);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

const binary = installedBinary(packageNames[target]) || developmentBinary();
if (!binary || !existsSync(binary)) {
  console.error(`error: no Marty native binary is installed for ${target}`);
  process.exit(1);
}

const result = spawnSync(binary, process.argv.slice(2), { stdio: 'inherit' });
if (result.error) {
  console.error(`error: failed to start Marty: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
