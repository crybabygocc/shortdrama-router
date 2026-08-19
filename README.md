# shortdrama-router

**把 libtv、小云雀、即梦、可灵等漫剧与视频创作平台，路由成 OpenRouter / OpenAI 风格的音频、图片与视频生成 API。**

`shortdrama-router` 是一个面向漫剧、AI 短剧和视频工作流的开源 API 路由器。业务只需要接入一套熟悉的视频任务协议，就可以按 `provider/model` 选择不同创作平台；平台账号、模型能力和实际生成仍由用户分别授权的 provider 提供。

`short drama` 直接表达短剧、漫剧和连续叙事视频场景，`router` 表示它采用与 OpenRouter 相同的多 provider 路由思路。仓库名固定使用全小写和中划线：`shortdrama-router`。

> 当前状态：`0.5.0` / pre-alpha。已接入小云雀、LibTV 和即梦，提供 Seed Audio、生图、生视频、provider 模型与依赖发现、分方式授权状态、严格受管理的官方 CLI 运行时、本地 HTTP 服务、npm SDK 和无需 npm 的独立程序。

## 为什么使用 shortdrama-router

- **一次接入多个创作平台**：业务不需要分别处理各家的鉴权、参数、异步状态和结果下载；
- **更快使用平台首发能力**：libtv、小云雀、即梦、可灵等创作平台经常比通用聚合 API 更早提供新模型或完整工作流；
- **适合漫剧工作流**：除基础文生视频外，还要逐步覆盖参考图、首尾帧、角色一致性、视频编辑、续写和原生音频；
- **账号与费用归用户所有**：用户分别授权自己的 provider，路由器不出售账号，也不转售额度；
- **可选复用已有权益**：通过各 provider 支持的授权方式连接用户自有账号；已有会员或活动权益若可用，由对应 adapter 直接复用。

## 协议目标

`shortdrama-router` 不另造一套视频协议，优先复用现有标准：

### OpenRouter 风格：主协议

OpenRouter 的视频接口更适合多模型路由。项目沿用它的多 provider 路由与异步任务思路，并提供以下主协议入口：

- `POST /api/v1/audio` 提交项目定义的异步音频任务；
- `GET /api/v1/audio/{id}` 查询音频状态和结果；
- `POST /api/v1/videos` 按 OpenRouter 风格提交异步视频任务；
- `GET /api/v1/videos/{id}` 查询状态；
- `GET /api/v1/providers` 查询已支持服务及其授权状态；
- `GET /api/v1/providers/{provider}/models` 单独查询某个服务的模型和能力；
- `duration`、`resolution`、`aspect_ratio`、`frame_images`、`input_references`；
- `provider_options` 传递 provider 特有参数；
- `Idempotency-Key` 防止调用方重试造成重复提交。

### OpenAI 风格：兼容协议

同时提供 OpenAI Images / Videos API 兼容入口：

- `POST /v1/images/generations`：同步等待并返回图片 URL；
- `POST /v1/videos`；
- `GET /v1/videos/{id}`；
- 逐步兼容 edit、extend 和 remix 等标准视频操作。

这样现有 OpenAI 客户端可以通过修改 `base_url` 和 `model` 尽量直接复用。Seed Audio 同时覆盖语音、音效和音乐设计，不等同于文字转语音，因此使用异步音频任务接口；OpenAI 当前没有表达的多参考图、首尾帧、通用音频生成和 provider 参数，使用 OpenRouter 风格接口，不强塞进 OpenAI 对象。

详细判断见 [协议兼容性](docs/protocol-compatibility.md)，接口草案见 [OpenAPI](openapi/openapi.yaml)。

## 无需 npm 的独立程序

普通用户不需要安装 Node.js、npm、Dreamina CLI 或 LibTV CLI。GitHub Releases 提供包含 Node.js 运行时的 macOS、Linux 和 Windows 独立程序；下载对应平台制品后即可直接启动本地 API。

即梦和 LibTV 插件需要官方 CLI。用户明确安装对应插件时，`shortdrama-router` 会识别当前平台、从官方地址下载 CLI，并安装到自己的应用数据目录。程序始终使用这个受管理的绝对路径，不修改 `PATH`、shell profile 或其他应用配置，也不会回退到用户以前安装在 `~/.local/bin`、`~/.libtv` 或 `PATH` 中的 CLI。小云雀直接使用 HTTP 能力，不需要额外运行时。

独立程序中的 Provider 安装操作可以由宿主产品的插件界面调用，也可以直接由本地管理员执行：

```bash
./shortdrama-router providers install jimeng
./shortdrama-router providers install libtv
```

独立程序和 npm CLI 使用同一套接口。运行时也可以通过本地管理 API 安装：

```http
GET  /api/v1/providers/{provider}/runtime
POST /api/v1/providers/{provider}/runtime
```

安装后仍需按 provider 的官方流程完成账号授权。普通业务只需要调用安装、授权和生成接口，不需要读取 CLI 路径或实现任何回退逻辑。`DREAMINA_CLI_PATH` 和 `LIBTV_CLI_PATH` 仅作为开发者显式覆盖。

