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
For a pinned v0.3.1 consumer install, download and verify
[`elevenid-marty-api-core-0.3.1.tgz`](https://github.com/ElevenID/marty-cli/releases/download/v0.3.1/elevenid-marty-api-core-0.3.1.tgz)
against the release's
[`SHA256SUMS`](https://github.com/ElevenID/marty-cli/releases/download/v0.3.1/SHA256SUMS),
then install the local file with `npm install ./elevenid-marty-api-core-0.3.1.tgz`.
The package name in imports remains `@elevenid/marty-api-core`.

Version v0.3.1 retains the established HTTP and JavaScript factory
behavior and MIP `0.5.0` header. The family version also covers the native CLI's
new API-key commands; it is separate from the server API version. A version is
installable only after its release artifacts and checksums are published. npm
registry publishing is optional; GitHub release tarballs are the documented
install channel.

```js
import { MIP_VERSION, createApiClient, getErrorMessage } from '@elevenid/marty-api-core';

// Browser (cookie auth)
const api = createApiClient({
  baseUrl: 'https://api.marty.example.com',
  requestOptions: () => ({ credentials: 'include' }),
});

// JavaScript integration test or server runtime (API key auth)
const api = createApiClient({
  baseUrl: 'https://api.marty.example.com',
  requestOptions: () => ({ headers: { 'X-API-Key': process.env.MARTY_API_KEY } }),
});

const orgs = await api.get('/v1/organizations');
```

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
```
