# Marty CLI

Command-line client for the **Marty Identity Platform**.

## Architecture

```
marty-cli/
├── packages/
│   └── api-core/              ← @elevenid/marty-api-core (shared HTTP factory)
│       ├── src/index.js       ← createApiClient, error helpers
│       └── __tests__/
├── bin/
│   └── marty.js               ← CLI entry point
├── src/
│   ├── lib/                   ← CLI-specific: auth, config, output, prompt
│   │   ├── apiAdapter.js      ← Wraps api-core with API-key / Bearer auth
│   │   ├── auth.js
│   │   ├── config.js
│   │   ├── output.js
│   │   └── prompt.js
│   └── commands/              ← Command groups (12 modules)
│       ├── auth.js
│       ├── health.js
│       ├── orgs.js
│       ├── credentials.js
│       ├── applications.js
│       ├── verify.js
│       ├── flows.js
│       ├── templates.js
│       ├── config.js
│       ├── teste2e.js
│       ├── init.js
│       └── completion.js
└── vitest.config.js
```

### Shared Layer: `@elevenid/marty-api-core`

The `packages/api-core/` package provides a framework-agnostic HTTP client factory
(`createApiClient`) used by both this CLI and the browser UI (`marty-ui`).
It handles retry logic, error parsing, and request-ID generation with zero
platform-specific dependencies.

This package is the **separation layer** between consumers:

| Consumer | Auth Strategy | URL Source |
|----------|--------------|------------|
| `marty-cli` | API key / Bearer token | `~/.marty/config.json` |
| `marty-ui` | Cookie (`credentials: 'include'`) | `VITE_API_URL` |
| `marty-integration-tests` | Session cookie / Bearer | env vars |

## Quick Start

```bash
# Install dependencies (workspace-aware)
npm install

# First-time interactive setup
node bin/marty.js init

# Or configure manually
node bin/marty.js auth login --api-key <your-key>
node bin/marty.js config set apiUrl http://localhost:8000
node bin/marty.js orgs switch <org-id>
```

## Commands

| Command | Description |
|---------|-------------|
| `marty init` | Interactive first-time setup wizard |
| `marty auth login` | Authenticate (API key or OAuth2 client credentials) |
| `marty auth whoami` | Show current authentication status |
| `marty health` | Check API health |
| `marty orgs list` | List organizations |
| `marty credentials list` | List issued credentials |
| `marty applications list` | List credential applications |
| `marty applications apply` | Apply for a credential (interactive template picker) |
| `marty verify start` | Start a verification session (interactive policy picker) |
| `marty verify status <id>` | Check session status |
| `marty license install-selfhost` | Validate an issuer-signed self-host license and write it into `SELFHOST_SECRET_DIR` |
| `marty templates list` | List credential templates |
| `marty flows list` | List configured flows |
| `marty test e2e` | Run end-to-end integration tests |
| `marty completion bash` | Generate shell completions |

## Global Options

```
-o, --output <format>  Output format: table, json, json-compact
--help                 Show help for any command
--version              Show version
```

## Authentication

**API Key** (simplest):
```bash
marty auth login --api-key <key>
```

**OAuth2 Client Credentials**:
```bash
marty auth login --client-id <id> --client-secret <secret>
```

**Interactive** (guided):
```bash
marty auth login
```

## Dry Run

Mutation commands support `--dry-run` to preview without executing:

```bash
marty applications apply <config-id> --dry-run
marty credentials revoke <id> --dry-run
marty verify start --policy <id> --dry-run
```

## Shell Completions

```bash
# Bash — add to ~/.bashrc
eval "$(marty completion bash)"

# Zsh — add to ~/.zshrc
eval "$(marty completion zsh)"

# Fish
marty completion fish | source
```

## E2E Testing

```bash
# Full scenario (health + issuance + verification + wallet-interop)
marty test e2e --credential-config <id> --policy <id>

# Health check only
marty test e2e --scenario health

# Dry run (no API calls)
marty test e2e --dry-run
```

## Self-Host License Install

`marty license install-selfhost` does not mint a production license. It validates an issuer-signed Ed25519 JWT against the same issuer, plan-tier, and entitled-product policy that the self-host runtime enforces, then writes the token and public key into `SELFHOST_SECRET_DIR/license_key` and `SELFHOST_SECRET_DIR/license_public_key`.

To avoid echoing the token into shell history or terminal output, pipe the JWT on stdin and pass the public key as a file:

```bash
cat /path/to/customer-license.jwt | marty license install-selfhost \
   --env-file /path/to/.env.selfhost.production.local \
   --token-stdin \
   --public-key-file /path/to/license-public-key.pem
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `MARTY_API_URL` | Override API base URL |
| `MARTY_ORG_ID` | Override active organization ID |
| `MARTY_API_KEY` | Override API key (skips stored credentials) |

## Configuration

Config is stored at `~/.marty/config.json`, credentials at `~/.marty/credentials.json` (mode 0600).

```bash
marty config show          # Display current config
marty config set apiUrl http://myserver:8000
```

## Development

```bash
# Run all tests (CLI + api-core)
npm test

# Watch mode
npm run test:watch

# Run just the CLI
node bin/marty.js --help
```

## Migration from marty-ui

This repo was extracted from `marty-ui/cli/`. The key changes:

1. **`apiCore.js` → `@elevenid/marty-api-core`**: The shared HTTP factory is now a proper
   npm workspace package instead of a cross-directory import.
2. **`apiAdapter.js`**: Now imports from `@elevenid/marty-api-core` instead of
   `../../ui/src/services/apiCore.js`.
3. **File structure**: `cli/commands/` → `src/commands/`, `cli/lib/` → `src/lib/`.
4. **`marty-ui`** should be updated to depend on `@elevenid/marty-api-core` instead of
   its local `apiCore.js` (see the api-core README for integration instructions).