## npm 使用

npm 包面向需要嵌入 Node.js 业务的开发者；它不是普通用户安装独立程序的前置条件。`packages/sdk` 提供名为 `shortdrama-router` 的聚合 SDK，一次导出 router、HTTP handler、运行时管理和全部内置 provider：

```bash
npx shortdrama-router providers
npx shortdrama-router providers --probe
npx shortdrama-router providers install libtv
```

该命令列出当前支持的服务及其授权状态；`--probe` 会实时验证已经配置的凭证，`--json` 可供其他程序读取。

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
const models = await router.listProviderModels("xiaoyunque")
const handle = createRouterHttpHandler(router)
```

即使尚未授权，内置 provider 也会出现在服务列表中，因此业务可以分别展示“支持但未授权”“授权有效”“授权失效”等状态。

直接启动本地 HTTP API：

```bash
export XYQ_ACCESS_KEY="<your-xiaoyunque-access-key>"
export LIBTV_PROJECT_UUID="<your-libtv-canvas-uuid>"
export SHORTDRAMA_ROUTER_KEY="<your-local-router-key>"
npx shortdrama-router serve --host 127.0.0.1 --port 8080
```

默认只监听 `127.0.0.1:8080`。绑定到非回环地址时必须配置 `SHORTDRAMA_ROUTER_KEY`。

## 调用示例

Seed Audio 异步生成：

```bash
curl http://localhost:8080/api/v1/audio \
  -H "Authorization: Bearer $SHORTDRAMA_ROUTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "xiaoyunque/seed-audio-1.0",
    "prompt": "3秒，清脆的玻璃风铃在安静房间里响三下，无人声，无背景音乐。",
    "format": "mp3"
  }'
```

创建成功后，通过 `GET /api/v1/audio/{id}` 查询任务。小云雀 Seed Audio 目前是漫剧画布能力，要求用户在本机授权 `browser_session`；Access Key 仍优先用于其已支持的生图和生视频 API。

建议为创建请求设置 `Idempotency-Key`。同一个键和同一个规范化请求会返回原任务；同一个键对应不同请求时返回 `idempotency_conflict`。默认内存任务存储只保证当前进程内幂等，生产环境需要注入支持原子 `claim` / `compareAndSet` 的持久化 store。

OpenAI 风格生图：

```bash
curl http://localhost:8080/v1/images/generations \
  -H "Authorization: Bearer $SHORTDRAMA_ROUTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "xiaoyunque/seedream-4.5",
    "prompt": "雨后的上海街道，电影感漫剧分镜",
    "size": "1024x1024",
    "n": 1
  }'
```

异步生图可使用 `POST /api/v1/images`，再通过 `GET /api/v1/images/{id}` 查询任务。

LibTV 生图使用同一个 OpenAI Images 入口，只需要切换模型。LibTV 模型来自官方 CLI 的实时 provider catalog：

```bash
curl http://localhost:8080/v1/images/generations \
  -H "Authorization: Bearer $SHORTDRAMA_ROUTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "libtv/lib-image-2",
    "prompt": "一只绿色陶瓷杯放在浅灰桌面上，柔和自然光，无文字",
    "size": "1024x1024",
    "n": 1,
    "provider_options": {
      "settings": { "quality": "low", "resolution": "1K" }
    }
  }'
```

OpenAI 风格：

```bash
curl http://localhost:8080/v1/videos \
  -H "Authorization: Bearer $SHORTDRAMA_ROUTER_KEY" \
  -F "model=xiaoyunque/seedance-2.5" \
  -F "prompt=雨后的上海街道，电影感缓慢推镜"
```

OpenRouter 风格：

```bash
curl http://localhost:8080/api/v1/videos \
  -H "Authorization: Bearer $SHORTDRAMA_ROUTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "xiaoyunque/seedance-2.5",
    "prompt": "水墨风漫剧分镜，人物回头，镜头缓慢推进",
    "duration": 5,
    "resolution": "720p",
    "aspect_ratio": "9:16"
  }'
