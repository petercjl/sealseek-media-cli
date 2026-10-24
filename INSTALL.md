# Install for the current Agent

User prompt:

> 请安装 npm 包 @petercjl/sealseek-media-cli。

The current Agent checks Node.js 22+, command execution, file access, its own supported Skill discovery directory and its registration/refresh mechanism. The Agent resolves an exact destination; the package never chooses a host directory. npm success completes the bootstrap CLI phase only, including installations with scripts disabled.

Agent execution contract:

1. Resolve the installed CLI and verify `version`; run `skill source --json` and read the canonical Skill and `installationLifecycle`.
2. Run `skill install --agent AGENT --path EXACT_SKILL_DIR --json`. A valid unnamed Agent uses the generic adapter. The destination contains physical copies of all resources, a `.runtime` with the package and its dependencies, and `scripts/run.mjs`. Node.js and declared external services remain prerequisites.
3. Invoke `node EXACT_SKILL_DIR/scripts/run.mjs version --json`; inspect `skill status` with the same explicit path. Ownership, hashes, version and independent runtime must be current.
4. Reload/register the Skill using the current host's mechanism and confirm native discovery. The CLI reports `hostDiscovery: pending`; it cannot attest host registration. Report full completion only after that verification.

Existing user-owned targets and local edits are preserved. Managed legacy links are backed up and migrated to physical copies. A missing destination stops before package replacement. On partial failure inspect `update operation --path EXACT_SKILL_DIR --json`, then follow UPDATE.md. Service login and paid generation require their own authorization.
