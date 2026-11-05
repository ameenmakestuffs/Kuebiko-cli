# Security Policy

## Supported Versions

We actively maintain and provide security patches for the following versions of Kuebiko CLI:

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |
| < 0.1.0 | :x:                |

## Responsible Disclosure

If you believe you have found a security vulnerability in Kuebiko CLI (including token leakage, path traversal in patch application, arbitrary code execution, or credential handling), please **do not open a public issue**.

Instead, please report the vulnerability privately:

1. **GitHub Security Advisory**: Submit a private advisory via [GitHub Security Advisories](https://github.com/ameenmakestuffs/Kuebiko-cli/security/advisories/new).
2. **Email**: Contact Ameen Ansari directly with vulnerability details, reproduction steps, and potential impact.

### What to Include in a Report

- Type of issue (e.g. directory traversal in patch synthesis, unscrubbed API key output, subshell injection).
- Step-by-step reproduction instructions or a minimal reproducible repository.
- Proof of concept or terminal log.
- Your assessment of impact and attack vectors.

### What to Expect

- **Acknowledgment**: Within 48 hours.
- **Triage & Assessment**: Within 5 business days.
- **Patch Release**: Coordinated fix with advisory credit in release notes.

## Zero Proxy Guarantee

Kuebiko connects directly from your local terminal to your configured AI provider (Google Gemini, Groq, Anthropic, OpenAI, Azure, Ollama) via HTTPS. Kuebiko operates with:
- Zero telemetry collection
- Zero intermediary proxy servers
- Local memory verification before touching disk

