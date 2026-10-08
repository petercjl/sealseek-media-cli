# CLI contract

For explicit SealSeek requests, inspect `sealseek-media capabilities --live --json`. Use exact advertised model IDs. Model availability and descriptions can change.

Authentication: `auth status --json` reports source and local expiry metadata without printing secrets. `auth status --live --json` verifies a real read-only provider call. Missing credentials return `AUTH_REQUIRED`, locally expired JWTs return `AUTH_EXPIRED`, and server-side rejection (including HTTP 200 with body code 401) returns `AUTH_REJECTED`.

`auth login --json` returns a loopback webpage and login ID. The user scans the official WeChat QR to sign in to an existing account; the worker polls SealSeek, verifies media access, and privately stores the fresh token outside the package. Follow `auth status --login-id ID --json`; expired sessions require a fresh login, and accounts needing phone binding use the official login page first. This is the provider's existing QR login flow, not a declared OAuth/PKCE client. No password is collected. Login does not submit media tasks or grant permission for an additional generation.

`auth logout --yes` privately backs up and removes plugin credentials and blocks desktop fallback until login. `--desktop` additionally backs up the desktop configuration and removes only its media authentication headers. Default profile: current-user `.config/sealseek-media/auth.json`, override `SEALSEEK_MEDIA_AUTH_FILE`. Explicit desktop config overrides use their own credentials. Backups live under the private state directory's `credential-backups` folder. JWT timestamps are decoded metadata; live server validation remains authoritative.

```bash
sealseek-media image generate --model gpt-image-2 --prompt "A ceramic mug under soft studio lighting" --resolution 1K --count 1 --output ./media --dry-run --json
sealseek-media video generate --model doubao-seedance-2-0 --prompt "Camera slowly pushes toward a ceramic mug" --duration 4 --resolution 480p --output ./media --dry-run --json
```

For human-authorized generation, replace `--dry-run` with `--via sealseek --submit`. Submission returns a local task UUID. Follow that task:

```bash
sealseek-media task get TASK_UUID --json
sealseek-media task wait TASK_UUID --timeout 30 --json
sealseek-media task download TASK_UUID --output ./recovered-media --json
```

Repeat `--reference` for ordered HTTPS image URLs or local PNG/JPEG/WebP/GIF. Video accepts `--first` and `--last` image references. The worker obtains signed upload URLs and uploads bytes outside model context. Local inputs are rehashed before upload. Dry-run performs no upload/generation.

Image count is 1–4; resolution 1K/2K. Video duration is 4–15 seconds, or 4–30 for `doubao-seedance-2-5`; 2.5 accepts 480p/720p. Schema validation cannot prove every model feature. Preserve unsupported material requirements and return an error.

`artifacts list --type image|video --page 1 --limit 10 --json` is read-only recovery. Match provider history to the actual request before claiming a result. Matching submissions reuse saved tasks, including failed/uncertain tasks. `--new` represents a human-requested additional attempt.

`skill source --json` returns the bundled source. `skill install/status/update --agent codex|workbuddy|sealseek --json` manages copies and hashes. Unknown targets and unmanaged directories are refused. Edited copies require review before `--force`; updates create backups and preserve UI metadata.

`update check --json` checks stable registry availability. `update install --yes --json` updates packaged installations via npm and synchronizes known managed default Skill locations. Git checkouts stay Git-managed. Custom paths require explicit `skill update --path`. Updates do not edit Agent global routing rules.
