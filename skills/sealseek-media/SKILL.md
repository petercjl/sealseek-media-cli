---
name: sealseek-media
description: Generate or retrieve images and videos through SealSeek, including prompt and reference preparation, model parameters, authentication and task lifecycle in Codex or WorkBuddy.
---

# SealSeek media

## Input → strategy → output

Input: an image/video generation or retrieval request routed here by the calling Agent, prompt, optional image references, parameters and delivery directory. Strategy: discover desktop capability, validate, submit once when generation is authorized, follow the saved task, inspect artifacts. Output: local task ID, provider URLs, verified local files, selected model and any unresolved error. The npm package is the canonical source; credentials remain in the private managed profile or desktop configuration.

## Host routing and execution

The user configures provider selection in their own Agent: SealSeek may be a default, a backup, or a task-specific choice. Follow the calling Agent's current routing rules and the user's request. This package provides media capability without setting the Agent's provider priority. Installation and updates do not write global Agent routing rules.

Once a generation request is routed here and authorized, validate it and use `--submit` to execute. The Agent need not ask the user to name SealSeek again when their routing configuration already selects it. Dry-run and discovery incur no generation charges; real generation may consume SealSeek credits. Login alone does not authorize generation.

## Main line

1. **Discover:** resolve `sealseek-media` from PATH. Run `skill source --json` and read the current canonical `SKILL.md` once per request, resolving its resources from that directory. Run `version`, `doctor --live --json` and `capabilities --live --json`. Load the current host adapter from `adapters/codex.json`, `adapters/workbuddy.json` or `adapters/sealseek.json`. An absent mapping is `CAPABILITY_UNAVAILABLE`.
2. **Prepare:** preserve user prompt and reference roles. Read [CLI contract](references/cli.md) when composing a command or resolving parameter mismatch. Select an advertised model ID explicitly; descriptions may disagree about defaults. References carry identity and appearance. Prompts mainly specify scene, camera, lighting, action, timing, continuity and use, with concise reference-based locks for visible structure and relationships.
3. **Validate:** run image/video generate with `--dry-run --json`. Local references are checked without upload. Dry-run proves transport schema compatibility, not quality or every model feature. Material unsupported requirements stop with `FEATURE_UNSUPPORTED`.
4. **Submit:** for an authorized generation request, use the validated command with `--submit`. Save `task_id`. Generation runs in a background worker and matching requests reuse the same task. Use `--new` only for a human-requested additional generation.
5. **Follow:** use `task get` or `task wait` for that ID. Each wait lasts at most 60 seconds. A timeout or uncertain submission follows recovery; automatic resubmission is forbidden because the provider may already have generated and charged.
6. **Deliver:** verify succeeded status, URLs, requested/actual counts, local file sizes and hashes. Inspect image/video content before claiming visual success. Report saved paths, model and limitations. A task ID or generated status alone is not completion.

## Branches and return points

- Missing CLI/runtime: install the owning npm package through the supported host npm environment; verify version; return to Discover.
- Missing, expired or rejected authentication: read `auth status --json`, run `auth login --json`, and show the returned local login webpage. The human scans the official WeChat QR and confirms their existing SealSeek account. Track `auth status --login-id ID --json`; require `succeeded`, then verify `auth status --live --json` and return to Discover. Login alone does not authorize generation. A binding-required account completes binding on the official login page before starting a new login session. Never request passwords or expose tokens. Normal generation reads credential sources without modifying them; explicit `auth logout --yes` backs up plugin credentials and blocks desktop fallback, while `--desktop` additionally backs up and removes the media server's desktop authentication headers.
- Unsupported parameter: inspect live schema and preserve material user requirements. Resolve with an explicitly accepted model/parameter change or end with `FEATURE_UNSUPPORTED`; return to Validate after resolution.
- Connection ended or missing output: inspect the saved task and `artifacts list`. Match prompt, model, time and type before claiming recovery. A new paid submission requires an explicit user request. Return to Follow or end with `SUBMISSION_UNCERTAIN`.
- Download failed: use `task download` into a new directory, reusing stored URLs; return to Deliver.
- Partial results: report requested and actual counts. Another generation needs explicit authorization; return to Deliver with limitations.
- Existing destination: use a new path and preserve the existing file; return to Deliver.

## Dependencies, QA and evolution

Requires Node.js 22+, installed package, valid SealSeek authentication and network. Web login saves a managed private credential profile; otherwise discover current-user desktop configuration or `SEALSEEK_MEDIA_DESKTOP_CONFIG`. Credential expiry is read from JWT metadata and server rejection remains authoritative. Credentials remain outside the package. Generation may charge credits. Initial reference transport accepts images; local audio/video references are unsupported.

Use `skill source/status/install/update` and `update check/install` for managed lifecycle. Global npm installations automatically check/install stable updates daily on CLI invocation and synchronize managed Skills. If an update is reported, reload the current canonical Skill. Read the CLI contract for update controls and recovery. Preserve local edits and customized metadata with backups. Runtime never patches its Skill or adapters. During authorized development, convert recurring failures into command tests and rerun artifact inspection. Claim host compatibility only with actual runtime evidence; clean regression is separate from ordinary execution.
