# Marty CLI

Native command-line client for the **Marty Identity Platform**.

## Architecture

The canonical implementation is the Rust workspace:

- `crates/marty-cli` owns command parsing, authentication, configuration,
  output, e2e scenarios, and license validation.
- `crates/marty-api-client` owns MIP headers, request IDs, structured errors,
  GET-only retry policy, and both native and browser/WASM transport bindings.
- `tests/behavior/cli_cases.json` is the implementation-independent command
  contract used to prove behavior across implementation changes.

GitHub releases contain native binaries for Linux, Windows, and macOS on x64
and ARM64. The `@elevenid/marty-cli` npm package remains a supported install
channel; its small `bin/marty.js` adapter only locates and starts the matching
platform binary. It contains no CLI, protocol, authentication, or license logic.

The `packages/api-core` package preserves the established JavaScript factory
surface for browser consumers, but its HTTP behavior is implemented by the
same Rust crate through WebAssembly. Its small adapter contains only method
bindings and the legacy Axios-like `{ data }` response facade.

## Quick start

```bash
# Native development build
cargo build --package marty-cli
cargo run --package marty-cli -- init

# Or after installing a release
marty auth login --api-key <your-key>
marty config set apiUrl http://localhost:8000
marty orgs switch <org-id>
```

## Commands

| Command | Description |
|---------|-------------|
| `marty init` | Interactive setup wizard |
| `marty auth login` | Authenticate with an API key or OAuth2 client credentials |
| `marty auth whoami` | Show current authentication status |
| `marty health` | Check API health |
| `marty orgs` | List, create, inspect, or switch organizations |
| `marty credentials` | List, inspect, issue, verify, or revoke credentials |
| `marty applications` | Run applicant and organization-review workflows |
| `marty verify` | Start, submit, evaluate, and inspect verification sessions |
| `marty flows` | List, create, execute, inspect, and approve flows |
| `marty templates` | List and inspect application templates |
| `marty credential-templates` | Create, inspect, and publish credential templates |
| `marty compliance` | Manage compliance profiles |
| `marty trust` | Manage trust profiles |
| `marty license` | Activate, inspect, validate, and install licenses |
| `marty test e2e` | Run headless platform scenarios |
| `marty completion` | Generate Bash, Zsh, or Fish completions |

Aliases from the previous CLI remain available: `apps`, `creds`, and `ct`.

## Authentication

```bash
marty auth login --api-key <key>
marty auth login --client-id <id> --client-secret <secret>
marty auth login # guided interactive login
```

`MARTY_API_KEY` overrides stored credentials. OAuth2 bearer tokens, API keys,
and integration-test session cookies remain supported in the native client.

## Output and dry runs

Commands support table, pretty JSON, and compact JSON output. Mutation commands
support `--dry-run` and print the exact HTTP action and JSON payload without
making a request.

```bash
marty --global-output json orgs list
marty credentials issue \
  --credential-template-id <id> \
  --flow-execution-id <id> \
  --subject-claims '{"given_name":"Ada"}' \
  --dry-run
```

## End-to-end scenarios

```bash
# Health, applicant issuance, verification, and wallet interoperability
marty test e2e \
  --application-template <id> \
  --credential-template <id> \
  --policy <id>

marty test e2e --scenario health
marty test e2e --scenario full --dry-run
```

## Self-host license install

`marty license install-selfhost` validates an issuer-signed Ed25519 JWT against
the issuer, plan-tier, activation, expiry, and entitled-product policy before
writing only the token to `SELFHOST_SECRET_DIR/license_key`. It does not mint a
license or install a caller-supplied trust key in production.

```bash
cat /path/to/customer-license.jwt | marty license install-selfhost \
  --env-file /path/to/.env.selfhost.production.local \
  --token-stdin
```

The public-key override options are retained for development and behavioral
testing only.

## Configuration

Configuration is stored at `~/.marty/config.json`; credentials are stored at
`~/.marty/credentials.json` with private file permissions where supported.

| Variable | Description |
|----------|-------------|
| `MARTY_API_URL` | Override the API base URL |
| `MARTY_ORG_ID` | Override the active organization ID |
| `MARTY_API_KEY` | Override the stored API key |
| `MARTY_CONFIG_DIR` | Override the configuration directory for isolated automation |

## Development

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace --locked
cargo build --workspace --release --locked

# Build and test the Rust/WASM browser compatibility package
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.127 --locked
npm run build:wasm
npm ci
npm test
```

The native test suite covers the public command vectors, authenticated HTTP
workflows, configuration and credential persistence, structured MIP errors,
GET-only retries, browser/WASM compatibility, all supported license tiers, and
fail-closed invalid inputs.
