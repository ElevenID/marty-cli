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
| `marty auth login` | Store an operator API key for the public gateway |
| `marty auth whoami` | Show current authentication status |
| `marty api-keys` | List, create, and revoke organization API keys (first ships in v0.3.1) |
| `marty health` | Check API health |
| `marty orgs` | List, create, inspect, or switch organizations |
| `marty credentials` | List, inspect, issue, verify, or revoke credentials |
| `marty applications` | Run applicant and organization-review workflows |
| `marty verify` | Start, submit, evaluate, and inspect verification sessions |
| `marty flows` | List, create, execute, inspect, and approve flows |
| `marty templates` | List and inspect application templates |
| `marty credential-templates` | Create, inspect, and activate credential templates |
| `marty compliance` | Manage compliance profiles |
| `marty trust` | Manage trust profiles |
| `marty license` | Activate, inspect, validate, and install licenses |
| `marty test e2e` | Run headless platform scenarios |
| `marty completion` | Generate Bash, Zsh, or Fish completions |

Aliases from the previous CLI remain available: `apps`, `creds`, and `ct`.

## Authentication

```bash
marty auth login --api-key <key>
marty auth login # choose API-key login in the guided flow
```

`MARTY_API_KEY` overrides stored credentials. The Marty gateway accepts
organization-bound API keys for machine access. The transport retains OAuth
and integration-test session handling, but a client-credentials token is not
accepted as a gateway machine credential and does not bootstrap an operator.

## Output and dry runs

### API-key lifecycle (v0.3.3)

These commands are available in v0.3.1 and later; v0.2.7 does not include them.
The v0.3.0 and v0.3.2 tags remain failed release attempts; neither published assets. v0.3.3 corrects the SDK SBOM
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

Starting with v0.3.3, the release publishes these CycloneDX inventories alongside
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


Before tagging a new client version, run the manual `release-preflight.yml` workflow on accepted
main with the existing unreleased v0.3.2 tag. Its write-scoped Actions installation
token creates one uniquely marked, asset-free draft, proves that the guard detects
that exact draft, and deletes only the unchanged owned draft. The existing tag is
checked before and after; no assets or release are published. An interrupted or
failed run retains a receipt with the owner nonce and any known draft ID for
recovery. A changed/published/nonempty draft is preserved for inspection.

The release jobs use explicit Actions write-token mode in their trusted workflow
context. User-role `permissions.push` is not an installation-token scope check;
standalone lookup keeps its user-role visibility check. The real Actions preflight
must pass before the next version is tagged.

The accepted-source preflight passed in run 40325626200 and v0.3.3 published
in run 40325826249. The probe records lookup identities and the failure stage,
allowing up to ten
observations with at most 18 seconds of waiting when lookup reports absence.
Every successful observation must identify the exact owned draft. Other lookup
errors fail immediately; the production absence guard is unchanged.


This source prepares v0.3.5 with corrected public organization/template setup
commands. It retains the public SDK transport declarations introduced in v0.3.4,
MIP 0.5.0 and the existing SDK runtime behavior. Use v0.3.5 only after its downloads
and provenance are published and verified.
See [the SDK guide](packages/api-core/README.md) for the typed contract and its
response-validation limits.

### Public organization and template setup (v0.3.5)

Use an existing authenticated operator with the required tenant permissions.
These commands do not create an unauthenticated initial operator. The API derives
organization ownership from the authenticated actor; `--owner-id` is unsupported.

```sh
marty orgs create --name acme --display-name 'Acme'
marty orgs switch ORGANIZATION_ID_FROM_RESPONSE
marty ct create --name 'Employee badge' --credential-type EmployeeCredential \
  --compliance-profile-id COMPLIANCE_PROFILE_ID \
  --issuer-did did:web:issuer.example \
  --vct https://issuer.example/credentials/employee
marty ct activate TEMPLATE_ID_FROM_RESPONSE
```

The compliance profile and issuer identity must already exist and satisfy the
server's creation/activation requirements. `--trust-profile-id` is optional.
For an mdoc template, use `--format MDOC --doctype org.iso.18013.5.1.mDL` instead
of the default SD-JWT format and its `--vct`. The selected format populates both
the primary format and `supported_formats`, avoiding an unintended SD-JWT default.
`--issuance-protocol` optionally selects the server-supported protocol.
`--claims` accepts a JSON array of public claim definitions, for example
`[{"name":"given_name","display":{"label":"Given name"}}]`.

Template creation requires the public `--issuer-did`; custody selection and
algorithms are resolved by the platform, so `--key-access-mode` and
`--issuer-algorithm` are rejected. `publish` remains an alias for `activate` and
uses `/activate`. The obsolete `--force` override is rejected; activation keeps
the server's normal policy and artifact checks. Add `--dry-run` to inspect a
request without sending it. Recognized formats and local HTTP tests do not
qualify issuance, wallet interoperability or a full deployed headless lifecycle.
