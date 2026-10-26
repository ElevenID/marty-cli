import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [installation, expectedVersion] = process.argv.slice(2);
assert.ok(installation && expectedVersion, 'Provide the installed package root and expected version');
const deadline = setTimeout(() => {
  console.error('Packed SDK HTTP contract timed out');
  process.exit(1);
}, 30_000);
deadline.unref();
const requireInstalled = createRequire(resolve(installation, 'package.json'));
const entry = requireInstalled.resolve('@elevenid/marty-api-core');
const manifest = JSON.parse(await readFile(resolve(dirname(entry), '..', 'package.json'), 'utf8'));
assert.equal(manifest.version, expectedVersion);
const { createApiClient, MIP_VERSION } = await import(pathToFileURL(entry).href);
assert.equal(MIP_VERSION, '0.5.0');

const requests = [];
const server = createServer((request, response) => {
  requests.push({
    path: request.url,
    method: request.method,
    key: request.headers['x-api-key'],
    protocol: request.headers['x-mip-version'],
    cookie: request.headers.cookie,
  });
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify([{ id: 'packaged-client-fixture' }]));
});

await new Promise((accept, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', accept);
});
try {
  const client = createApiClient({
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    requestOptions: () => ({ headers: { 'X-API-Key': 'mk_test_packaged-fixture' } }),
  });
  const result = await client.get('/v1/organizations');
  assert.deepEqual(result, [{ id: 'packaged-client-fixture' }]);
  const wrapped = await client.apiClient.get('/v1/organizations');
  assert.deepEqual(wrapped.data, result);
  const expectedRequest = {
    path: '/v1/organizations', method: 'GET', key: 'mk_test_packaged-fixture',
    protocol: '0.5.0', cookie: undefined,
  };
  assert.deepEqual(requests, [expectedRequest, expectedRequest]);
  console.log('Packed SDK version, WASM import and HTTP header contract passed');
} finally {
  clearTimeout(deadline);
  server.closeAllConnections();
  await new Promise((accept, reject) => server.close(error => error ? reject(error) : accept()));
}
