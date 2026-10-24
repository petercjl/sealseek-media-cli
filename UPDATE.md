# Update for the current Agent

User prompt:

> 请更新 npm 包 @petercjl/sealseek-media-cli。

Resolve the current Agent's exact Skill destination before replacement. Use its local `scripts/run.mjs` as the maintained execution entry. Run `update install --yes --agent AGENT --path EXACT_SKILL_DIR --json`. Only that selected target is touched. The bootstrap npm package is provenance, not the running target's dependency. Source checkouts are Git-owned; parent-managed installations follow their owner.

The operation saves the true pre-replacement package, Skill and metadata snapshot, acquires a candidate with real npm into a target-scoped operation directory, verifies identity and dependencies, then activates the selected copy. Same-version updates repair stale or missing resources and receipts; fully current state is verified no-op. Host UI metadata is preserved separately. The Agent verifies the returned local entry, managed hashes and version, reloads the Skill, then confirms host-native discovery.

On timeout, disconnect or failure, inspect `update operation --path EXACT_SKILL_DIR --json` before attempting another install. Use `update resume --path EXACT_SKILL_DIR --operation UUID --yes --json` to reuse an acquired candidate and original backup. New installation is refused while a previous update is unresolved. Acquisition failure without a candidate requires explicit inspection; preserve the operation and snapshot. Never discard local edits to force recovery.

Automatic checks run at ordinary task entry, default to notification, have a two-second network deadline, a persistent 24-hour cache, offline backoff, a lock and opt-out. `update policy --mode off|notify|auto --yes --path EXACT_SKILL_DIR` controls policy. Automatic installation requires explicit standing authorization, a resolved target, and the same major version (same minor for 0.x). Help, version, source and task-following operations do not check the registry.

## Historical migration

Legacy `--root PARENT` and explicit `--home AGENT_HOME` resolve only the supplied path. A historical `--mode link` with an explicit destination translates to physical-copy migration. Requests containing only a named Agent cannot safely determine a directory: they stop with TARGET_PATH_REQUIRED. For such older callers, first preserve their true old installation, acquire the new bootstrap package, and explicitly synchronize the resolved current target. An old parent's actions before handoff cannot be retroactively secured by the new receiver; see the package's historical compatibility evidence before claiming that updater path supported.

## Verified historical support contract

The regression entry `npm run verify:historical` uses immutable published baseline bytes and real npm. Baselines are sealseek-media-cli 0.6.8, cloud-hug-style-transfer 0.5.0, and nano-product-replacement 0.2.1. Media and cloud support explicit-target old updater handoff. Nano 0.2.1 uses a new bootstrap with an explicit destination and explicit legacy package source; its published updater scans named hosts before handoff, so that old automatic route is excluded. Earlier installations use the same explicit migration contract after ownership verification; their original automatic updater behavior is not claimed tested.

`skill update --path EXACT_SKILL_DIR --legacy-source OLD_PACKAGE_ROOT --json` verifies the declared owning package and preserves the original installation before copying. `update rollback --path EXACT_SKILL_DIR --operation UUID --yes --json` restores a verified snapshot when the current target has no local edits. Host discovery is checked separately after recovery or rollback.

Legacy links require a verifiable owning-package integrity manifest; business edits made through a link are preserved and block replacement. If that old release has no integrity record, verify its exact published archive before choosing an explicit migration source.

## Machine consumer contract

`skill source --json` and packaged capabilities expose `maintenanceContract` version 1: typed result-field mappings and explicit target option semantics. `--path` and `--target-directory` select the exact Skill directory; the supported legacy `--root` selects its parent and appends the canonical Skill name. Verify the returned target. Status retains boolean `current`/`edited` fields and exposes `up_to_date`, `editedFiles`, integrity verification and recovery actions. A matching current managed receipt can be reused within the same operation; host-native Skill loading completes the separately owned discovery phase. A fully current installation needs no reinstall or duplicate registry/tree checks.
