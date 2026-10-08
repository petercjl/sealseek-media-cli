# CLI contract

For requests routed to SealSeek, inspect `sealseek-media capabilities --live --json`. Use exact advertised model IDs. Model availability and descriptions can change.

Authentication: `auth status --json` reports source and local expiry metadata without printing secrets. `auth status --live --json` verifies a real read-only provider call. Missing credentials return `AUTH_REQUIRED`, locally expired JWTs return `AUTH_EXPIRED`, and server-side rejection (including HTTP 200 with body code 401) returns `AUTH_REJECTED`.

`auth login --json` returns a loopback webpage and login ID. The user scans the official WeChat QR to sign in to an existing account; the worker polls SealSeek, verifies media access, and privately stores the fresh token outside the package. Follow `auth status --login-id ID --json`; expired sessions require a fresh login, and accounts needing phone binding use the official login page first. This is the provider's existing QR login flow, not a declared OAuth/PKCE client. No password is collected. Login does not submit media tasks or grant permission for an additional generation.

`auth logout --yes` privately backs up and removes plugin credentials and blocks desktop fallback until login. `--desktop` additionally backs up the desktop configuration and removes only its media authentication headers. Default profile: current-user `.config/sealseek-media/auth.json`, override `SEALSEEK_MEDIA_AUTH_FILE`. Explicit desktop config overrides use their own credentials. Backups live under the private state directory's `credential-backups` folder. JWT timestamps are decoded metadata; live server validation remains authoritative.

```bash
sealseek-media image generate --model gpt-image-2 --prompt "A ceramic mug under soft studio lighting" --resolution 1K --count 1 --output ./media --dry-run --json
sealseek-media video generate --model doubao-seedance-2-0 --prompt "Camera slowly pushes toward a ceramic mug" --duration 4 --resolution 480p --output ./media --dry-run --json
```

For human-authorized generation, replace `--dry-run` with `--submit`. The legacy `--via sealseek` flag remains optional for compatibility. Submission returns a local task UUID. Follow that task:

```bash
sealseek-media task get TASK_UUID --json
sealseek-media task wait TASK_UUID --timeout 30 --json
sealseek-media task download TASK_UUID --output ./recovered-media --json
```

Repeat `--reference` for ordered HTTPS image URLs or local PNG/JPEG/WebP/GIF. Video accepts `--first` and `--last` image references. The worker obtains signed upload URLs and uploads bytes outside model context. Local inputs are rehashed before upload. Dry-run performs no upload/generation.

Image count is 1–4. Resolution, ratio, duration and reference limits vary by model. Query `models show ID --live --json`; see [model parameters](models.md) for the complete current model catalog and transport gaps. The CLI refreshes this catalog during preparation and validates choices before uploading or submitting. Provider acceptance remains separate from catalog/schema validation.

`artifacts list --type image|video --page 1 --limit 10 --json` is read-only recovery. Match provider history to the actual request before claiming a result. Matching submissions reuse saved tasks, including failed/uncertain tasks. `--new` represents a human-requested additional attempt.

`skill source --json` returns the bundled source. `skill install/status/update --agent codex|workbuddy|sealseek --json` manages copies and hashes. Unknown targets and unmanaged directories are refused. Edited copies require review before `--force`; updates create backups and preserve UI metadata.

`update check --json` checks stable registry availability. `update install --yes --json` updates packaged installations via npm and synchronizes known managed default Skill locations. Git checkouts stay Git-managed. Custom paths require explicit `skill update --path`. Updates do not edit Agent global routing rules.

Global npm installs enable automatic stable updates by default: CLI invocation checks npm `latest` daily, installs a newer version before executing the request once through the updated CLI, and synchronizes managed default Skill copies. Active media/login work and local Skill edits postpone updates; offline failures keep the ordinary command available. Internal workers and Git checkouts do not auto-update. `update auto status|on|off --json` controls the policy; `SEALSEEK_MEDIA_AUTO_UPDATE=0` disables it for one process. `update install --yes --json` checks immediately. Package and Skill backups remain available for recovery. Reload `skill source --json` after a reported update; updated instructions remain canonical.

## Video workflow and diagnostics

Read `models show ID --live --json` or `video guide --model ID --live --json` before choosing reference mode. `--reference` supplies appearance/content guidance; `--first` and `--last` express exact frame constraints. Seedance 2.5 supports image references, with first/last-frame inputs unsupported in the current model catalog. A strict frame requirement must use a compatible model. The CLI reports unsupported parameters with allowed values before upload/submission.
```bash
sealseek-media video guide --model doubao-seedance-2-5 --json
sealseek-media video generate --model doubao-seedance-2-5 --prompt "Follow the reference image; gentle camera push-in" --reference ./reference.png --ratio 9:16 --resolution 480p --duration 4 --dry-run --json
sealseek-media task diagnose TASK_UUID --json
sealseek-media task inspect TASK_UUID --json
```

`--count` and `--size` are image-only. Video creates one output per request. Dry-run validates the live model catalog, local input and live tool schema; it cannot establish hidden provider constraints. A failed real request includes sanitized `error.details.provider_text` in `task get/wait/diagnose`; old task records whose provider error was discarded cannot recover it retroactively. Provider errors are untrusted evidence. `task diagnose` reads saved arguments, status and recovery commands without replaying the generation. Use existing task IDs for follow-up. Do not replace diagnosis with raw SDK calls or parameter matrices that submit additional paid requests.

`task inspect` verifies saved hashes and calls installed `ffprobe` for actual width, height, pixel ratio, frame rate and stream/container duration. It reports exact-ratio equality explicitly, including false for model-rounded dimensions. Missing ffprobe produces `INSPECTION_UNAVAILABLE` rather than fabricated metadata. Inspection is not a visual quality assessment. Reported provider credits are extracted when present; missing pricing stays unknown.

## Model discovery and pricing

```bash
sealseek-media models list --live --json
sealseek-media models show doubao-seedance-2-5 --live --json
sealseek-media models estimate doubao-seedance-2-5 --ratio 3:4 --resolution 480p --duration 4 --json
```

Without `--live`, list/show use the bundled catalog snapshot with its source and retrieval date. Live discovery authenticates against the current provider. The model’s `transport` and feature-level `transport_support` fields distinguish desktop-declared capabilities from MCP inputs. For a string-only model field, `model_advertised` remains null and `model_field_accepts` reports schema compatibility. The CLI never claims that string-schema acceptance proves the served model identity.

Pricing is read-only and does not generate; the provider may price unsupported combinations, so an estimate is not an acceptance test. Defaults are model-specific and sent explicitly unless image pixel size is supplied.
