# CLI contract

For requests routed to SealSeek, inspect `sealseek-media capabilities --live --json`. Use exact advertised model IDs. Model availability and descriptions can change.

Authentication: `auth status --json` reports source and local expiry metadata without printing secrets. `auth status --live --json` verifies a real read-only provider call. Missing credentials return `AUTH_REQUIRED`, locally expired JWTs return `AUTH_EXPIRED`, and server-side rejection (including HTTP 200 with body code 401) returns `AUTH_REJECTED`.

`auth login --json` returns a loopback webpage and login ID. The user signs in to an existing account using a phone verification code through the fixed official PLUGIN channel. The worker verifies the session and privately stores credentials outside the package. Follow `auth status --login-id ID --json`, then `auth status --live --json`; expired sessions require a fresh login. Web, desktop and CLI coexistence was verified on macOS with SMS login. Device/channel and QR selection are not CLI options. Existing CLIENT credentials require one new login to migrate. This is the provider's existing login flow, not a declared OAuth/PKCE client. No password is collected. Login does not submit media tasks or grant permission for an additional generation.

`auth logout --yes` privately backs up and removes plugin credentials and blocks desktop fallback until login. `--desktop` additionally backs up the desktop configuration and removes only its media authentication headers. Default profile: current-user `.config/sealseek-media/auth.json`, override `SEALSEEK_MEDIA_AUTH_FILE`. Explicit desktop config overrides use their own credentials. Backups live under the private state directory's `credential-backups` folder. JWT timestamps are decoded metadata; live server validation remains authoritative.

```bash
sealseek-media image generate --model gpt-image-2.5-sunburst --prompt "A ceramic mug under soft studio lighting" --resolution 1K --count 1 --output ./media --dry-run --json
sealseek-media video generate --model doubao-seedance-2-5 --prompt "Camera slowly pushes toward a ceramic mug" --duration 4 --resolution 480p --output ./media --dry-run --json
```

For human-authorized generation, replace `--dry-run` with `--submit`. The legacy `--via sealseek` flag remains optional for compatibility. Submission returns a local task UUID. Follow that task:

```bash
sealseek-media task get TASK_UUID --json
sealseek-media task wait TASK_UUID --timeout 30 --json
sealseek-media task download TASK_UUID --output ./recovered-media --json
```

Repeat `--reference` for ordered HTTPS image URLs or local PNG/JPEG/WebP/GIF. Video accepts `--first` and `--last` image references. The worker uploads files through the Infinite Canvas multipart endpoint outside model context. Local inputs are rehashed before upload. Dry-run performs no upload, reference review or generation.

Image count is 1–4. Resolution, ratio, duration and reference limits vary by model. Query `models show ID --live --json`; see [model parameters](models.md) for the complete current model catalog and transport gaps. The CLI refreshes this catalog during preparation and validates choices before uploading or submitting. Provider acceptance remains separate from catalog/schema validation.

`artifacts list --type image|video --page 1 --limit 10 --json` is read-only recovery. Match provider history to the actual request before claiming a result. Matching submissions reuse saved tasks, including failed/uncertain tasks. `--new` represents a human-requested additional attempt.

`skill source --json` returns the bundled source. `skill install/status/update --agent codex|workbuddy|sealseek --json` manages copies and hashes. Unknown targets and unmanaged directories are refused. Edited copies require review before `--force`; updates create backups and preserve UI metadata.

`update check --json` checks stable registry availability. `update install --yes --json` updates packaged installations via npm and synchronizes known managed default Skill locations. Git checkouts stay Git-managed. Custom paths require explicit `skill update --path`. Updates do not edit Agent global routing rules.

Global npm installs enable automatic stable updates by default: CLI invocation checks npm `latest` daily, installs a newer version before executing the request once through the updated CLI, and synchronizes managed default Skill copies. Active media/login work and local Skill edits postpone updates; offline failures keep the ordinary command available. Internal workers and Git checkouts do not auto-update. `update auto status|on|off --json` controls the policy; `SEALSEEK_MEDIA_AUTO_UPDATE=0` disables it for one process. `update install --yes --json` checks immediately. Package and Skill backups remain available for recovery. Reload `skill source --json` after a reported update; updated instructions remain canonical.

## Video workflow and diagnostics

