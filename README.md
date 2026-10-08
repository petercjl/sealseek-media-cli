# @petercjl/sealseek-media-cli

Explicitly selected SealSeek desktop image/video generation for Codex and WorkBuddy. Default Codex routes are imagegen and seedancecli. Activate this package when the user selects SealSeek.

Requires Node.js 22+, valid SealSeek media authentication, and network access. Normal media operations read the managed credential profile or current-user `.sealseek/sealseek.json`. Override desktop discovery with `SEALSEEK_MEDIA_DESKTOP_CONFIG`, `SEALSEEK_MEDIA_SERVER`, or `--config`/`--server`. Credentials stay external and never enter task records.

Web authentication is available with `sealseek-media auth login --json`. Open the returned local webpage, scan the official WeChat QR, and confirm your existing SealSeek account. The CLI verifies media access before saving the token privately in current-user `.config/sealseek-media/auth.json`. Track the login with `auth status --login-id ID --json`; verify access with `auth status --live --json`. SealSeek desktop does not need to keep running. New accounts needing phone binding complete it on the official SealSeek login page first.

Expiry metadata comes from the JWT; the service may revoke credentials earlier. `AUTH_REQUIRED`, `AUTH_EXPIRED` and `AUTH_REJECTED` distinguish missing/logout, local expiry and server rejection. `auth logout --yes` backs up plugin credentials and blocks desktop fallback. Add `--desktop` only when authorized to back up and remove the desktop media authentication headers. Credentials, login sessions and backups are never packed. Login is separate from authorization to generate media.

Install the public npm package and its managed portable Skill:

```bash
npm install -g @petercjl/sealseek-media-cli
sealseek-media skill install --agent codex --json
sealseek-media skill install --agent workbuddy --json
sealseek-media doctor --live --json
sealseek-media capabilities --live --json
```

One canonical Skill is bundled. Codex invocation metadata and WorkBuddy frontmatter restrict automatic selection. Real generation requires `--via sealseek --submit`; ordinary generation commands default to read-only validation.

In WorkBuddy, open the installed Skills list and enable the installed entry if it is disabled, then select `/sealseek-media` explicitly. Its installed frontmatter remains `disable-model-invocation: true`. A request such as “使用 SealSeek 生成一张图片” selects this route; a generic media request keeps the host defaults. Supported runtime evidence currently covers macOS: real image/video generation through Codex, and WorkBuddy discovery, dry-run and existing-task retrieval. Windows and SealSeek as the calling Agent remain unverified.

```bash
sealseek-media image generate --model gpt-image-2 --prompt "A red ceramic mug on a white background" --resolution 1K --count 1 --output ./media --dry-run --json
```

After explicit authorization, replace `--dry-run` with `--via sealseek --submit`. Query the returned task ID with `task get` or bounded `task wait`. See the Skill and `--help` for reference upload, video, recovery and download. Generation consumes SealSeek credits.

Private local task records live in current-user `.local/state/sealseek-media` or `SEALSEEK_MEDIA_STATE_DIR`. They contain prompts/reference paths; permissions are private. Existing output files are preserved. A lost connection never triggers an automatic generation retry.

`skill source/status/install/update` manages copies, recoverable backups and hashes. `update check/install` updates packaged installations and synchronizes default managed Skill locations. Custom paths require explicit synchronization. Git checkouts stay Git-managed. Local edits and customized metadata are preserved or backed up.

Development: `npm ci --ignore-scripts`, `npm test`, `npm pack --dry-run`. macOS is the initial runtime target. Windows runtime is unverified. Publication uses a separately authorized GitHub Actions Trusted Publishing workflow.
