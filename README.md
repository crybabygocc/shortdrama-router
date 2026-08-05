# shortdrama-router

**把 libtv、小云雀、即梦、可灵等漫剧与视频创作平台，路由成 OpenRouter / OpenAI 风格的视频生成 API。**

`shortdrama-router` 是一个面向漫剧、AI 短剧和视频工作流的开源 API 路由器。业务只需要接入一套熟悉的视频任务协议，就可以按 `provider/model` 选择不同创作平台；平台账号、模型能力和实际生成仍由用户分别授权的 provider 提供。

`short drama` 直接表达短剧、漫剧和连续叙事视频场景，`router` 表示它采用与 OpenRouter 相同的多 provider 路由思路。仓库名固定使用全小写和中划线：`shortdrama-router`。

> 当前状态：协议设计 / pre-alpha。仓库定义的是兼容目标，不代表所有 provider adapter 已经可用于生产环境。

## 为什么使用 shortdrama-router

- **一次接入多个创作平台**：业务不需要分别处理各家的鉴权、参数、异步状态和结果下载；
- **更快使用平台首发能力**：libtv、小云雀、即梦、可灵等创作平台经常比通用聚合 API 更早提供新模型或完整工作流；
- **适合漫剧工作流**：除基础文生视频外，还要逐步覆盖参考图、首尾帧、角色一致性、视频编辑、续写和原生音频；
- **账号与费用归用户所有**：用户分别授权自己的 provider，路由器不出售账号，也不转售额度；
- **可选复用已有权益**：通过各 provider 支持的授权方式连接用户自有账号；已有会员或活动权益若可用，由对应 adapter 直接复用。

## 协议目标

`shortdrama-router` 不另造一套视频协议，优先复用现有标准：

### OpenRouter 风格：主协议

OpenRouter 的视频接口更适合多模型路由，已经定义了：

- `POST /api/v1/videos` 提交异步任务；
- `GET /api/v1/videos/{id}` 查询状态；
- `GET /api/v1/videos/{id}/content` 下载结果；
- `GET /api/v1/videos/models` 查询视频模型、能力与可透传参数；
- `duration`、`resolution`、`aspect_ratio`、`frame_images`、`input_references`、`generate_audio`；
- `provider.options` 传递 provider 特有参数；
- provider 能提供费用时，在完成结果中返回 `usage`。

### OpenAI 风格：兼容协议

同时提供 OpenAI Videos API 兼容入口：

- `POST /v1/videos`；
- `GET /v1/videos/{id}`；
- `GET /v1/videos/{id}/content`；
- 逐步兼容 edit、extend 和 remix 等标准视频操作。

这样现有 OpenAI 客户端可以通过修改 `base_url` 和 `model` 尽量直接复用。OpenAI 当前没有表达的多参考图、首尾帧、原生音频和 provider 参数，使用 OpenRouter 风格接口，不强塞进 OpenAI 对象。

详细判断见 [协议兼容性](docs/protocol-compatibility.md)，接口草案见 [OpenAPI](openapi/openapi.yaml)。

## 调用示例

OpenAI 风格：

```bash
curl http://localhost:8080/v1/videos \
  -H "Authorization: Bearer $SHORTDRAMA_ROUTER_KEY" \
  -F "model=kling/kling-video" \
  -F "prompt=雨后的上海街道，电影感缓慢推镜"
```

OpenRouter 风格：

```bash
curl http://localhost:8080/api/v1/videos \
  -H "Authorization: Bearer $SHORTDRAMA_ROUTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "jimeng/jimeng-video",
    "prompt": "水墨风漫剧分镜，人物回头，镜头缓慢推进",
    "duration": 5,
    "resolution": "1080p",
    "aspect_ratio": "9:16",
    "generate_audio": true
  }'
```

模型名仅为协议示例，实际名称和支持参数以 `/api/v1/videos/models` 返回为准。

## 费用与会员额度

费用不是统一协议的前置条件：

- OpenRouter 风格上游能返回费用时，映射到标准 `usage`；
- OpenAI Videos API 没有统一的第三方积分字段，兼容对象中不强行增加；
- provider 不提供可靠费用时，不猜测、不返回伪精确数字；
- 余额查询、会员积分和促销额度属于 provider 能力，不作为视频生成 API 的必选部分；
- 会员积分和活动权益由对应 adapter 按 provider 实际支持情况呈现，核心视频接口不依赖这些能力。

## Provider 原则

首批目标包括：

- `libtv/*`：会话式视频创作、编辑和复杂 Agent 工作流；
- `xiaoyunque/*`：面向漫剧和短视频的创作工作流；
- `jimeng/*`：即梦图像、视频和编辑能力；
- `kling/*`：可灵文生视频、图生视频、参考生成和视频编辑能力。

接入优先级：官方 API Key / OAuth → 官方 access key → 用户本地授权会话。每个 adapter 对外声明自己的授权类型和支持能力。

## 授权方式

官方 API Key、OAuth 或 access key 是首选授权方式。

当官方 API 暂未覆盖 Web 端已有能力时，provider adapter 可以使用用户在本机主动授权的浏览器会话。会话凭证只在用户设备上由对应 adapter 使用，不上传、不经过远程服务，也不写入任务请求或生成结果。

本地会话使用系统安全存储或加密文件保存，并支持过期、更新和立即撤销。详细要求见 [安全策略](SECURITY.md)。

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
