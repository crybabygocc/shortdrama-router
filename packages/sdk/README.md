# shortdrama-router

One npm package that exports the router, HTTP handler and every bundled provider.

Start a local OpenAI/OpenRouter-style audio, image and video API:

```bash
export XYQ_ACCESS_KEY="<your-xiaoyunque-access-key>"
export LIBTV_CLI_PATH="$HOME/.libtv/libtv"
export LIBTV_PROJECT_UUID="<your-libtv-canvas-uuid>"
export DREAMINA_CLI_PATH="$HOME/.local/bin/dreamina"
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
  jimeng: {
    cliPath: process.env.DREAMINA_CLI_PATH,
  },
  libtv: {
    cliPath: process.env.LIBTV_CLI_PATH,
    projectUuid: process.env.LIBTV_PROJECT_UUID,
  },
  xiaoyunque: {
    accessKey: process.env.XIAOYUNQUE_ACCESS_KEY,
  },
})

const providers = await router.listProviders({ probeAuthorization: true })
const models = await router.listProviderModels("libtv")
const handle = createRouterHttpHandler(router)
```

The server exposes asynchronous general audio jobs under `/api/v1/audio`, synchronous OpenAI-compatible image generation at `POST /v1/images/generations`, asynchronous image jobs under `/api/v1/images`, and asynchronous video jobs under `/v1/videos` and `/api/v1/videos`. General audio generation is not presented as OpenAI text-to-speech.

`createShortDramaRouter()` installs the Jimeng, LibTV and XiaoYunque adapters even when they have no credentials. This lets applications show supported services and their authorization state before login. Jimeng and LibTV credentials remain managed by their official local CLIs.