```

实际模型和支持参数按服务查询，例如 `/api/v1/providers/xiaoyunque/models`。项目不提供把所有三方模型混在一起的全局 `/models` 列表。

LibTV 与即梦都通过各自官方本地 CLI 工作：

- 安装 Provider 插件时由 router 自动下载对应平台的 CLI，不要求用户另外安装 npm 或修改系统 PATH；
- LibTV：完成安装后执行官方 OAuth 登录，并通过配置 API 选择生成节点所在画布；
- 即梦：完成安装后使用官方 OAuth Device Flow。即梦官方 CLI 当前仅向高级会员开放生成，普通 Web 登录仍可使用官网，但不会获得 CLI 生成权限。

## 服务与授权状态

- `GET /api/v1/providers`：查询所有已安装 provider；
- `GET /api/v1/providers?probe=true`：同时实时验证可验证的授权；
- `GET /api/v1/providers/{provider}/authorization`：查询单个服务授权状态；
- `GET /api/v1/providers/{provider}/authorizations`：分别查询 API Key、OAuth、浏览器会话等授权方式；
- `POST /api/v1/providers/{provider}/authorization`：开始该服务支持的交互式授权；
- `PUT /api/v1/providers/{provider}/authorization`：在本机完成授权；
- `DELETE /api/v1/providers/{provider}/authorization-requests/{id}`：取消未完成的授权流程；
- `DELETE /api/v1/providers/{provider}/authorization`：清除本地授权；
- `DELETE /api/v1/providers/{provider}/authorizations/{method}`：只清除一种授权方式；
- `GET /api/v1/providers/{provider}/resources`：发现项目、画布等可选资源；
- `GET|PUT|DELETE /api/v1/providers/{provider}/configuration`：查询、选择或清除运行配置；
- `GET /api/v1/providers/{provider}/models`：只查询该服务的模型。
- `GET /api/v1/providers/{provider}/runtime`：查询由 router 管理的官方 CLI 运行时；
- `POST /api/v1/providers/{provider}/runtime`：按当前平台下载并安装官方 CLI 运行时。

授权状态包括 `not_configured`、`configured`、`valid`、`expiring`、`expired` 和 `error`。无法可靠验证时保持 `configured`，不会猜测为有效。

## 费用与会员额度

费用不是统一协议的前置条件：

- OpenRouter 风格上游能返回费用时，映射到标准 `usage`；
- OpenAI Videos API 没有统一的第三方积分字段，兼容对象中不强行增加；
- provider 不提供可靠费用时，不猜测、不返回伪精确数字；
- 余额查询、会员积分和促销额度属于 provider 能力，不作为视频生成 API 的必选部分；
- 会员积分和活动权益由对应 adapter 按 provider 实际支持情况呈现，核心视频接口不依赖这些能力。

## Provider 原则

当前与首批目标包括：

- `xiaoyunque/*`：已实现用户主动登录后创建官方 Access Key、Seedream/Nova 生图、Seedance 生视频及音频参考、Seed Audio 语音/音效/音乐生成、本地 Web 会话授权、模型发现、授权状态、任务提交和轮询；
- `libtv/*`：已通过受管理的官方 `libtv` CLI 接入实时模型发现、OAuth 本地状态、项目发现与选择、生图和生视频；每次生成在用户选择的 LibTV 项目中创建独立节点；
- `jimeng/*`：已通过受管理的官方 `dreamina` CLI 接入 OAuth Device Flow、积分授权探测、图像与视频模型发现、异步提交和结果查询；
- `kling/*`：路线图，尚未包含在当前 npm 版本中。

接入优先级：官方 API Key / OAuth → 官方 access key → 用户本地授权会话。每个 adapter 对外声明自己的授权类型和支持能力。

## 授权方式

官方 API Key、OAuth 或 access key 是首选授权方式。

小云雀默认使用主动授权：调用方打开 adapter 返回的官方登录页，用户亲自完成登录后，本地授权宿主自动完成连接。adapter 会通过小云雀官方网页能力创建 Access Key，用户不需要自行查找、复制或粘贴 AK；登录会话只作为本次授权的临时材料，不保存为长期凭证。默认 Access Key 有效期为 30 天，可在 adapter 配置中选择官网支持的 7、30、90 或 365 天。

当官方 API 暂未覆盖 Web 端已有能力时，provider adapter 可以使用用户在本机主动授权的浏览器会话。会话凭证只在用户设备上由对应 adapter 使用，不上传、不经过远程服务，也不写入任务请求或生成结果。

本地会话使用系统安全存储或加密文件保存，并支持过期、更新和立即撤销。详细要求见 [安全策略](SECURITY.md)。

目录划分、依赖方向和 provider 接口见 [架构说明](docs/architecture.md)。AI coding 在修改代码前必须先阅读 [AGENTS.md](AGENTS.md)。

## 免责声明

`shortdrama-router` 是独立的开源兼容层，与 OpenAI、OpenRouter、LiblibAI / libtv、字节跳动 / 小云雀 / 即梦 / 火山引擎、快手 / 可灵及其他 provider 不存在隶属、合作、认可或代理销售关系。

本项目不会托管、转售或赠送第三方账号及额度，也不保证非公开接口长期可用。用户必须只连接自己有权使用的账号和凭证，并自行遵守 provider 服务条款、当地法律、内容审核、知识产权、肖像权、隐私保护、生成内容标识和商业使用要求。

OpenAI-compatible / OpenRouter-compatible 仅描述接口形态，不代表官方认证，也不保证覆盖对应 API 的每个字段。

默认实现不会代替用户判断账号权益、用途授权或生成内容许可。持久化任务 store 可能包含提示词、provider 参数和素材引用；宿主应用负责加密、保留期限与删除策略，且不得把凭证或本地路径写入任务记录。

## 非目标

- 共享、出租、转售或批量轮换第三方账号；
- 抹除生成内容水印、来源信息或平台要求保留的标识；
- 为了“统一”而隐藏模型能力差异；
- 自创一套与现有 SDK 无法兼容的视频任务协议。

## License

[MIT](LICENSE)
