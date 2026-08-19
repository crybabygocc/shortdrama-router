# shortdrama-router

The Node.js SDK exports the router, HTTP handler, managed runtime service and every bundled provider. End users can instead download the standalone executable from GitHub Releases; it embeds Node.js and does not require npm.

The standalone executable can install the official runtime required by a selected provider. The same operation is exposed as `POST /api/v1/providers/{provider}/runtime` for local management UIs. Managed executables live in shortdrama-router's application data directory and are never resolved from an arbitrary PATH entry.

Start a local OpenAI/OpenRouter-style audio, image and video API:

```bash
export XYQ_ACCESS_KEY="<your-xiaoyunque-access-key>"
export LIBTV_PROJECT_UUID="<your-libtv-canvas-uuid>"
export SHORTDRAMA_ROUTER_KEY="<your-local-router-key>"
npx shortdrama-router serve --host 127.0.0.1 --port 8080
```

List the currently installed services and their authorization state:

```bash
npx shortdrama-router providers
npx shortdrama-router providers --probe
```

`--json` returns the same provider-scoped discovery data for scripts and UIs.

```ts
import {
  createRouterHttpHandler,
  createShortDramaRouter,
} from "shortdrama-router"

const router = createShortDramaRouter({
  jimeng: {},
  libtv: {
    projectUuid: process.env.LIBTV_PROJECT_UUID,
  },
  xiaoyunque: {
    accessKey: process.env.XIAOYUNQUE_ACCESS_KEY,
  },
})

const providers = await router.listProviders({
  probeAuthorization: true,
  probeConfiguration: true,
  probeDependencies: true,
})
const models = await router.listProviderModels("libtv")
const handle = createRouterHttpHandler(router)
```

The server exposes asynchronous general audio jobs under `/api/v1/audio`, synchronous OpenAI-compatible image generation at `POST /v1/images/generations`, asynchronous image jobs under `/api/v1/images`, and asynchronous video jobs under `/v1/videos` and `/api/v1/videos`. Creation routes accept `Idempotency-Key`. General audio generation is not presented as OpenAI text-to-speech.

`createShortDramaRouter()` registers the Jimeng, LibTV and XiaoYunque adapters even when they have no credentials. This lets applications show supported services and their authorization state before login. Jimeng and LibTV executables are installed only after an explicit runtime-install action; their credentials remain managed by the official local CLIs.
