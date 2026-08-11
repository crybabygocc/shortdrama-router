# OpenAI / OpenRouter 图片与视频协议兼容性

更新日期：2026-08-11

## 结论

现有协议可以直接复用，不需要为了积分或 provider 管理重新设计一套图片或视频 API。

推荐方案是：

1. 以 OpenRouter Video API 作为多 provider 主协议；
2. 提供 OpenAI Videos API 兼容入口，覆盖其已有标准能力；
3. provider 的高级参数使用 OpenRouter 已定义的 `provider.options`；
4. 费用只映射现有 `usage`，没有可靠来源时直接省略；
5. 会员余额、积分预估和账号管理不进入核心视频协议。

## OpenAI Images API

`POST /v1/images/generations` 作为同步兼容入口，接收 `model`、`prompt`、`n`、`size` 和 `response_format=url`，等待 provider 异步任务完成后返回标准 `{ created, data: [{ url }] }` 对象。

面向需要自行控制轮询的业务，同时提供 `POST /api/v1/images` 和 `GET /api/v1/images/{id}`。多 provider 的模型发现仍然按 provider 分组，不增加全局模型列表。

## OpenAI Videos API 能直接复用什么

OpenAI 当前已经提供独立的视频资源，而不是通过 `/chat/completions` 模拟视频生成：

- `POST /v1/videos`：创建异步视频任务；
- `GET /v1/videos/{video_id}`：查询任务；
- `GET /v1/videos/{video_id}/content`：下载内容；
- `GET /v1/videos`、`DELETE /v1/videos/{video_id}`：列表和删除；
- `/v1/videos/edits`：视频编辑；
- `/v1/videos/extensions`：视频续写；
- `/v1/videos/{video_id}/remix`：基于已有视频重新生成；
- `/v1/videos/characters`：从视频建立可复用角色资源。

基础创建字段包括 `model`、`prompt`、`input_reference`、`seconds` 和 `size`，返回统一的 `video` 任务对象及 `queued / in_progress / completed / failed` 状态。

因此，如果 `shortdrama-router` 严格保持请求 Content-Type、字段、状态、错误和下载响应，现有 OpenAI 客户端只需要替换 `base_url`、API Key 和模型名即可复用。

## OpenAI 协议覆盖不了什么

OpenAI 当前创建接口是为自身视频模型定义的，不是完整的多 provider 视频网关协议。下列能力没有通用字段，不能无损表达所有平台：

| 能力 | OpenAI 创建接口 | 处理方式 |
| --- | --- | --- |
| 文生视频 | 支持 | 直接兼容 |
| 单张参考图 | `input_reference` | 直接兼容 |
| 时长、尺寸 | `seconds`、`size` | 映射到 provider 支持值，不静默降级 |
| 多参考素材 | 没有通用数组 | 使用 OpenRouter `input_references` |
| 首尾帧 | 没有通用字段 | 使用 OpenRouter `frame_images` |
| 原生音频开关 | 没有通用字段 | 使用 OpenRouter `generate_audio` |
| provider 特有参数 | 没有通用容器 | 使用 OpenRouter `provider.options` |
| 多 provider 模型发现 | 通用 `/v1/models` 信息不足 | 先查询 `/api/v1/providers`，再使用 `/api/v1/providers/{provider}/models` |
| 第三方积分与余额 | 没有标准字段 | 不加入核心协议 |

## 为什么 OpenRouter 更适合作为主协议

OpenRouter Video API 已经是面向多模型和多 provider 的异步视频协议，包含：

- `duration`、`resolution`、`aspect_ratio` 和精确 `size`；
- 首帧 / 尾帧 `frame_images`；
- 图片、音频、视频等 `input_references`；
- `generate_audio`、`seed` 和 `callback_url`；
- `provider.options` 受控透传 provider 特有字段；
- 视频模型接口返回支持的分辨率、宽高比、价格 SKU 和允许透传的参数；
- 任务完成后可返回 `usage.cost`。

这已经覆盖了 shortdrama-router 所需的大部分公共层。适配器的主要工作是把这些字段映射到 libtv、小云雀、即梦、可灵，而不是再发明 `provider_options`、积分 quote 或另一套任务状态。

## 兼容边界

“兼容”应按接口逐项声明：

- `openai-videos-core`：创建、查询、下载；
- `openai-images-generation`：同步文生图并返回 URL；
- `router-images-async`：异步生图创建与查询；
- `openai-videos-edit`：编辑；
- `openai-videos-extend`：续写；
- `openai-videos-remix`：重混；
- `openrouter-video-core`：创建、查询和下载；
- `provider-discovery`：服务发现、授权状态和单服务模型查询；
- `openrouter-video-references`：首尾帧与多参考素材；
- `openrouter-video-provider-options`：受控原生参数透传。

某个 adapter 只支持文生视频时，就只声明 core；不能因为路径相同就宣称完整兼容。

## 费用处理

不新增强制费用接口：

- OpenRouter adapter 能从 provider 得到实际费用时，写入现有 `usage`；
- 只能得到 provider 原生积分但无法等价为货币时，可以在 provider 的原生响应或文档中呈现，不污染标准对象；
- OpenAI 兼容响应保持 OpenAI Video 对象，不添加调用方无法识别的必填字段；
- 余额、会员活动和预估扣费可在未来作为可选管理能力，但不能成为生成视频的依赖。

## Provider 授权与协议解耦

调用方始终使用 shortdrama-router 自己的 Bearer Token。Provider 的 API Key、OAuth、access key 或本地用户会话留在对应 adapter 的本地连接配置中，不进入 OpenAI / OpenRouter 请求结构。

这种设计让上层业务不需要感知 provider 的授权差异，也确保浏览器会话凭证不上传到远程服务。

## 资料依据

- [OpenAI Videos API](https://developers.openai.com/api/reference/resources/videos)
- [OpenAI Create image](https://developers.openai.com/api/reference/resources/images/methods/generate)
- [OpenAI Create video](https://developers.openai.com/api/reference/resources/videos/methods/create)
- [OpenRouter Video Generation](https://openrouter.ai/docs/guides/overview/multimodal/video-generation)
- [OpenRouter Create video API](https://openrouter.ai/docs/api/api-reference/video-generation/create-videos)
- [libtv 官方 Agent Skill / OpenAPI 说明](https://github.com/libtv-labs/libtv-skills/blob/main/skills/libtv-skill/SKILL.md)
