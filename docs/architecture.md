# Architecture

`shortdrama-router` separates provider-neutral routing from provider-native behavior. The public API can grow without forcing every video platform into the same account, model or billing shape.

## Packages

```text
packages/core/                  provider contracts, registry, routing, job store
packages/runtime/               generic managed executable download and installation
packages/provider-jimeng/       official Dreamina CLI adapter and OAuth Device Flow
packages/provider-libtv/        official LibTV CLI adapter and live model catalog
packages/provider-xiaoyunque/  XiaoYunque catalog, credentials and transports
packages/http/                  Fetch-compatible HTTP handler
packages/sdk/                   public npm package that exports all services
```

Dependency direction is one-way:

```text
sdk -> http -> core
sdk -> runtime
http -> runtime
provider-jimeng -> runtime
provider-libtv -> runtime
sdk -> provider-jimeng -> core
sdk -> provider-libtv -> core
sdk -> provider-xiaoyunque -> core
```

`core` never imports a provider implementation.

## Provider boundary

Each provider implements `ProviderAdapter`:

- metadata and capability discovery;
- authorization status and optional authorization lifecycle;
- provider-scoped model listing;
- normalized audio/image/video creation and polling;
- translation between normalized requests and native upstream contracts.

The router owns public job IDs and stores provider job references behind media-specific job stores. The built-in memory stores provide atomic request claiming and compare-and-set updates for one process. A production host can inject durable stores; idempotency fails closed when a custom store cannot atomically claim a key.

The router claims a job before provider submission. If upstream acceptance cannot be confirmed, the job becomes `submission_unknown` and is never automatically resubmitted. Polling uses guarded state transitions so a late provider response cannot overwrite a terminal job.

## Discovery instead of a global model list

Model discovery is intentionally two-step:

1. list providers and inspect their authorization status;
2. query models for one selected provider.

HTTP clients use:

- `GET /api/v1/providers`;
- `GET /api/v1/providers/{provider}`;
- `GET /api/v1/providers/{provider}/authorization`;
- `GET /api/v1/providers/{provider}/authorizations`;
- `GET /api/v1/providers/{provider}/configuration`;
- `GET /api/v1/providers/{provider}/resources`;
- `GET /api/v1/providers/{provider}/models`.

There is no global `/models` endpoint. Provider catalogs can change independently and can expose different metadata without lossy normalization.

## XiaoYunque authorization

The XiaoYunque adapter evaluates its two credential methods independently and chooses a usable credential in this order:

1. official Access Key;
2. user-authorized local Web session.

Interactive `api_key` authorization asks the local host to open XiaoYunque's official login page and capture only the declared session cookies after the user completes login. The adapter then calls XiaoYunque's own `/api/biz/v1/user/generate_ak` surface, stores the returned Access Key through the injected credential source, and does not persist the temporary Web session. This avoids manual key discovery and copy/paste while keeping the final runtime credential on the user's device.

The Access Key transport uses the official `/api/biz/v1/skill/*` surfaces. The Web-session transport remains an explicit fallback for capabilities not covered by the Access Key API and uses the user-visible XiaoYunque Web APIs only with credentials supplied by a local credential store. The package does not include a remote credential store.

Authorization inspection distinguishes configured, verified, expiring and expired credentials. When the provider cannot safely verify an Access Key, it reports `configured` rather than inventing validity.

## Managed official CLI providers

The Jimeng and LibTV adapters execute their official local CLIs as argument arrays without a shell. A user-selected runtime installation downloads the platform artifact from the provider's official host into shortdrama-router's application data directory. The adapter executes that absolute path and does not modify PATH or shell profiles. An explicit application-supplied CLI path remains available for development and managed deployments.

The npm package is the embeddable SDK. GitHub Releases additionally contain a Node.js single-executable application built from the same SDK, so end users do not need Node.js or npm. Runtime installation is exposed through both that executable and the loopback management API.

CLI dependencies must return a recognizable version and pass their adapter's compatibility probe. Merely finding an executable is insufficient to mark provider models available.

Jimeng maps router image/video jobs to the official `dreamina` asynchronous submit and query commands. LibTV maps jobs to uniquely named image/video nodes on a configured user canvas and waits for the official `libtv node --run` terminal JSON. Neither adapter estimates credits when the official command output does not supply a stable per-request estimate.

## Media references and artifacts

Public references use provider-neutral `{ provider, id, kind? }` identities. Legacy XiaoYunque/Pippit fields remain accepted for one compatibility window inside its adapter. Automatic URL downloading and local-path ingestion are deliberately unsupported because they require explicit SSRF, size, MIME and lifecycle policies.

Completed jobs expose typed `artifacts` with `kind`, canonical `media_type` and a validated URL. Legacy `outputs` remain available as a compatibility bridge.
