<div align="center">

# Kuebiko

**The autonomous, safety-first on-call engineer for your CLI.**

[![License: MIT](https://img.shields.io/badge/license-MIT-111111.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-339933.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6.svg)](https://www.typescriptlang.org)

Run a failing command once. Kuebiko triages the failure, patches the code through a resilient AI ladder, verifies the fix, and keeps it only if the build turns green.

</div>

---

## Quick start

```bash
npm install -g kuebiko-cli
kuebiko run "npm test"
```

No install? Try the deterministic sandbox:

```bash
npx kuebiko-cli demo
```

Add a model provider (Gemini is the default):

```bash
cp .env.example .env
# set GEMINI_API_KEY

kuebiko doctor --live
```

Kuebiko works without a key by falling back to its deterministic local repair engine. Requires Node.js 20.11+.

## How it works

```
  kuebiko run "npm test"
          │
          ▼
┌─────────────────────┐
│ 1. Command Run      │  isolated child process + exit code
└──────────┬──────────┘
           │ non-zero
           ▼
┌─────────────────────┐
│ 2. Failure Intercept│  stack frames, assertions, suspect files
└──────────┬──────────┘
           ▼
┌─────────────────────┐
│ 3. Resilient AI     │  tiered models + local fallback
│    Ladder           │
└──────────┬──────────┘
           ▼
┌─────────────────────┐
│ 4. Atomic           │  confined write, backup, command re-run
│    Verification     │
└──────────┬──────────┘
           │
      green? ├── yes ──> Clean Commit  → verified patch + JSON report
           │
           └── no  ──> Rollback      → restore original, retry (max 3)
```

Every attempt is bounded, reversible, and auditable. Kuebiko never keeps a patch that has not been verified by the real command.

## Multi-tier resilience ladder

| Tier | Engine | Responsibility |
| --- | --- | --- |
| 1 | `gemini-3.8-flash` | Deep trace triage and context-heavy reasoning |
| 2 | `gemini-3.5-flash-lite` | High-headroom fallback for rate limits and 503 failover |
| 3 | Local AST Mutation Engine | Deterministic, offline repair with zero network dependency |

If Tier 1 is rate-limited, unavailable, times out, or declines to patch, Kuebiko advances automatically. Tier 2 handles sustained load. Tier 3 guarantees the loop still works offline.

### Bring your own model

The ladder is model-agnostic. Select a provider with `--provider`, `KUEBIKO_PROVIDER`, or auto-detection.

| Provider | Authentication | Default ladder |
| --- | --- | --- |
| Gemini | `GEMINI_API_KEY` or `GOOGLE_API_KEY` | `gemini-3.8-flash` → `gemini-3.5-flash-lite` |
| OpenAI | `OPENAI_API_KEY`, optional `OPENAI_BASE_URL` | `gpt-4.1` → `gpt-4.1-mini` |
| Anthropic | `ANTHROPIC_API_KEY`, optional `ANTHROPIC_BASE_URL` | `claude-sonnet-4-5` → `claude-haiku-4-5` |
| Azure OpenAI | `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_DEPLOYMENT` | deployment |
| AWS Bedrock | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `BEDROCK_MODEL` | `BEDROCK_MODEL` |
| Ollama | `OLLAMA_BASE_URL` or `OLLAMA_HOST` | `llama3.1` |

Override with `KUEBIKO_MODEL`, a provider-specific model variable, or `--model`.

## Supported languages

Kuebiko repairs any text source file the model can edit. Triage and the local deterministic engine currently have dedicated adapters for JavaScript/TypeScript, Python, and Go.

## GitHub Actions

```yaml
- uses: ameen-ansarii/Aegis-CLI@main
  with:
    command: npm test
    engine: auto
  env:
    GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
```

Set the provider key as an environment secret; the Action never asks for keys as inputs. Add `.kuebiko/` to your repository's `.gitignore`. The Action exposes `report-path` for artifact upload.

## Benchmark

`kuebiko bench` runs the bundled JavaScript, Python, and Go repair fixtures in isolated temporary copies, then reports verified repair rate and median time-to-green. It uses the local engine by default for deterministic CI runs.

```bash
kuebiko bench              # deterministic local benchmark
kuebiko bench --live       # exercise the configured AI provider
kuebiko bench --json       # machine-readable results
```

Benchmark reports are written to `.kuebiko/bench/latest.json`. Add your own suite with `--suite path/to/suite.json`; see `bench/suites/starter/suite.json` for the format.

## Enterprise safety guarantees

- **Root confinement** — every write must resolve inside the project root; traversal is rejected.
- **Protected file blacklist** — `.env`, lockfiles, `node_modules`, `.git`, `dist`, `build`, `.kuebiko`, and `.aegis` are immutable.
- **Auto-rollback** — any patch that does not turn the command green is restored byte-for-byte.
- **Zero runaway loops** — hard attempt cap, per-run timeout, bounded candidate search, and duplicate-patch rejection.
- **Atomic writes and backups** — temp-file writes, per-session backups, and interrupt-safe restoration.
- **Secret redaction** — API keys and tokens are stripped before any context leaves the machine.
- **Audit trail** — every session writes `.kuebiko/reports/<session>.json` with patches, model, and verification status.

## CLI reference

| Command | Description |
| --- | --- |
| `kuebiko run "<cmd>"` | Run the target command, repair on failure, and verify until green |
| `kuebiko doctor` | Inspect Node version, project permissions, and AI credentials |
| `kuebiko demo` | Reseed and run the bundled demo bug in `demo-sandbox/` |
| `kuebiko bench` | Run polyglot benchmark fixtures and report pass rate and latency |

### Key flags for `kuebiko run`

| Flag | Default | Description |
| --- | --- | --- |
| `-C, --cwd <dir>` | `.` | Working directory of the target project |
| `-i, --max-iterations <n>` | `3` | Maximum repair attempts before giving up |
| `--engine <mode>` | `auto` | `auto`, `ai`, `gemini`, or `local` |
| `--provider <name>` | `auto` | `gemini`, `openai`, `anthropic`, `azure`, `bedrock`, or `ollama` |
| `--model <model>` | `gemini-3.8-flash` | Override the default primary model |
| `--timeout <seconds>` | `300` | Timeout per command execution |
| `--max-candidates <n>` | `48` | Mutation budget for the local repair tier |
| `--offline` | `false` | Disable all AI providers and rely strictly on local mutation |
| `--dry-run` | `false` | Diagnose and propose the patch without writing files |
| `--json` | `false` | Output pure JSON (ideal for CI and scripting) |
| `-v, --verbose` | `false` | Print full command streams and stack traces |

## Configuration (`kuebiko.config.json`)

Configure defaults at the project root:

```json
{
  "maxIterations": 3,
  "timeoutMs": 300000,
  "engine": "auto",
  "provider": "gemini",
  "model": "gemini-3.8-flash",
  "maxCandidates": 48
}
```

## Demo

`demo-sandbox/` is a real storefront module with a seeded discount-sign bug and a `node:test` suite.

```bash
kuebiko demo            # reseed, diagnose, repair, verify
kuebiko demo --offline  # exercise the local tier
kuebiko demo --dry-run  # inspect the patch without keeping it
```

## Development

```bash
npm install
npm run build
npm test
npm run demo:offline
npm run bench
```

The test suite covers triage, diffing, patch safety, polyglot local repair, provider routing, model-ladder selection, and AI response validation.

## Releases & Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history, new features, and upgrade notes across releases.

## License

[MIT](LICENSE)
