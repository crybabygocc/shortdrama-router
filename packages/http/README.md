# @shortdrama-router/http

Framework-neutral HTTP adapter based on the standard `Request`/`Response` APIs.

It exposes provider discovery, provider authorization status, provider-scoped model discovery, asynchronous image/video jobs, and the synchronous OpenAI-compatible `POST /v1/images/generations` endpoint. It deliberately does not expose a global `/models` endpoint.
