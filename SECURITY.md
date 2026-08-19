# Security Policy

shortdrama-router may handle API keys, access keys, OAuth tokens and user-authorized browser sessions. Treat every provider credential as a high-impact secret.

## Credential requirements

- Prefer official API keys and OAuth tokens over browser sessions.
- Keep browser session credentials on the user's device; never upload or relay them to a remote service.
- Store local credentials in the operating system keychain or an encrypted local file.
- Never write credentials, cookies, authorization headers or signed URLs to logs, traces, crash reports or analytics.
- Keep provider credentials isolated by connection and provider; never forward one provider's credential to another.
- Use an exact origin / domain allowlist for every session-based adapter.
- Support expiry, rotation and immediate revocation.
- Redact provider responses before persisting debug data.
- Bind public result URLs to short expiry times or proxy them through authenticated downloads.

## Local session adapters

Local session adapters use a browser session that the user authorizes on the provider's official site. The adapter reads only the credentials required for its own provider, keeps them local, and exposes only normalized task operations to shortdrama-router.

## Managed provider runtimes

- Download executable runtimes only after an explicit provider-install action.
- Use fixed official HTTPS hosts and a platform allowlist; never accept an arbitrary runtime URL from an API request.
- Pin trusted SHA-256 values for each supported platform and verify both the downloaded artifact and extracted executable before installation.
- Extract only the expected executable from provider ZIP files and enforce a bounded download size.
- Store managed executables under shortdrama-router's application data directory and invoke them by absolute path without a shell.
- Re-verify the installed executable against the pinned release metadata before every managed launch; reject missing metadata, unknown releases and digest mismatches.
- Require a recognizable version and successful compatibility probe before reporting the dependency as usable.
- Do not execute upstream installer scripts or let runtime installation modify PATH, shell profiles or unrelated application files.

## Deployment baseline

- Do not expose the gateway without its own authentication and rate limits.
- Run provider adapters with least privilege and separate outbound allowlists.
- Use idempotency keys to prevent duplicate paid tasks.
- Keep an audit trail of task IDs, connection IDs and upstream usage when available, without storing prompts by default.
- Never commit `.env`, cookies, session exports, local databases or credential files.

## Reporting

Do not publish live credentials or exploit details in a public issue. Use the repository host's private vulnerability reporting channel once the project is published. Rotate any credential that may have been exposed before sending a report.
