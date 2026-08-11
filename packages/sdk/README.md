# shortdrama-router

One npm package that exports the router, HTTP handler and every bundled provider.

Start a local OpenAI/OpenRouter-style image and video API:

```bash
export XYQ_ACCESS_KEY="<your-xiaoyunque-access-key>"
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
  xiaoyunque: {
    accessKey: process.env.XIAOYUNQUE_ACCESS_KEY,
  },
})

const providers = await router.listProviders({ probeAuthorization: true })
const models = await router.listProviderModels("xiaoyunque")
const handle = createRouterHttpHandler(router)
```

The server exposes synchronous OpenAI-compatible image generation at `POST /v1/images/generations`, asynchronous image jobs under `/api/v1/images`, and asynchronous video jobs under `/v1/videos` and `/api/v1/videos`.

`createShortDramaRouter()` always installs the XiaoYunque adapter, even when it has no credentials. This lets applications show supported services and their authorization state before login.
