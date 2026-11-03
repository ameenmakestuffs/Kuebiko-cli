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

Add a Gemini key for AI-powered repairs:

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
| `aegis doctor` | Check Node, write access, key, and engine configuration. |
| `aegis doctor --live` | Verify the live Gemini ladder end to end. |

| Flag | Applies to | Description |
| --- | --- | --- |
| `--cwd <dir>` | `run` | Project directory to operate on. |
| `--model <model>` | `run` | Primary model (default `gemini-3.8-flash`). |
| `--timeout <seconds>` | `run` | Timeout per command run (default `300`). |
| `--max-iterations <n>` | `run` | Maximum repair attempts (default `3`). |
| `--offline` | `run`, `demo` | Skip AI; use the local engine only. |
| `--dry-run` | `run`, `demo` | Propose the patch without keeping it. |
| `--json` | `run` | Emit a machine-readable session report. |
| `--verbose` | `run` | Show full output and stack traces. |
| `--live` | `doctor` | Make a real Gemini request to verify the ladder. |

## Configuration

Aegis resolves configuration in this order: process environment, project `.env`, global `~/.aegis/.env`. Both `GEMINI_API_KEY` and `GOOGLE_API_KEY` are accepted.

```bash
# .env
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-3.8-flash
AEGIS_ENGINE=auto
```

Project-level behavior can be tuned with `aegis.config.json`:

```json
{
  "maxIterations": 3,
  "timeoutMs": 300000,
  "engine": "auto",
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
```

The test suite covers triage, diffing, patch safety, local repair, model-ladder routing, and AI response validation.

## License

[MIT](LICENSE)
