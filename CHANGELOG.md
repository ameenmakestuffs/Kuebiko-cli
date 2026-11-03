# Changelog

All notable changes to **Aegis** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.1.2] - 2026-11-03

### Added
- **Interactive Onboarding Wizard (`kuebiko init` / `kuebiko setup`)**:
  - Step-by-step interactive configuration of AI providers (Groq, Gemini, OpenAI, Anthropic, Ollama).
  - Masked secret input with native OS clipboard paste (<kbd>Ctrl</kbd>+<kbd>V</kbd>) support on Windows and macOS.
  - Interactive retry loop if verification fails.
  - Choice of global (`~/.kuebiko/.env`) or local (`.env`) storage with automated `.gitignore` protection check.
  - 100% Client-Side BYOK (Bring Your Own Key) privacy guarantee.
- **Groq Provider Integration**:
  - Ultra-fast inference (~800 tok/s) supporting `openai/gpt-oss-120b`, `openai/gpt-oss-20b`, `qwen/qwen3.8-27b`, and `llama-3.3-70b-versatile`.
  - JSON-mode structured outputs and automated token budgeting.
- **Subcommands (`explain` & `ask`)**:
  - `kuebiko explain [error]`: Instant translation of stack traces into plain English diagnostics, solutions, and prevention tips.
  - `kuebiko ask [question]`: Context-aware codebase Q&A assistant using project structure and preferred LLM.

---

## [0.1.1] - 2026-11-03

### Added
- **Bring-Your-Own (BYO) Model Providers**:
  - **OpenAI**: Native `/v1/chat/completions` integration with JSON mode support.
  - **Anthropic**: Claude integration using the Messages API.
  - **Azure OpenAI**: Enterprise deployment-based endpoints.
  - **AWS Bedrock**: Amazon Bedrock Converse API with custom zero-dependency AWS SigV4 signing.
  - **Ollama**: Local inference support without requiring external API keys.
  - Auto-detection priority and model ladder fallbacks across providers.
- **Polyglot Triage & Local Repair**:
  - **Python**: Full support for `pytest` and `unittest` tracebacks, relative import mapping, assertion parsing, and comment/docstring-aware mutation scanning.
  - **Go**: Full support for `go test` failure output, `go.mod` internal package resolution, got/want comparison matching, and syntax-aware token mutations.
- **Benchmark Suite (`aegis bench`)**:
  - Added reproducible repair evaluation harness with temporary isolated scratch directories.
  - Starter suite with 3 polyglot test cases: `js-discount-sign`, `python-discount-sign`, and `go-discount-sign`.
  - Machine-readable JSON output at `.aegis/bench/latest.json`.
- **Composite GitHub Action (`action.yml`)**:
  - Turnkey integration for CI/CD pipelines (`ameen-ansarii/Aegis-CLI@main` or `@v0.1.1`).
  - Inputs for command, engine, provider, model, and offline modes.
  - Automatically exports `report-path` artifact output.
- **Expanded Test Coverage**:
  - Added unit test suites for polyglot triage, polyglot local repair, and multi-provider resolution (28 total tests passing).

### Changed
- Refactored `src/services/gemini.ts` proposal parser into a shared parsing utility used across all LLM providers.
- Improved secret redaction across provider HTTP requests and CLI error messages.

---

## [0.1.0] - 2026-11-03

### Added
- **Core Autonomous Repair Loop**:
  - Multi-tiered repair ladder: AI repair fallback to deterministic local mutation engine.
  - Command execution harness with cross-process group termination on timeout.
  - Safe file patcher with automatic in-memory rollback and atomic temp-file writes.
  - Secret redaction filter ensuring API keys and auth tokens never leak into prompts or logs.
- **Failure Triage**:
  - Error stack trace extraction for JavaScript and TypeScript.
  - Test framework detection (Jest, Vitest, node:test, Mocha).
  - Suspect file ranking and assertion difference extraction.
- **Deterministic Local Repair**:
  - AST-free token scanner for single-edit operator swaps, boolean flips, and number nudging.
  - In-loop speculative verification testing candidates without risking repository state.
- **Primary AI Provider**:
  - Native Google Gemini integration (`gemini-3.8-flash` primary, `gemini-3.5-flash-lite` fallback) with structured JSON schema outputs.
- **CLI Commands**:
  - `aegis run <command...>`: Main repair session.
  - `aegis doctor`: Environment and provider health check.
  - `aegis demo`: Interactive repair demo with seeded reproducible bugs in `demo-sandbox/`.

