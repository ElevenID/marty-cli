# @elevenid/marty-api-core

Shared HTTP client factory for the **Marty Identity Platform**.

Provides `createApiClient()` — a framework-agnostic HTTP factory with:
- Exponential-backoff retry for GET requests
- Structured error parsing (MIP error envelope)
- Request-ID generation
- Helper utilities: `getErrorMessage`, `getErrorCode`, `isAuthError`, `isRetryableError`, `handleApiError`

## Usage

```js
import { createApiClient, getErrorMessage } from '@elevenid/marty-api-core';

// Browser (cookie auth)
const api = createApiClient({
  baseUrl: 'https://api.marty.example.com',
  requestOptions: () => ({ credentials: 'include' }),
});

// Node.js / CLI (API key auth)
const api = createApiClient({
  baseUrl: 'https://api.marty.example.com',
  requestOptions: () => ({ headers: { 'X-API-Key': process.env.MARTY_API_KEY } }),
});

const orgs = await api.get('/v1/organizations');
```

## Consumers

| Project | Auth Strategy | Install |
|---------|--------------|---------|
| `marty-ui` | Cookie (`credentials: 'include'`) | `npm install @elevenid/marty-api-core` |
| `marty-cli` | API key / Bearer token | workspace dependency |
| `marty-integration-tests` | Session cookie / Bearer | `npm install @elevenid/marty-api-core` |
