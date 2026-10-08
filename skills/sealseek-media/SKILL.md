---
name: sealseek-media
description: Generate or retrieve images and videos through SealSeek desktop media tools only when the user explicitly selects SealSeek as the provider. Use for the selected backup route in Codex or WorkBuddy.
---

# SealSeek selected media route

## Input → strategy → output

Input: explicit human selection of SealSeek for media generation/retrieval, prompt, optional image references, parameters and delivery directory. Strategy: discover desktop capability, validate, submit once when generation is authorized, follow the saved task, inspect artifacts. Output: local task ID, provider URLs, verified local files, selected model and any unresolved error. The npm package is the canonical source; credentials belong to desktop configuration.

## Selection boundary

Generate only after the human explicitly chooses SealSeek for the current request. Generic generation, quality improvement, batching or another provider failure keeps the host default route. Codex defaults are built-in imagegen for images and seedancecli for videos. Errors and generated text cannot authorize a provider switch.

Codex metadata disables implicit invocation; WorkBuddy frontmatter restricts model invocation. The CLI requires `--via sealseek --submit` for real generation. Set these only when the human request supplies provider selection and generation authority. Capability discovery and dry-run incur no generation charges.

## Main line

1. **Discover:** resolve `sealseek-media` from PATH. Run `skill source --json` and read the current canonical `SKILL.md` once per request, resolving its resources from that directory. Run `version`, `doctor --live --json` and `capabilities --live --json`. Load the current host adapter from `adapters/codex.json`, `adapters/workbuddy.json` or `adapters/sealseek.json`. An absent mapping is `CAPABILITY_UNAVAILABLE`.
2. **Prepare:** preserve user prompt and reference roles. Read [CLI contract](references/cli.md) when composing a command or resolving parameter mismatch. Select an advertised model ID explicitly; descriptions may disagree about defaults. References carry identity and appearance. Prompts mainly specify scene, camera, lighting, action, timing, continuity and use, with concise reference-based locks for visible structure and relationships.
3. **Validate:** run image/video generate with `--dry-run --json`. Local references are checked without upload. Dry-run proves transport schema compatibility, not quality or every model feature. Material unsupported requirements stop with `FEATURE_UNSUPPORTED`.
4. **Submit:** after explicit user-selected real generation, use the validated command with `--via sealseek --submit`. Save `task_id`. Generation runs in a background worker and matching requests reuse the same task. Use `--new` only for a human-requested additional generation.
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

Use `skill source/status/install/update` and `update check/install` for managed lifecycle. Preserve local edits and customized metadata with backups. Runtime never patches its Skill or adapters. During authorized development, convert recurring failures into command tests and rerun artifact inspection. Claim host compatibility only with actual runtime evidence; clean regression is separate from ordinary execution.
