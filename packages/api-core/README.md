# @elevenid/marty-api-core

Rust/WebAssembly HTTP client for the **Marty Identity Platform**, exposed
through the existing framework-agnostic JavaScript factory.

The canonical implementation lives in `crates/marty-api-client`; the package
adapter contains only bindings and the legacy Axios-like response facade.

Provides `createApiClient()` with:
- Exponential-backoff retry for GET requests
- Structured error parsing (MIP error envelope)
- Request-ID generation
- Marty Protocol 0.5 version negotiation on every request
- Helper utilities: `getErrorMessage`, `getErrorCode`, `isAuthError`, `isRetryableError`, `handleApiError`

## Usage

The package is available as a release tarball, not through the npm registry.
For a pinned v0.3.3 consumer install, download and verify
[`elevenid-marty-api-core-0.3.3.tgz`](https://github.com/ElevenID/marty-cli/releases/download/v0.3.3/elevenid-marty-api-core-0.3.3.tgz)
against the release's
[`SHA256SUMS`](https://github.com/ElevenID/marty-cli/releases/download/v0.3.3/SHA256SUMS),
then install the local file with `npm install ./elevenid-marty-api-core-0.3.3.tgz`.
The package name in imports remains `@elevenid/marty-api-core`.

Version v0.3.3 retains the established HTTP and JavaScript factory
behavior and MIP `0.5.0` header. The family version also covers the native CLI's
new API-key commands; it is separate from the server API version. A version is
installable only after its release artifacts and checksums are published. npm
registry publishing is optional; GitHub release tarballs are the documented
install channel.

This source prepares **v0.3.4** with public TypeScript declarations. Use its
tarball only after that version is published and verified; v0.3.3 above remains
the existing JavaScript release. The package version and MIP `0.5.0` protocol
version are separate.

Browser with an existing authenticated session:

```js
import { createApiClient } from '@elevenid/marty-api-core';

const api = createApiClient({
  baseUrl: 'https://api.marty.example.com',
  requestOptions: () => ({ credentials: 'include' }),
});
const orgs = await api.get('/v1/organizations');
```

Node 24+ with an already provisioned organization API key:

```js
import { createApiClient } from '@elevenid/marty-api-core';
const key = process.env.MARTY_API_KEY;
if (!key) throw new Error('MARTY_API_KEY is required');
const api = createApiClient({
  baseUrl: process.env.MARTY_API_URL ?? 'https://api.marty.example.com',
  requestOptions: () => ({ headers: { 'X-API-Key': key } }),
});
const orgs = await api.get('/v1/organizations');
```

## TypeScript transport contract (v0.3.4)

After verifying and installing the v0.3.4 tarball, a Node ESM project can use
TypeScript and Node 24 type definitions. The compiler gate uses these versions:

```sh
npm install ./elevenid-marty-api-core-0.3.4.tgz
npm install --save-dev typescript@7.0.2 @types/node@24.19.2
```

Set `"type": "module"` in your project's `package.json`. A Node-only
`tsconfig.json` needs no DOM library or UI declarations:

```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "NodeNext", "moduleResolution": "NodeNext",
    "lib": ["ES2022"], "types": ["node"], "strict": true, "noEmit": true
  }
}
```

```typescript
import { createApiClient, getErrorMessage, type MartyClient } from '@elevenid/marty-api-core';

export async function listOrganizations(baseUrl: string, apiKey: string): Promise<unknown> {
  const api: MartyClient = createApiClient({
    baseUrl,
    requestOptions: () => ({ headers: { 'X-API-Key': apiKey } }),
  });
  try {
    return await api.get('/v1/organizations');
  } catch (error: unknown) {
    throw new Error(getErrorMessage(error));
  }
}
```

Run `npx tsc --noEmit`. Browser/bundler projects can instead use `moduleResolution:
"Bundler"`, `module: "ESNext"`, and the `ES2022`, `DOM`, and `DOM.Iterable` libraries.
The same public declarations support both configurations.

JSON response types default to `unknown`; supplying `get<T>()` asserts a shape
without validating the server response. Validate application data against the
server's documented endpoint schema. Successful non-JSON responses return `null`;
the typed result is `T | null`. The compatibility facade returns only
`{ data: T | null }`, without Axios status or header fields. Caught failures can be
network errors or normalized HTTP errors; error helpers accept `unknown`.

Use a synchronous defaults callback and mutable plain string-valued header
objects. `Headers` instances and header tuples are not supported by the current
object-entry adapter. JSON request helpers can add `Content-Type` to a supplied
header object. Query parameters are plain scalar-valued objects. Retry policy
configuration is the third argument of `fetchWithRetry`; only GET retries.
These declarations describe the transport API, not a complete set of endpoint
DTOs or runtime schema validation.

## Consumers

| Project | Auth Strategy | Install |
|---------|--------------|---------|
| `marty-ui` | Cookie (`credentials: 'include'`) | Verified GitHub release tarball above |
| `marty-integration-tests` | Session cookie / organization API key | Verified GitHub release tarball above |

## Building from source

```bash
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.127 --locked
npm run build:wasm
npm test
# After packing a local SDK archive, check isolated Node/browser type consumers:
node scripts/check-packed-api-types.mjs path/to/elevenid-marty-api-core-0.3.4.tgz
```
