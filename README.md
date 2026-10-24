# @petercjl/sealseek-media-cli

通过 SealSeek 执行图像、视频和画板操作，提供认证、参数校验与任务恢复。

面向具备所需执行能力的任意 Agent；Node.js 22+。当前 Agent 识别自己的 Skill 目录、能力与注册方式。

## 安装

把下面这句话发送给当前 Agent：

> 请安装 npm 包 @petercjl/sealseek-media-cli。

安装同时包含工具、完整 Skill 和独立运行依赖。Agent 核验本地入口、文件与版本，再确认宿主能发现 Skill。

## 更新

> 请更新 npm 包 @petercjl/sealseek-media-cli。

每次更新只处理明确选中的当前 Agent，保留自定义元数据与更新前备份。同版本也会检查和修复 Skill。自动检测默认提示；自动安装需要单独授权。

## 使用

附上所需参考材料，并说明生成目标、模型选择和输出要求。

> 请使用 sealseek-media，按所附材料和本次要求生成图片。

账号、服务访问与付费生成按各自授权执行。安装不授予服务权限。

## Agent 执行合同

[安装合同](INSTALL.md) · [更新与恢复合同](UPDATE.md)。CLI 通过 `skill source --json` 返回规范来源。安装后的 Skill 使用自身 `scripts/run.mjs`，运行代码与依赖位于自身 `.runtime`。宿主适配记录能力差异与实际测试证据，不作为支持白名单。
