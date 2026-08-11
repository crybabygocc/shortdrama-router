# shortdrama-router

**把 libtv、小云雀、即梦、可灵等漫剧与视频创作平台，路由成 OpenRouter / OpenAI 风格的音频、图片与视频生成 API。**

`shortdrama-router` 是一个面向漫剧、AI 短剧和视频工作流的开源 API 路由器。业务只需要接入一套熟悉的视频任务协议，就可以按 `provider/model` 选择不同创作平台；平台账号、模型能力和实际生成仍由用户分别授权的 provider 提供。

`short drama` 直接表达短剧、漫剧和连续叙事视频场景，`router` 表示它采用与 OpenRouter 相同的多 provider 路由思路。仓库名固定使用全小写和中划线：`shortdrama-router`。

> 当前状态：`0.1.0` / pre-alpha。已提供 provider 对齐层、小云雀 Seed Audio、生图和生视频能力、可直接启动的本地 HTTP 服务和可发布的 npm 聚合包；其他 provider 仍在规划中。

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
- `GET /api/v1/videos/{id}/content` 下载结果；
- `GET /api/v1/providers` 查询已支持服务及其授权状态；
- `GET /api/v1/providers/{provider}/models` 单独查询某个服务的模型和能力；
- `duration`、`resolution`、`aspect_ratio`、`frame_images`、`input_references`、`generate_audio`；
- `provider.options` 传递 provider 特有参数；
- provider 能提供费用时，在完成结果中返回 `usage`。

### OpenAI 风格：兼容协议

同时提供 OpenAI Images / Videos API 兼容入口：

- `POST /v1/images/generations`：同步等待并返回图片 URL；
- `POST /v1/videos`；
- `GET /v1/videos/{id}`；
- `GET /v1/videos/{id}/content`；
- 逐步兼容 edit、extend 和 remix 等标准视频操作。

这样现有 OpenAI 客户端可以通过修改 `base_url` 和 `model` 尽量直接复用。Seed Audio 同时覆盖语音、音效和音乐设计，不等同于文字转语音，因此使用异步音频任务接口；OpenAI 当前没有表达的多参考图、首尾帧、通用音频生成和 provider 参数，使用 OpenRouter 风格接口，不强塞进 OpenAI 对象。

详细判断见 [协议兼容性](docs/protocol-compatibility.md)，接口草案见 [OpenAPI](openapi/openapi.yaml)。

## npm 使用

`packages/sdk` 提供名为 `shortdrama-router` 的聚合 npm 包，一次导出 router、HTTP handler 和全部内置 provider：

```bash
npx shortdrama-router providers
npx shortdrama-router providers --probe
```

该命令列出当前支持的服务及其授权状态；`--probe` 会实时验证已经配置的凭证，`--json` 可供其他程序读取。

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

即使尚未授权，内置 provider 也会出现在服务列表中，因此业务可以分别展示“支持但未授权”“授权有效”“授权失效”等状态。

直接启动本地 HTTP API：

```bash
export XYQ_ACCESS_KEY="<your-xiaoyunque-access-key>"
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

## 服务与授权状态

- `GET /api/v1/providers`：查询所有已安装 provider；
- `GET /api/v1/providers?probe=true`：同时实时验证可验证的授权；
- `GET /api/v1/providers/{provider}/authorization`：查询单个服务授权状态；
- `POST /api/v1/providers/{provider}/authorization`：开始该服务支持的交互式授权；
- `PUT /api/v1/providers/{provider}/authorization`：在本机完成授权；
- `DELETE /api/v1/providers/{provider}/authorization`：清除本地授权；
- `GET /api/v1/providers/{provider}/models`：只查询该服务的模型。

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
- `libtv/*`：计划支持会话式视频创作、编辑和复杂 Agent 工作流；
- `jimeng/*`：即梦图像、视频和编辑能力；
- `kling/*`：可灵文生视频、图生视频、参考生成和视频编辑能力。

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

## 非目标

- 共享、出租、转售或批量轮换第三方账号；
- 抹除生成内容水印、来源信息或平台要求保留的标识；
- 为了“统一”而隐藏模型能力差异；
- 自创一套与现有 SDK 无法兼容的视频任务协议。

## License

[MIT](LICENSE)
