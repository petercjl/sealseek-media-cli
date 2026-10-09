# @petercjl/sealseek-media-cli

SealSeek image/video generation for Codex and WorkBuddy. The user configures provider routing in their Agent: this package can serve as a default, backup or task-specific provider.

Requires Node.js 22+, valid SealSeek media authentication, and network access. Normal media operations read the managed credential profile or current-user `.sealseek/sealseek.json`. Override desktop discovery with `SEALSEEK_MEDIA_DESKTOP_CONFIG`, `SEALSEEK_MEDIA_SERVER`, or `--config`/`--server`. Credentials stay external and never enter task records.

Web authentication is available with `sealseek-media auth login --json`. The returned private loopback page defaults to phone verification-code login through the official CLIENT channel. The CLI verifies the account session before saving credentials outside the package. Follow `auth status --login-id ID --json`, then `auth status --live --json`. CLIENT + SMS credentials were verified to remain valid after a web login. `--method wechat` selects QR login; QR and SMS have different session behavior. `--device web` explicitly selects the web channel. The desktop application need not run. This is the provider's existing login flow, not an independent OAuth client.

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

Use `video guide --model ID --json` and `--reference` when an image supplies visual identity or appearance. `--first`/`--last` express exact frame constraints. Seedance 2.5 supports reference-image input and lacks first/last-frame support in the current provider catalog. Choose a compatible model for a strict frame requirement.

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


Generation defaults to GPT Image 2.5 Sunburst (`gpt-image-2.5-sunburst`) for images and Seedance 2.5 (`doubao-seedance-2-5`) for videos. Image alternatives are Nano Banana Pro (`nano-banana-pro`) and GPT Image 2.5 Flare (`gpt-image-2.5-flare`); the video alternative is Seedance 2.0 (`doubao-seedance-2-0`). Select alternatives explicitly with `--model`; there is no automatic model fallback. The package allowlist controls offline/live discovery, estimates and generation workers before upload or submission. Dedicated quick editing and text replacement use Nano Banana Pro.

## Automatic video reference preparation

Pass ordinary reference images with `--reference` (or supported first/last-frame inputs). Before submitting a Seedance video, the CLI automatically uploads local images, invokes Infinite Canvas person/multiple-face detection and asset review, waits for approval, and uses the approved material URI. No extra command or user parameter is required. Unchanged references reuse privately cached, provider-verified materials. Review failure stops generation and is shown in task diagnostics. Dry-run does not upload or review.

## Conversation canvases

Use a stable `--session CONVERSATION_ID` for every generation/edit in one Agent conversation. The first real submission creates and binds one canvas; subsequent requests reuse it. Dry-run creates no canvas. The Agent obtains its native conversation ID or creates one identifier once and retains it throughout the conversation. Starting a new canvas requires an explicit user request.

```sh
sealseek-media image generate --session CONVERSATION_ID --prompt "A ceramic cup" --dry-run --json
sealseek-media image generate --session CONVERSATION_ID --prompt "A ceramic cup" --submit --json
sealseek-media video generate --session CONVERSATION_ID --prompt "A slow camera move" --duration 5 --submit --json
```

To start another canvas in the same conversation:

```sh
sealseek-media canvas create --title "New project" --submit --json
sealseek-media canvas use RETURNED_CANVAS_ID --session CONVERSATION_ID --yes --json
```

`--canvas ID` explicitly targets an existing canvas. Without `--session` or `--canvas`, requests reuse the account default canvas. Bindings are scoped by service account, so switching accounts cannot reuse another account’s canvas. A missing bound canvas stops with an error; automatic replacement is not performed.

`canvas list`, `canvas get ID`, and `canvas tasks ID` inspect boards and generation history. Results contain `canvas_id`, `canvas_url`, and `canvas_saved`. Successful media are appended as visible elements in submission order, left to right, with at most five image/video elements per row. Existing elements and settings are preserved; each save has a private content backup. Avoid simultaneous manual editing while the CLI saves: the service offers no atomic revision check. If `canvas_sync_error` is present, use `task sync TASK_ID --json` to archive the saved outputs again without generating or charging again. Repeated archival preserves existing elements, including deleted ones. Unknown canvas-creation outcomes require inspecting `canvas list` and explicitly binding the existing canvas with `canvas use`.

Canvas layout uses 48 canvas units between elements and rows, top-aligns each row, and starts the next row below the tallest element. Image and video each count as one element. Submission time determines order, including parallel requests; outputs in a batch keep their returned order. Each archival reflows CLI media. Other user elements retain their positions; CLI rows are placed below them. To organize existing CLI media without generation, use `sealseek-media canvas arrange ID --submit --json`. Legacy records recover submission order from local tasks when available; otherwise existing element order is preserved.
