# @petercjl/sealseek-media-cli

SealSeek image/video generation for Codex and WorkBuddy. The user configures provider routing in their Agent: this package can serve as a default, backup or task-specific provider.

Requires Node.js 22+, valid SealSeek media authentication, and network access. Normal media operations read the managed credential profile or current-user `.sealseek/sealseek.json`. Override desktop discovery with `SEALSEEK_MEDIA_DESKTOP_CONFIG`, `SEALSEEK_MEDIA_SERVER`, or `--config`/`--server`. Credentials stay external and never enter task records.

Authentication is available with `sealseek-media auth login --json`. The private loopback page uses phone verification-code login through the official PLUGIN channel. Web, desktop and CLI coexistence was verified on macOS with SMS login. CLI authorization has one fixed channel; the provider's CLIENT device field does not select the desktop session channel. Credentials are verified and saved outside the package. Follow `auth status --login-id ID --json`, then `auth status --live --json`. Existing installations authorized through an older channel need one new `auth login`. The desktop application need not run. This uses the provider's existing login flow, not an independent OAuth client.

Expiry metadata comes from the JWT; the service may revoke credentials earlier. `AUTH_REQUIRED`, `AUTH_EXPIRED` and `AUTH_REJECTED` distinguish missing/logout, local expiry and server rejection. `auth logout --yes` backs up plugin credentials and blocks desktop fallback. Add `--desktop` only when authorized to back up and remove the desktop media authentication headers. Credentials, login sessions and backups are never packed. Login is separate from authorization to generate media.

Install the public npm package and its managed portable Skill:

```bash
npm install -g @petercjl/sealseek-media-cli
sealseek-media skill install --agent codex --json
sealseek-media skill install --agent workbuddy --json
sealseek-media doctor --live --json
sealseek-media capabilities --live --json
```

One canonical Skill is bundled and available for normal Agent discovery. Installation does not set provider priority or edit global routing rules. Real generation requires `--submit`; ordinary generation commands default to read-only validation. Legacy `--via sealseek` remains optional for compatibility.

In WorkBuddy, enable the installed Skill if disabled. The Agent may use it according to your configured routing, or you may select `/sealseek-media` manually. Configure a default or backup provider through your Agent's persistent rules; a one-off provider choice remains specific to that task. Runtime evidence covers real image/video generation through Codex on macOS and WorkBuddy discovery, dry-run and existing-task retrieval. Windows package tests pass; Windows real media generation and SealSeek as the calling Agent remain unverified.

```bash
sealseek-media image generate --model gpt-image-2.5-sunburst --prompt "A red ceramic mug on a white background" --resolution 1K --count 1 --output ./media --dry-run --json
```

After explicit authorization, replace `--dry-run` with `--submit`. Query the returned task ID with `task get` or bounded `task wait`. See the Skill and `--help` for reference upload, video, recovery and download. Generation consumes SealSeek credits.

Private local task records live in current-user `.local/state/sealseek-media` or `SEALSEEK_MEDIA_STATE_DIR`. They contain prompts/reference paths; permissions are private. Existing output files are preserved. A lost connection never triggers an automatic generation retry.

`skill source/status/install/update` manages copies, recoverable backups and hashes. `update check/install` updates packaged installations and synchronizes default managed Skill locations. Custom paths require explicit synchronization. Git checkouts stay Git-managed. Local edits and customized metadata are preserved or backed up.

Development: `npm ci --ignore-scripts`, `npm test`, `npm pack --dry-run`. macOS is the initial runtime target. Windows runtime is unverified. Publication uses a separately authorized GitHub Actions Trusted Publishing workflow.

## Automatic updates

Global npm installations automatically check the stable npm `latest` channel on CLI invocation, at most once per 24 hours. A newer stable version is downloaded and installed before the requested command runs; the command then runs once through the new CLI. Existing managed default-location Skills are synchronized with backups and customized UI metadata preserved. Generation and login workers do not run updates. Active tasks/login workers delay installation. Git checkouts and non-global installations stay managed by their existing package manager.

