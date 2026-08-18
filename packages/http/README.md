# @shortdrama-router/http

Framework-neutral HTTP adapter based on the standard `Request`/`Response` APIs.

It exposes provider discovery, method-scoped authorization, configuration resources, provider-scoped model discovery, asynchronous audio/image/video jobs, cancellation where a provider supports it, and the synchronous OpenAI-compatible `POST /v1/images/generations` endpoint. Creation routes accept `Idempotency-Key`. It deliberately does not expose a global `/models` endpoint.