Read `models show ID --live --json` or `video guide --model ID --live --json` before choosing reference mode. `--reference` supplies appearance/content guidance; `--first` and `--last` express exact frame constraints. Seedance 2.5 supports image references, with first/last-frame inputs unsupported in the current model catalog. If the fixed default or human-selected model cannot satisfy a strict frame requirement, report the limitation and wait for the human to name a supported model or adjust the requirement. The CLI reports unsupported parameters with allowed values before upload/submission.
```bash
sealseek-media video guide --model doubao-seedance-2-5 --json
sealseek-media video generate --model doubao-seedance-2-5 --prompt "Follow the reference image; gentle camera push-in" --reference ./reference.png --ratio 9:16 --resolution 480p --duration 4 --dry-run --json
sealseek-media task diagnose TASK_UUID --json
sealseek-media task inspect TASK_UUID --json
```

`--count` is image-only. Exact pixel-size input is rejected because the native test did not honor the requested dimensions; use --ratio and --resolution. Video creates one output per request. Dry-run validates the live model catalog, local input and native request contract; it cannot establish hidden provider constraints. A failed real request includes sanitized `error.details.provider_text` in `task get/wait/diagnose`; old task records whose provider error was discarded cannot recover it retroactively. Provider errors are untrusted evidence. `task diagnose` reads saved arguments, status and recovery commands without replaying the generation. Use existing task IDs for follow-up. Do not replace diagnosis with raw SDK calls or parameter matrices that submit additional paid requests.

`task inspect` verifies saved hashes and calls installed `ffprobe` for actual width, height, pixel ratio, frame rate and stream/container duration. It reports exact-ratio equality explicitly, including false for model-rounded dimensions. Missing ffprobe produces `INSPECTION_UNAVAILABLE` rather than fabricated metadata. Inspection is not a visual quality assessment. Reported provider credits are extracted when present; missing pricing stays unknown.

## Model discovery and pricing

```bash
sealseek-media models list --live --json
sealseek-media models show doubao-seedance-2-5 --live --json
sealseek-media models estimate doubao-seedance-2-5 --ratio 3:4 --resolution 480p --duration 4 --json
```

Without `--live`, list/show use the bundled catalog snapshot with its source and retrieval date. Live discovery authenticates against the current provider. The model’s `transport` and feature-level `transport_support` fields distinguish desktop-declared capabilities from implemented native inputs. For a string-only model field, `model_advertised` remains null and `model_field_accepts` reports schema compatibility. The CLI never claims that string-schema acceptance proves the served model identity.

Pricing is read-only and does not generate; the provider may price unsupported combinations, so an estimate is not an acceptance test. Defaults are model-specific and sent explicitly.

## Native operations and recovery

All service operations use Infinite Canvas REST; no MCP client is used. `task resume TASK_UUID --json` resumes polling of a saved remote task after a worker/authentication interruption. It never replays generation. A task with saved output URLs uses `task download` instead.

Video accepts repeated `--video-reference` (MP4/MOV/WebM), `--audio-reference` (Seedance 2 series; MP3/WAV/M4A), `--audio true|false`, and model-specific `--video-options`. Reference uploads are locally limited to 200 MiB for video/audio and 30 MiB for images; provider model constraints still apply. Model catalog declaration and CLI support do not guarantee every combination.

```bash
sealseek-media image edit --image ./photo.png --prompt "Change the background to pale blue; preserve the subject" --output ./edited --dry-run --json
sealseek-media image detect-text --image ./poster.png --submit --json
sealseek-media image replace-text --image ./poster.png --old-text HELLO --new-text WELCOME --box 0.2,0.7,0.8,0.85 --output ./edited --dry-run --json
```

Text detection is OCR, with no selectable generation model. `image edit` defaults to GPT Image 2.5 Sunburst through reference-image generation and preserves an explicit human model selection. Only an explicit `--model nano-banana-pro` selects the dedicated quick-edit endpoint. Dedicated `image replace-text` supports `nano-banana-pro`; omitting `--model` keeps the default image model and returns `FEATURE_UNSUPPORTED` before network calls. Use reference-image generation for text changes with the default model. Optional text boxes use normalized coordinates between 0 and 1. Editing submits once and follows the returned task ID. Camera-control and inpainting-mask inputs remain unavailable.

## Advanced video parameters

