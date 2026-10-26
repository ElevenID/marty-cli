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
and ARM64. Download the binary for your platform from the
[v0.2.7 release](https://github.com/ElevenID/marty-cli/releases/tag/v0.2.7)
and verify it against the release's `SHA256SUMS` before running it. The
`@elevenid/marty-cli` npm launcher is built and attached to that release, but
is not currently published to npm. Its `bin/marty.js` adapter only locates and
starts the matching platform binary; it contains no CLI, protocol,
authentication, or license logic. The release tarball alone cannot install the
launcher because its platform packages are likewise absent from npm.

The `packages/api-core` package preserves the established JavaScript factory
surface for browser consumers, but its HTTP behavior is implemented by the
same Rust crate through WebAssembly. Its small adapter contains only method
bindings and the legacy Axios-like `{ data }` response facade. Install the
published GitHub release tarball as described in
[its package README](packages/api-core/README.md); the npm registry name is
not currently available.

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
| `marty api-keys` | List, create, and revoke organization API keys (first ships in v0.3.1) |
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

### API-key lifecycle (v0.3.2)

These commands are available in v0.3.1 and later; v0.2.7 does not include them.
The v0.3.0 tag remains a failed release attempt. v0.3.2 corrects the SDK SBOM
identity and adds Rust inventories for each native target and browser WASM;
use its downloads only after that release is published and attested. They call the
existing public gateway API and require an already provisioned operator
credential. An organization-bound `admin:full` key may manage keys within its
own organization; ordinary credential scopes cannot manage keys. Initial
operator/tenant bootstrap remains a separate installation step.

With the operator key supplied privately in `MARTY_API_KEY`:

```bash
marty api-keys list --organization-id <org-id>
marty api-keys create --organization-id <org-id> \
  --name credential-reader --scope credentials:read \
  --expires-at 2027-01-01T00:00:00Z
marty api-keys revoke <key-id> --organization-id <org-id>
```

Creation requires explicit `--scope` flags; repeat the flag or use comma-separated
scopes. The new secret appears once in the JSON output's `key` field. Capture it
privately rather than into shared build logs. The command does not save the new
key as the operator's login. `--is-test` creates a test-prefixed key without
selecting a sandbox server. Organization selection defaults to the active
organization; an explicit override does not change saved configuration.

Create and revoke support `--dry-run`. List supports `--limit` (0 through 500)
and `--offset`. All three commands default to JSON and honor `--global-output`.

The current Marty gateway accepts organization API keys as machine credentials.
Obtaining an OAuth client-credentials token with this CLI does not establish
that the configured gateway accepts that token; generic OAuth bearer validation
is not currently supported by the Marty gateway.

### General output

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

## Release inventories

Starting with v0.3.2, the release publishes these CycloneDX inventories alongside
its packages and binaries. SHA256SUMS and the release attestation cover each file.
The npm registry remains an optional channel; these files accompany the GitHub
release downloads.

| Inventory | Scope |
| --- | --- |
| `marty-cli-sbom.cdx.json` | npm launcher and its six optional platform packages |
| `marty-api-core-sbom.cdx.json` | npm browser SDK, linked to its WASM Rust inventory |
| `marty-cli-<platform>-npm-sbom.cdx.json` | One native npm package, linked to its Rust inventory |
| `marty-cli-<platform>-rust-sbom.cdx.json` | Resolved production Rust graph for that native target |
| `marty-api-client-wasm-rust-sbom.cdx.json` | Resolved production Rust graph for `wasm32-unknown-unknown` |

The producer uses pinned [cargo-cyclonedx 0.5.9](https://github.com/CycloneDX/cyclonedx-rust-cargo/blob/cargo-cyclonedx-0.5.9/cargo-cyclonedx/README.md).
Each native build runner generates its Rust inventory alongside its binary; the
WASM packaging runner generates the browser inventory. The producer checks the
component metadata and registry checksums against Cargo metadata and the unchanged
lockfile, then uses each package's normal/build Cargo tree for the production
components and edges. This excludes development/workspace feature extras. The
recorded build host also binds the build-dependency context. The npm roots must identify their actual package and
version. OS libraries, remote services and KMS deployments have separate inventories.

v0.3.1's SDK SBOM incorrectly identifies the CLI root and omits the SDK component;
its checksum and provenance verify those published bytes but do not correct that
inventory. Those assets and tags remain unchanged. The normal release workflow
serializes each tag and refuses existing draft or published releases before builds
and immediately before attestation/publication. Draft lookup requires verified
push visibility and a complete paginated release listing. Publication uses a
create-only command, with no update or asset-overwrite path. Corrections use a
new version.
