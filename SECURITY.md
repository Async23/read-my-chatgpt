# Security policy

## Reporting a vulnerability

Please do not open a public issue for a vulnerability, access token, cookie,
private conversation, or other sensitive material.

Use GitHub's **Security → Report a vulnerability** flow for this repository.
Include only the minimum reproduction data and replace all real credentials
with test values.

We aim to acknowledge a complete report within seven days. Fix timing depends
on severity, reproducibility, and upstream behavior. Please allow time for a
coordinated fix before public disclosure.

## Supported versions

Only the latest published version receives security fixes.

## Local trust boundary

The HTTP MCP endpoint is intentionally limited to loopback and protected with a
generated Bearer token. Reports that require binding it to a LAN or public
interface are outside the supported security model.
