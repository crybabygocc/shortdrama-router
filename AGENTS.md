# AI coding guide

This file is the entry point for every AI-assisted change in this repository.

## Read first

1. Read this file completely.
2. Read `README.md` for product scope and public behavior.
3. Read `docs/architecture.md` before changing package boundaries or public contracts.
4. Read the `README.md` or source-level documentation of the package being changed.
5. Read the relevant tests before changing behavior.

## Architectural rules

- `packages/core` owns provider-neutral contracts, routing and job storage. It must not import a provider package.
- Every third-party integration lives in its own `packages/provider-*` package.
- Provider credentials, native model names, request signing and upstream response shapes must not leak into `packages/core`.
- Models are queried per provider. Do not add a global `/models` aggregation endpoint.
- Provider discovery and authorization status are first-class APIs; an installed provider is not assumed to be authorized.
- Prefer official API keys or OAuth. Browser sessions are optional provider-local credentials and must remain on the user's device.
- Public jobs use router-owned IDs. Provider job identifiers and credential bindings remain internal.
- Provider-specific fields belong in the provider adapter or an explicitly named `provider_options` object.

## Allowed

- Add a provider by implementing the core `ProviderAdapter` contract.
- Add provider-scoped model, authorization, usage or account capabilities.
- Use dependency injection for HTTP, credential stores, clocks and job stores.
- Use loopback or mocked upstreams in automated tests.
- Add a capability without forcing unsupported providers to emulate it.

## Not allowed

- Do not log or return API keys, cookies, authorization headers or raw signed URLs.
- Do not persist credentials in this repository, fixtures, snapshots or ordinary plaintext config files.
- Do not make live paid generation calls from tests or development scripts by default.
- Do not silently retry a generation submission after its acceptance is uncertain.
- Do not fetch arbitrary remote media inside a provider adapter without an explicit bounded media-loader policy.
- Do not make core depend on a concrete provider, HTTP framework or storage implementation.
- Do not invent provider model support, prices, credit costs or authorization validity.

## Change checklist

- Run `npm run check`.
- Update provider-scoped model tests when a catalog changes.
- Update `openapi/openapi.yaml` when an HTTP contract changes.
- Confirm generated artifacts, dependencies and lockfiles contain no credentials.
- Keep public exports intentional and document compatibility-impacting changes.
