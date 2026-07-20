# Third-party notices

## Obscura

Conversation Reader MCP can download and run Obscura as a local sidecar during
`setup`.

- Project: https://github.com/h4ckf0r0day/obscura
- Pinned release: `v0.1.10`
- Copyright: Obscura contributors
- License: Apache License 2.0
- Local license copy: `licenses/OBSCURA-APACHE-2.0.txt`

Obscura is downloaded directly from the project's official GitHub Release. It
is not bundled in the npm package. The installer selects the matching
macOS/Linux asset and rejects it unless its SHA-256 matches the value pinned in
`src/obscura-installer.ts` (compiled into the published package).

Obscura is a separate project. Its authors do not endorse or support
Conversation Reader MCP.
