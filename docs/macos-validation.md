# macOS 验证记录

日期：2026-10-08。包版本：0.1.0。npm 发布尚未进行。

## 路由和配置

Codex 生图默认使用内置 imagegen；生视频默认使用 seedancecli 0.3.1 和当前 seedance-video Skill。系统级 AGENTS.md 已明确这两条默认路由，以及只有人类显式选择 SealSeek 时才使用本包的备选路由。默认服务故障保持原路由。

本包读取当前用户已登录的 SealSeek 桌面配置，连接其中的媒体 MCP 服务，实时发现 generate_image、generate_video、create_upload_urls 和 list_artifacts。配置、凭据及私有任务记录均不进入 npm 包。初始传输支持图片参考、首帧和尾帧；音频与视频参考尚未实现。

## 已验证结果

- SealSeek macOS 6.2.3：实时发现、参数干跑、真实生成及本地下载成功。
- 真实图片：gpt-image-2，1 张，1K；PNG 可打开，目视为红色陶瓷杯。
- 真实视频：doubao-seedance-2-0，请求 4 秒、480p；返回 H.264/AAC MP4，864×496，4.063 秒，可解码。输出分辨率按真实文件记录，不将请求参数当作最终尺寸。
- CLI 通过全局安装入口运行；Codex 和 WorkBuddy 的 Skill 安装状态、所有权和哈希可检查。
- 模拟 MCP 集成验证了干跑不提交、不上传，显式提交、参考上传、任务跟踪、重复请求复用及已有文件保护。
- Skill 生命周期验证了首次安装、重复安装、本地修改保护、备份、锁定目录更新和 UI 元数据保留。
- 异常恢复验证了工作进程丢失时保留不确定状态或可下载 URL，不自动重新生成。

## 验证边界

当前仅 macOS 进行了真实服务验证。Windows 及 SealSeek 作为调用方的 Agent 流程尚未验证。自动化测试使用隔离临时目录和模拟服务，不能证明每个供应商模型都支持其说明中全部参数。模型字段代表所请求的模型，actual_model 仅在服务可验证返回时记录；消费积分没有可靠返回值。

npm 压缩包已在独立临时目录安装，包内 CLI 的版本、canonical Skill 来源、WorkBuddy Skill 安装与真实服务发现均通过。压缩包仅包含运行时、Skill、README、LICENSE 和 package.json，共 16 个文件；测试输出及本地配置不打包。

已编写 macOS/Windows、Node.js 22/24 的 GitHub Actions QA 工作流；尚未在远程执行，不能视为 Windows 验证证据。发布审计仍缺 Trusted Publishing 工作流及其 QA 依赖门禁，待用户安排 npm 发布时通过 npm-release-kit 配置。审计器目前不接受 workbuddy 目标名，其覆盖由 Skill 合同验证器和桌面实测补充。

WorkBuddy 5.4.7 已通过 `/sealseek-media` 手动选择并加载技能，实际执行版本/来源查询、doctor 与 capabilities 实时服务发现、绿色陶瓷杯图片干跑、已有图片和视频任务查询。两个本地文件的大小与 SHA-256 校验一致。该验证没有新增真实生成；真实生图、生视频已由 Codex 通过同一 CLI 完成。WorkBuddy 使用其 Node.js 22.22.2 运行时；全部 5 项自动化测试也在该运行时通过。

干净上下文的正式 Skill 回归尚未执行。

## Codex 补充验证

2026-10-08 在 Codex 中新增真实文生图与本地首帧图生视频验证。图片返回 1280×720 PNG；视频返回 4.096 秒、864×496 H.264/AAC MP4。下载、任务跟踪、文件 SHA-256 与抽帧目视检查通过，视频保持参考画面并逐渐推进镜头。未显式指定执行路线的提交被 CLI 拒绝。

本次发现桌面服务返回 HTTP 阿里云 OSS 签名上传地址。修复只将该类签名地址升级为 HTTPS，保持路径和查询签名字节；其他外部 HTTP 地址仍拒绝。首次任务在上传前失败，修复后真实首帧上传及视频生成通过。新增签名保留、仿冒域名及 URL 凭据拒绝测试，全部 6 项回归通过。修复后的 npm 压缩包已独立安装，并验证包含当前上传处理逻辑。npm 尚未发布。
