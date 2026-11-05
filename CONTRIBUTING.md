# Contributing to Kuebiko CLI

Thank you for your interest in contributing to Kuebiko CLI! We welcome contributions from developers of all backgrounds.

## Code of Conduct

This project and everyone participating in it is governed by our [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

## Quick Start Development Setup

### Prerequisites

- Node.js 20 or newer (v20, v22, or v24)
- npm 9 or newer
- Git

### Initial Setup

```bash
# Clone your fork
git clone https://github.com/<your-username>/Kuebiko-cli.git
cd Kuebiko-cli

# Install dependencies
npm install

# Build TypeScript to dist/
npm run build
```

## Running Tests & Verifications

Before submitting any code changes or opening a pull request, verify that all test suites and benchmarks pass:

```bash
# 1. Run unit test suite (29 tests)
npm test

# 2. Test full TypeScript compilation
npm run build

# 3. Test the offline self-healing engine loop
npm run demo:offline

# 4. Restore the demo test fixture
npm run demo:reset

# 5. Run the polyglot repair benchmark suite
npm run bench
```

## Local Configuration & API Keys

You **do not** need API keys for core unit tests. The unit test suite runs completely offline with simulated mocks and deterministic local AST mutation rules.

If you are developing features for Tier 3 neural repairs or provider integrations:
1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
2. Add your local provider key (e.g. `GEMINI_API_KEY`, `GROQ_API_KEY`).
3. **Never** commit `.env`. It is explicitly ignored in `.gitignore`.

## Architectural Guidelines

Kuebiko enforces strict safety principles:

1. **Memory First Verification**: Candidate patches must be verified in a temporary in-memory sandbox before any changes touch the user's disk (`src/patch/patcher.ts`).
2. **Protected Paths Guard**: Never allow edits to `.git/`, `.env*`, `node_modules/`, or system root files (`src/core/protected.ts`).
3. **Zero Telemetry**: Do not introduce analytics trackers, telemetry pings, or intermediary proxy servers.
4. **Deterministic Preference**: Simple boundary mismatches and inverted comparison signs must be handled locally in Tier 2 without making LLM calls (`src/mutate/local.ts`).

## Pull Request Workflow

1. Fork the repository on GitHub.
2. Create a feature branch off `main`:
   ```bash
   git checkout -b feature/your-feature-name
   ```
3. Commit your changes with clear, descriptive commit messages.
4. Verify that `npm test` and `npm run build` pass cleanly with 0 warnings or errors.
5. Push to your fork and submit a Pull Request to `main`.
6. Our GitHub Actions CI will automatically test your PR on Node.js 20, 22, and 24.

