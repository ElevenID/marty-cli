import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync,
  realpathSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const archive = resolve(process.argv[2] ?? '');
assert.ok(process.argv[2] && lstatSync(archive).isFile(), 'Provide the packed SDK archive');
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const compiler = join(root, 'node_modules/typescript/bin/tsc');
const nodeTypes = manifest.devDependencies['@types/node'];
assert.match(nodeTypes, /^24\.\d+\.\d+$/, 'Node type tooling must be exactly pinned to major 24');
const parent = realpathSync(tmpdir());
const temporary = mkdtempSync(join(parent, 'marty-sdk-types-'));
const owner = randomUUID();
writeFileSync(join(temporary, '.owner'), owner, { flag: 'wx' });
writeFileSync(join(temporary, '.npmrc'), '', { flag: 'wx' });
let installer = 'npm';
let installerPrefix = [];
if (process.platform === 'win32') {
  const candidates = [process.env.npm_execpath];
  const shims = execFileSync('where.exe', ['npm.cmd'], { encoding: 'utf8' }).trim().split(/\r?\n/);
  candidates.push(...shims.map(shim => join(dirname(shim), 'node_modules/npm/bin/npm-cli.js')));
  const npmCli = candidates.find(path => path && basename(path) === 'npm-cli.js' && existsSync(path));
  assert.ok(npmCli, 'Resolve npm CLI JavaScript without passing archive paths through a shell');
  installer = process.execPath;
  installerPrefix = [npmCli];
}

try {
  for (const mode of ['node', 'browser']) {
    const project = join(temporary, mode);
    mkdirSync(project);
    writeFileSync(join(project, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
    // Only the published-shape tarball and public type tooling enter this fresh
    // project. There are no workspace aliases, UI declarations or linked sources.
    const args = ['install', '--prefix', project, '--ignore-scripts', '--no-audit', '--no-fund',
      '--registry=https://registry.npmjs.org', '--userconfig', join(temporary, '.npmrc'), archive];
    if (mode === 'node') args.push(`@types/node@${nodeTypes}`);
    execFileSync(installer, [...installerPrefix, ...args], { stdio: 'pipe', timeout: 120_000 });
    copyFileSync(join(root, 'scripts/fixtures/sdk-types-consumer.ts'), join(project, 'consumer.ts'));
    const readme = readFileSync(join(project, 'node_modules/@elevenid/marty-api-core/README.md'), 'utf8');
    const examples = [...readme.matchAll(/```typescript\r?\n([\s\S]*?)```/g)];
    assert.equal(examples.length, 1, 'Compile the documented public TypeScript example');
    writeFileSync(join(project, 'documented-example.ts'), examples[0][1]);
    const config = {
      compilerOptions: {
        target: 'ES2022', module: mode === 'node' ? 'NodeNext' : 'ESNext',
        moduleResolution: mode === 'node' ? 'NodeNext' : 'Bundler',
        lib: mode === 'node' ? ['ES2022'] : ['ES2022', 'DOM', 'DOM.Iterable'],
        types: mode === 'node' ? ['node'] : [], strict: true,
        exactOptionalPropertyTypes: true, skipLibCheck: false, noEmit: true,
        verbatimModuleSyntax: true,
      },
      files: ['consumer.ts', 'documented-example.ts'],
    };
    writeFileSync(join(project, 'tsconfig.json'), JSON.stringify(config, null, 2));
    const output = execFileSync(process.execPath, [compiler, '--project', join(project, 'tsconfig.json'), '--listFiles'],
      { encoding: 'utf8', timeout: 120_000 });
    const declaration = realpathSync(join(project, 'node_modules/@elevenid/marty-api-core/src/index.d.ts'));
    const normalize = value => value.replaceAll('\\', '/').toLowerCase();
    assert.ok(output.split(/\r?\n/).some(line => normalize(line) === normalize(declaration)),
      'Compiler must resolve the installed public package declaration');
    console.log(`Packed SDK strict ${mode} types, null/unknown results and negative API contracts passed`);
  }
} finally {
  assert.equal(lstatSync(temporary).isSymbolicLink(), false);
  const owned = realpathSync(temporary);
  assert.equal(dirname(owned), parent);
  assert.ok(basename(owned).startsWith('marty-sdk-types-'));
  assert.equal(readFileSync(join(owned, '.owner'), 'utf8'), owner);
  rmSync(owned, { recursive: true });
}
