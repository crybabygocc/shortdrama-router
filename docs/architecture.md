# Architecture

`shortdrama-router` separates provider-neutral routing from provider-native behavior. The public API can grow without forcing every video platform into the same account, model or billing shape.

## Packages

```text
packages/core/                  provider contracts, registry, routing, job store
packages/provider-jimeng/       official Dreamina CLI adapter and OAuth Device Flow
packages/provider-libtv/        official LibTV CLI adapter and live model catalog
packages/provider-xiaoyunque/  XiaoYunque catalog, credentials and transports
packages/http/                  Fetch-compatible HTTP handler
packages/sdk/                   public npm package that exports all services
```

Dependency direction is one-way:

```text
sdk -> http -> core
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
- normalized image/video creation and polling;
- translation between normalized requests and native upstream contracts.

The router owns public job IDs and stores provider job references behind a `VideoJobStore`. This keeps upstream run IDs and credential bindings out of public responses and makes persistent storage replaceable later.

## Discovery instead of a global model list

Model discovery is intentionally two-step:

1. list providers and inspect their authorization status;
2. query models for one selected provider.

HTTP clients use:

- `GET /api/v1/providers`;
- `GET /api/v1/providers/{provider}`;
- `GET /api/v1/providers/{provider}/authorization`;
- `GET /api/v1/providers/{provider}/models`.

There is no global `/models` endpoint. Provider catalogs can change independently and can expose different metadata without lossy normalization.

## XiaoYunque authorization

The XiaoYunque adapter chooses credentials in this order:

1. official Access Key;
2. user-authorized local Web session.

Interactive `api_key` authorization asks the local host to open XiaoYunque's official login page and capture only the declared session cookies after the user completes login. The adapter then calls XiaoYunque's own `/api/biz/v1/user/generate_ak` surface, stores the returned Access Key through the injected credential source, and does not persist the temporary Web session. This avoids manual key discovery and copy/paste while keeping the final runtime credential on the user's device.

The Access Key transport uses the official `/api/biz/v1/skill/*` surfaces. The Web-session transport remains an explicit fallback for capabilities not covered by the Access Key API and uses the user-visible XiaoYunque Web APIs only with credentials supplied by a local credential store. The package does not include a remote credential store.

Authorization inspection distinguishes configured, verified, expiring and expired credentials. When the provider cannot safely verify an Access Key, it reports `configured` rather than inventing validity.

## Official local CLI providers

The Jimeng and LibTV adapters execute their official local CLIs as argument arrays without a shell. Their OAuth credentials stay in each CLI's own local credential store; the router only reads command results and never imports tokens into provider job records.

Jimeng maps router image/video jobs to the official `dreamina` asynchronous submit and query commands. LibTV maps jobs to uniquely named image/video nodes on a configured user canvas and waits for the official `libtv node --run` terminal JSON. Neither adapter estimates credits when the official command output does not supply a stable per-request estimate.

## Media references

The first implementation accepts XiaoYunque/Pippit provider asset identities. Automatic URL downloading is deliberately outside the provider adapter because it needs an explicit SSRF, size and MIME policy. A future media-preparation package can upload bounded local or remote inputs before provider submission without changing the provider contract.
