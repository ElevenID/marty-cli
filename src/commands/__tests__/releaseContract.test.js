import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const rootPackagePath = fileURLToPath(
  new URL('../../../package.json', import.meta.url),
);
const apiCorePackagePath = fileURLToPath(
  new URL('../../../packages/api-core/package.json', import.meta.url),
);

describe('release package contract', () => {
  it('couples the CLI to the API Core version released from this monorepo', () => {
    const cli = JSON.parse(readFileSync(rootPackagePath, 'utf8'));
    const apiCore = JSON.parse(readFileSync(apiCorePackagePath, 'utf8'));

    expect(cli.version).toBe(apiCore.version);
    expect(cli.dependencies['@elevenid/marty-api-core']).toBe(apiCore.version);
  });
});
