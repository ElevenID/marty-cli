# @elevenid/marty-api-core

Rust/WebAssembly HTTP client for the **Marty Identity Platform**, exposed
through the existing framework-agnostic JavaScript factory.

The canonical implementation lives in `crates/marty-api-client`; the package
adapter contains only bindings and the legacy Axios-like response facade.

Provides `createApiClient()` with:
- Exponential-backoff retry for GET requests
- Structured error parsing (MIP error envelope)
- Request-ID generation
- Marty Protocol 0.4 version negotiation on every request
- Helper utilities: `getErrorMessage`, `getErrorCode`, `isAuthError`, `isRetryableError`, `handleApiError`

## Usage

The package is available as a release tarball, not through the npm registry.
For a pinned consumer install, download and verify
[`elevenid-marty-api-core-0.2.7.tgz`](https://github.com/ElevenID/marty-cli/releases/download/v0.2.7/elevenid-marty-api-core-0.2.7.tgz)
against the release's
[`SHA256SUMS`](https://github.com/ElevenID/marty-cli/releases/download/v0.2.7/SHA256SUMS),
then install the local file with `npm install ./elevenid-marty-api-core-0.2.7.tgz`.
The package name in imports remains `@elevenid/marty-api-core`.

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
| `marty-integration-tests` | Session cookie / Bearer | Verified GitHub release tarball above |

## Building from source

```bash
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.127 --locked
npm run build:wasm
npm test
```
