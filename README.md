<div align="center">

# Aegis

**The autonomous, safety-first on-call engineer for your CLI.**

[![License: MIT](https://img.shields.io/badge/license-MIT-111111.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-339933.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6.svg)](https://www.typescriptlang.org)

Run a failing command once. Aegis triages the failure, patches the code through a resilient AI ladder, verifies the fix, and keeps it only if the build turns green.

</div>

---

## Quick start

```bash
npm install -g aegis-cli
aegis run "npm test"
```

No install? Try the deterministic sandbox:

```bash
npx aegis-cli demo
```

Add a model provider (Gemini is the default):

```bash
cp .env.example .env
# set GEMINI_API_KEY

aegis doctor --live
```

Aegis works without a key by falling back to its deterministic local repair engine. Requires Node.js 20.11+.

## How it works

```
  aegis run "npm test"
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

Every attempt is bounded, reversible, and auditable. Aegis never keeps a patch that has not been verified by the real command.

## Multi-tier resilience ladder

| Tier | Engine | Responsibility |
| --- | --- | --- |
| 1 | `gemini-3.8-flash` | Deep trace triage and context-heavy reasoning |
| 2 | `gemini-3.5-flash-lite` | High-headroom fallback for rate limits and 503 failover |
| 3 | Local AST Mutation Engine | Deterministic, offline repair with zero network dependency |

If Tier 1 is rate-limited, unavailable, times out, or declines to patch, Aegis advances automatically. Tier 2 handles sustained load. Tier 3 guarantees the loop still works offline.

### Bring your own model

The ladder is model-agnostic. Select a provider with `--provider`, `AEGIS_PROVIDER`, or auto-detection.

| Provider | Authentication | Default ladder |
| --- | --- | --- |
| Gemini | `GEMINI_API_KEY` or `GOOGLE_API_KEY` | `gemini-3.8-flash` → `gemini-3.5-flash-lite` |
| OpenAI | `OPENAI_API_KEY`, optional `OPENAI_BASE_URL` | `gpt-4.1` → `gpt-4.1-mini` |
| Anthropic | `ANTHROPIC_API_KEY`, optional `ANTHROPIC_BASE_URL` | `claude-sonnet-4-5` → `claude-haiku-4-5` |
| Azure OpenAI | `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_DEPLOYMENT` | deployment |
| AWS Bedrock | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `BEDROCK_MODEL` | `BEDROCK_MODEL` |
| Ollama | `OLLAMA_BASE_URL` or `OLLAMA_HOST` | `llama3.1` |

Override with `AEGIS_MODEL`, a provider-specific model variable, or `--model`.

## Supported languages

Aegis repairs any text source file the model can edit. Triage and the local deterministic engine currently have dedicated adapters for JavaScript/TypeScript, Python, and Go.

## GitHub Actions

```yaml
- uses: ameen-ansarii/Aegis-CLI@main
  with:
    command: npm test
    engine: auto
  env:
    GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
```

Set the provider key as an environment secret; the Action never asks for keys as inputs. Add `.aegis/` to your repository's `.gitignore`. The Action exposes `report-path` for artifact upload.

## Benchmark

`aegis bench` runs the bundled JavaScript, Python, and Go repair fixtures in isolated temporary copies, then reports verified repair rate and median time-to-green. It uses the local engine by default for deterministic CI runs.

```bash
aegis bench              # deterministic local benchmark
aegis bench --live       # exercise the configured AI provider
aegis bench --json       # machine-readable results
```

Benchmark reports are written to `.aegis/bench/latest.json`. Add your own suite with `--suite path/to/suite.json`; see `bench/suites/starter/suite.json` for the format.

## Enterprise safety guarantees

- **Root confinement** — every write must resolve inside the project root; traversal is rejected.
- **Protected file blacklist** — `.env`, lockfiles, `node_modules`, `.git`, `dist`, `build`, and `.aegis` are immutable.
- **Auto-rollback** — any patch that does not turn the command green is restored byte-for-byte.
- **Zero runaway loops** — hard attempt cap, per-run timeout, bounded candidate search, and duplicate-patch rejection.
- **Atomic writes and backups** — temp-file writes, per-session backups, and interrupt-safe restoration.
- **Secret redaction** — API keys and tokens are stripped before any context leaves the machine.
- **Audit trail** — every session writes `.aegis/reports/<session>.json` with patches, model, and verification status.

## CLI reference

| Command | Description |
| --- | --- |
| `aegis run "<command>"` | Run, diagnose, patch, verify, and repeat until green. |
| `aegis demo` | Reseed the bundled failing sandbox and run the full loop. |
| `aegis doctor` | Check Node, write access, provider, and engine configuration. |
| `aegis doctor --live` | Verify the live provider ladder end to end. |
| `aegis bench` | Run the deterministic multi-language repair benchmark. |

| Flag | Applies to | Description |
| --- | --- | --- |
| `--cwd <dir>` | `run` | Project directory to operate on. |
| `--provider <name>` | `run`, `doctor`, `bench` | gemini, openai, anthropic, azure, bedrock, or ollama. |
| `--model <model>` | `run`, `doctor`, `bench` | Primary model override. |
| `--timeout <seconds>` | `run`, `bench` | Timeout per command run (default `300` / `60`). |
| `--max-iterations <n>` | `run` | Maximum repair attempts (default `3`). |
| `--offline` | `run`, `demo` | Skip AI; use the local engine only. |
| `--dry-run` | `run`, `demo` | Propose the patch without keeping it. |
| `--json` | `run`, `bench` | Emit a machine-readable report. |
| `--verbose` | `run` | Show full output and stack traces. |
| `--live` | `doctor`, `bench` | Make real provider calls instead of static/local checks. |

## Configuration

Aegis resolves configuration in this order: process environment, project `.env`, global `~/.aegis/.env`.

```bash
# .env
GEMINI_API_KEY=...
AEGIS_PROVIDER=gemini        # optional: gemini, openai, anthropic, azure, bedrock, ollama
AEGIS_MODEL=gemini-3.8-flash # optional: generic override
AEGIS_ENGINE=auto            # auto, ai, gemini, or local
```

Provider-specific keys and model variables are listed in “Bring your own model.” Project-level behavior can be tuned with `aegis.config.json`:

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
aegis demo            # reseed, diagnose, repair, verify
aegis demo --offline  # exercise the local tier
aegis demo --dry-run  # inspect the patch without keeping it
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