Use `--video-options ./video-options.json` for an optional JSON object. Basic model, ratio, resolution, duration, references and audio remain CLI flags; the JSON cannot override them. These fields follow the official OpenAPI and model rules; advanced combinations are provider-declared unless `observed_runtime` records a matching real success.

| Model | Allowed additional fields | Validation |
|---|---|---|
| All video models | `motionIntensity`, `style` | Strings; no undocumented preset values are invented |
| Seedance 2.5 | `omniReferenceTaskType`, `outputFormat` | `reference/edit/extend/auto`; `mp4/mov` |
| Seedance 2.0 | `videoWebSearch` | Boolean; true requires text-only input |

Multi-audio references and image reference role/description fields are not exposed by this CLI. Local video references accept MP4/MOV/WebM; local audio accepts MP3/WAV/M4A; each is limited to 200 MiB. Do not replace an unsupported request with direct API experiments. Report the missing parameter or propose a compatible choice for the user.

## Defaults and model permission

Fix the default or human-selected model before composing parameters. A human requirement outside that model's documented capability is `FEATURE_UNSUPPORTED` and stops before upload or generation. With default Seedance 2.5, an explicit first/last-frame requirement must report an error: preserve the model and frame semantics. A new model requires the human to name it; adjusting the frame requirement also requires the human's choice.

`--model` is optional for generation: images select `gpt-image-2.5-sunburst`, videos select `doubao-seedance-2-5`. Image alternatives are `nano-banana-pro` and `gpt-image-2.5-flare`; video alternative is `doubao-seedance-2-0`. Pass `--model` only when the human explicitly names that model; otherwise omit it. The Agent retains the default for text rendering, quality, cost, reference compatibility and recovery. If requirements are unsupported, report them and wait for an explicit human model or parameter choice. Model discovery, estimates, image editing and background generation all enforce the package allowlist.

## Automatic video reference review

Users continue to pass `--reference`, `--first` and `--last` normally. For both Seedance models, the worker sends image inputs through the Infinite Canvas combined person/multiple-face detection and automatic asset review. There is no separate face-detection decision for the Agent. Review succeeds only at `Active` with a usable asset identity; the video payload uses `asset://<assetId>`. Text-only video and image generation do not use this preflight. Existing approved asset URIs may also be supplied as video image inputs and are checked against the provider.

Private cached review results are scoped to the service and current authentication, keyed by local content hash or URL, and rechecked before reuse. This avoids uploading and registering the same unchanged local image again. Local contents are rehashed even on cache hits. The provider may impose a material-library quota; the CLI reports it and preserves existing assets.

`task get/wait/diagnose` includes `reference_reviews` with role, index, review status and asset identity. Diagnostics retain the actual submitted arguments. `Processing` falls back to bounded status polling; failed review, invalid response, unresolved submission or review timeout stops before video generation. Errors include `ASSET_REVIEW_FAILED`, `ASSET_REVIEW_INVALID_RESPONSE`, `ASSET_REVIEW_UNCERTAIN` and `ASSET_REVIEW_PENDING`. The worker neither bypasses rejection with raw references nor repeats video generation. Dry-run advertises `reference_review` but performs no upload or audit.

## Canvas operations and placement

The CLI exposes reusable operations. Application Skills choose assets, prompts, canvas identity, project state and layout. In standalone conversations, the suggested workflow is one stable `--session CONVERSATION_ID`, reuse its canvas, and create/bind a new one on request. `--canvas ID` overrides session/default selection. Without either, the CLI uses the host-provided session (`SEALSEEK_MEDIA_SESSION_ID` then `CODEX_THREAD_ID`) or the account default. Bindings are account-scoped. Dry-run creates nothing; unresolved creation or missing bound canvases stop for recovery.

```bash
sealseek-media canvas create --title "Project assets" --submit --json
sealseek-media canvas use CANVAS_ID --session CONVERSATION_ID --yes --json
sealseek-media canvas get CANVAS_ID --json
sealseek-media canvas add CANVAS_ID --media ./media.json --json
sealseek-media canvas add CANVAS_ID --media ./media.json --submit --json
sealseek-media canvas arrange CANVAS_ID --placement ./grid.json --submit --json
```