Offline checks and update failures report a diagnostic on stderr and retain the ordinary command path. Local Skill edits delay automatic installation until reviewed; automatic updates never force Skill replacement. Package backups are stored privately in the state directory under `package-backups`; Skill backups use `skill-backups`. To recover after a failed installation, install the previous exact npm version and synchronize managed Skills, or restore the saved package backup. Failed checks retry after the daily interval; active work and local edits are reconsidered on the next invocation. No daemon runs while the CLI is idle.

```bash
sealseek-media update auto status --json
sealseek-media update auto off --json
sealseek-media update auto on --json
sealseek-media update install --yes --json
```

`SEALSEEK_MEDIA_AUTO_UPDATE=0` disables automatic updates for the current process. Automatic installation uses npm with lifecycle scripts disabled and never changes authentication or Agent provider-routing rules.

## Video reference workflow

Use `video guide --model ID --json` and `--reference` when an image supplies visual identity or appearance. `--first`/`--last` express exact frame constraints. Seedance 2.5 supports reference-image input and lacks first/last-frame support in the current provider catalog. If the default or human-selected model cannot satisfy a strict frame requirement, report the limitation and wait for an explicit human model or parameter choice.

After a failure, use `task diagnose ID --json`; sanitized provider errors are retained in task records and ordinary `get/wait` output. Diagnosis never replays generation. `task inspect ID --json` verifies local artifact hashes and obtains actual video specifications through ffprobe when installed. Native request validation does not prove provider acceptance; actual pixel dimensions may differ slightly from the requested ratio.

## Model parameters

```bash
sealseek-media models list --live --json
sealseek-media models show MODEL_ID --live --json
sealseek-media models estimate MODEL_ID --resolution VALUE --json
```

The CLI calls the Infinite Canvas REST service directly for model discovery, uploads, generation, task polling and history. It ships no MCP client. The live catalog covers 3 image and 2 video models, with model-specific resolutions, ratios, durations and references. Video/audio references, audio generation have explicit inputs where supported. Model-specific advanced parameters use `--video-options JSON_FILE`, validated before submission. Dedicated image quick-edit, text detection and text replacement are also exposed. See the bundled Skill’s `references/models.md` for current limits and verified cases.

Submission saves both the local task UUID and provider task ID before polling. `task resume ID --json` queries the existing remote task after a credential or worker interruption; it never generates again. Historical tasks from previous releases can still be read and their stored outputs downloaded.

Explicit pixel size is rejected: a real native request for 1024x1536 returned 2048x2048. Use catalog ratio/resolution choices and inspect actual output. Camera controls and inpainting masks are not exposed by this CLI. Read-only estimates and catalog validation do not prove provider execution. Provider task records identify the selected model but do not independently attest the served model.


Generation defaults to GPT Image 2.5 Sunburst (`gpt-image-2.5-sunburst`) for images and Seedance 2.5 (`doubao-seedance-2-5`) for videos. Image alternatives are Nano Banana Pro (`nano-banana-pro`) and GPT Image 2.5 Flare (`gpt-image-2.5-flare`); the video alternative is Seedance 2.0 (`doubao-seedance-2-0`). The Agent passes `--model` only for a model explicitly named by the human; otherwise it omits the flag and uses the default. Task suitability, text rendering, quality, price and recovery do not authorize selecting alternatives. The package allowlist controls offline/live discovery, estimates and generation workers before upload or submission. `image edit` also preserves the default or explicitly selected model. GPT Image edits use reference-image generation; Nano Banana Pro explicitly selected by the human uses quick-edit. Dedicated text replacement requires an explicit supported model; the default returns an unsupported-feature error rather than switching models.

## Automatic video reference preparation

Pass ordinary reference images with `--reference` (or supported first/last-frame inputs). Before submitting a Seedance video, the CLI automatically uploads local images, invokes Infinite Canvas person/multiple-face detection and asset review, waits for approval, and uses the approved material URI. No extra command or user parameter is required. Unchanged references reuse privately cached, provider-verified materials. Review failure stops generation and is shown in task diagnostics. Dry-run does not upload or review.

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
