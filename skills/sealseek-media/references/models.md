# SealSeek 模型参数

插件提供 3 个生图模型和 2 个生视频模型。实时目录经过插件白名单过滤；参数来源为无限画板实时模型目录和官方 OpenAPI。默认模型在省略 `--model` 时自动写入请求，备选模型通过 `--model` 明确选择。

## 生图模型

| 模型 ID | 用途 | 清晰度档位 | 支持比例 | 参考图上限 |
|---|---|---|---|---|
| gpt-image-2.5-sunburst | 默认 | 1K, 2K, 4K | 1:1, 3:2, 2:3, 3:4, 4:3, 4:5, 5:4, 16:9, 9:16, 21:9 | 16 |
| nano-banana-pro | 备选 | 1K, 2K, 4K | 1:1, 16:9, 9:16, 4:3, 3:4, 21:9, 3:2, 2:3, 5:4, 4:5 | 14 |
| gpt-image-2.5-flare | 备选 | 1K, 2K, 4K | 1:1, 3:2, 2:3, 3:4, 4:3, 4:5, 5:4, 16:9, 9:16, 21:9 | 16 |

图片张数 1–4，默认 1。按目录选取比例和清晰度，实际尺寸以文件检查为准。`--size` 的精确像素控制尚未验证有效，提交前拒绝。本地参考图支持 PNG/JPEG/WebP/GIF，单张不超过 30 MiB；参考数量上限属于目录声明。

## 生视频模型

| 模型 ID | 用途 | 清晰度档位 | 支持比例 | 时长选项（秒） | 参考图上限 | 首帧 / 尾帧 |
|---|---|---|---|---|---|---|
| doubao-seedance-2-5 | 默认 | 480p, 720p, 1080p | 16:9, 9:16, 1:1, 4:3, 3:4, 21:9, adaptive | 4, 5, 6, 8, 10, 12, 15, 20, 25, 30 | 30 | 不支持 / 不支持 |
| doubao-seedance-2-0 | 备选 | 480p, 720p, 1080p | 16:9, 9:16, 1:1, 4:3, 3:4, 21:9, adaptive | 4, 5, 6, 8, 10, 12, 15 | 9 | 支持 / 支持 |

视频每次生成一段，`--count` 为图片参数。`--reference` 是外观或内容参考；`--first` 是首帧约束；`--last` 要求同时提供首帧。图片参考模式与首尾帧模式分别使用。

Seedance 2.5 支持图片参考，当前目录不支持首尾帧。Seedance 2.0 支持图片参考和首尾帧。视频参考使用 `--video-reference`，音频参考使用 `--audio-reference`；Seedance 2.0 音频参考需搭配图片或视频参考，Seedance 2.5 可用纯音频参考。声音生成用 `--audio true|false`，按模型目录校验。

## 高级参数与图片操作

`--video-options JSON_FILE`：通用字段 `motionIntensity`、`style`；Seedance 2.5 支持 `omniReferenceTaskType`（reference/edit/extend/auto）及 `outputFormat`（mp4/mov）；Seedance 2.0 支持 `videoWebSearch`，开启时要求纯文本输入。详见 [CLI contract](cli.md#advanced-video-parameters)。高级组合按官方声明接入，未实测组合明确标记。

`image edit` 与 `image replace-text` 使用 Nano Banana Pro。`image detect-text` 为独立 OCR 文字检测，没有可选择的生图模型；替换可使用检测返回的 0–1 归一化坐标。镜头控制、局部重绘蒙版、多音频参考及图片参考角色字段尚未封装。

## 校验与结果核对

执行 `models show ID --live --json` 获取当前参数，随后使用 `generate --dry-run --json` 校验，通过后加 `--submit` 提交。清晰度默认取目录首个档位，比例默认 1:1，图片默认 1 张；视频默认 5 秒。实时目录读取失败就停止提交。

保持同一任务 ID，使用 `task get/wait` 跟踪，`task diagnose` 诊断，`task resume` 恢复远端查询，`task inspect` 检查本地文件哈希、尺寸和视频时长。服务错误按原任务报告；模型切换需明确授权。模型目录和校验通过不代表所有组合生成成功，输出尺寸和时长可能取整。

## 实测范围

这 5 个保留模型均有无限画板真实生成成功案例。Seedance 2.5 已验证文生视频与图片参考，Seedance 2.0 已验证文生视频与首尾帧。`models show` 的 `observed_runtime` 按接口、参数与完成状态列出案例；参考数量上限和未实测组合保持目录声明状态。