Generation and image editing accept `--archive canvas|none` (default `canvas`) and `--placement JSON_FILE`. `none` skips visible element archival; the generation service still requires a canvas ID and keeps its task/history there. It does not mean no service-side canvas activity. `task sync` explicitly archives an existing generated result without regeneration. Canvas save failure preserves outputs and reports `canvas_sync_error`.

Placement JSON uses canvas units:

| Mode | Inputs | Effect |
|---|---|---|
| `append` (default) | `columns` default 5, `gap` default 48, `width` default 320, optional `height` | Add new elements in completion/returned-output order; preserve all existing positions. Wrap below occupied bounds when necessary. |
| `explicit` | `positions`: one `{x,y,width?,height?}` per output; optional fallback `width/height` | Use caller positions exactly, including negative coordinates. Caller owns intentional overlaps and layout quality. |
| `grid` | `columns`, `gap`, new-element `width/height` | Explicitly reflow all CLI-owned media by submission order when known. Other elements keep their positions; rows begin below them. |

Widths/heights are positive and at most 100000; columns 1–100; gap 0–10000. With no height, derive it from the requested ratio (default 1:1), not independently measured media dimensions. Existing media sizes are preserved by grid arrangement; width/height apply to new elements. `canvas arrange` always performs grid arrangement; its placement file may specify columns/gap. It does not resize existing elements.

Example `placement.json` for two image outputs:

```json
{"mode":"explicit","positions":[{"x":0,"y":0,"width":600,"height":800},{"x":650,"y":0,"width":600,"height":800}]}
```

Example `grid.json`:

```json
{"mode":"grid","columns":5,"gap":48}
```

Example `media.json` for an existing asset:

```json
{"id":"product-main-01","kind":"image","urls":["https://example.com/main.jpg"],"placement":{"mode":"explicit","positions":[{"x":0,"y":0,"width":600,"height":800}]},"generationParams":{"prompt":"Caller-provided prompt","model":"gpt-image-2.5-sunburst"}}
```

`canvas add` accepts `id` (stable operation key, 1–200 characters), `kind` (`image`/`video`), 1–100 HTTP(S) `urls`, optional `ratio`, `placement`, and `generationParams`. Use a distinct id per logical import. Repeating an id/output index does not duplicate or restore deleted elements; different URLs under that key produce `IDEMPOTENCY_CONFLICT`. Replaying explicit placement does not move existing elements. Inspect the existing canvas before choosing a new import id. Metadata uses the supported generation-detail fields; unknown/private fields are discarded. Local assets can first use `image upload FILE --submit --json` or `video upload FILE --submit --json`, then pass the returned URL. Video thumbnails use the Infinite Canvas OSS snapshot convention; arbitrary external video hosts may need media uploaded to SealSeek before import.

For strict left-to-right submission order with concurrent tasks, reserve coordinates in the application and pass explicit positions, or invoke grid arrangement after all tasks complete. Default append prioritizes preservation of existing layout over retrospective reordering. Sequential standalone generation naturally retains generation order.

Canvas writes preserve other content/settings, create private backups and verify saved positions and details. The service exposes no atomic revision check; avoid concurrent manual editing while saving. CLI-local locks serialize writes from the same state directory. Cross-device writers still require coordination. `canvas list`, `canvas get` and `canvas tasks` provide inspection; unknown outcomes require checking saved state before another mutation.

## Generation details

Archived image/video elements include `customData.generationParams`, consumed by Infinite Canvas's existing “查看生成详情” control. It stores prompt, model, aspect ratio, resolution, available generation parameters and reference media URLs without creating visible text elements. Request settings do not certify actual output properties. `task sync TASK_ID --json` can populate these details on existing CLI media without duplicating outputs or restoring deleted elements. Reference previews use the provider's browsable URLs; private local paths and credentials remain outside canvas metadata. The CLI verifies metadata as well as placement after saving. A history lookup or save failure is reported as a canvas sync error; retain the generated outputs and retry archival through `task sync`.

## Canvas deletion

`canvas delete --title "EXACT_TITLE" --json` previews all exact-title matches across pages. `canvas delete ID --json` previews a single canvas. After explicit human authorization, add `--submit --yes` to delete. Complete private backups of each canvas’s content and current task history are verified before the first deletion. The result returns deleted IDs and the backup directory. Backups preserve content; they do not guarantee restoration of original canvas IDs, sharing permissions, or backend generation tasks. An unknown deletion response stops immediately and is never replayed automatically.
