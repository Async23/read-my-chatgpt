# Changelog

本项目遵循 [Semantic Versioning](https://semver.org/)。

## [Unreleased]

## [0.2.0] - 2026-07-21

### Changed

- Adopted `read-my-chatgpt` as the GitHub repository, npm package, CLI,
  MCP server, and local service name.
- Added automatic migration from `conversation-reader-mcp` service files,
  local data, logs, and AI client entries.

## [0.1.1] - 2026-07-21

### Added

- Public contribution, support, issue, and pull request guidance.
- Cross-platform packaged CLI lifecycle verification.
- Dependency update and code-scanning automation.

### Security

- Hardened GitHub Actions and release checks.
- Eliminated regex backtracking on untrusted `Authorization` headers.

## [0.1.0] - 2026-07-20

### Added

- One local Streamable HTTP MCP server shared by supported AI clients.
- Managed Obscura sidecar with pinned version, size, and SHA-256 verification.
- macOS launchd and Linux systemd user service setup.
- Automatic configuration for Codex, Claude Code, Cursor, Gemini CLI, Grok
  CLI, OpenCode, and Pi.
- Read-only conversation listing, retrieval, and title search tools.

[Unreleased]: https://github.com/Async23/read-my-chatgpt/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/Async23/read-my-chatgpt/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/Async23/read-my-chatgpt/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/Async23/read-my-chatgpt/releases/tag/v0.1.0
