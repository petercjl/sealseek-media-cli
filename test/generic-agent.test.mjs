import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from '../src/core.mjs';
import { destination, install, status, SOURCE } from '../src/skills.mjs';

test('generic hosts require their own explicit path and retain canonical bytes', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'media-generic-'));
  const previous = process.env.SEALSEEK_MEDIA_STATE_DIR;
  process.env.SEALSEEK_MEDIA_STATE_DIR = path.join(dir, 'state');
  try {
    for (const agent of ['generic', 'sealcraft', 'another-agent']) {
      assert.throws(() => destination(agent), { code: 'TARGET_PATH_REQUIRED' });
      const target = path.join(dir, agent, 'skills', 'sealseek-media');
      const result = await install(agent, { path: target });
      assert.equal(result.adapter, 'generic');
      assert.equal(result.agent, agent);
      assert.equal(result.current, true);
      assert.deepEqual(await fs.readFile(path.join(target, 'SKILL.md')), await fs.readFile(path.join(SOURCE, 'SKILL.md')));
      assert.equal((await install(agent, { path: target })).state, 'unchanged');
      const marker = path.join(target, '.sealseek-media-install.json');
      const manifest = JSON.parse(await fs.readFile(marker, 'utf8'));
      manifest.version = '0.0.0';
      await fs.writeFile(marker, JSON.stringify(manifest));
      const refreshed = await install(agent, { path: target });
      assert.equal(refreshed.current, true);
      assert(refreshed.backup);
      await fs.appendFile(path.join(target, 'SKILL.md'), '\nlocal edit\n');
      await assert.rejects(install(agent, { path: target }), { code: 'LOCAL_EDITS' });
      assert.equal((await status(agent, target)).edited, true);
    }
    const unnamed = await install(undefined, { path: path.join(dir, 'unnamed') });
    assert.equal(unnamed.agent, 'generic');
    assert.equal(unnamed.adapter, 'generic');
    for (const invalid of ['../codex', '__proto__', '', 'Bad Agent']) {
      assert.throws(() => destination(invalid, path.join(dir, 'invalid')), { code: 'INVALID_TARGET' });
    }
    for (const agent of ['codex', 'workbuddy', 'sealseek']) {
      assert.equal(destination(agent), path.join(os.homedir(), '.' + agent, 'skills', 'sealseek-media'));
    }
    const userOwned = path.join(dir, 'user-owned');
    await fs.mkdir(userOwned);
    await fs.writeFile(path.join(userOwned, 'SKILL.md'), 'owned');
    await assert.rejects(install('another-agent', { path: userOwned }), { code: 'UNMANAGED_TARGET' });
    assert.equal(await fs.readFile(path.join(userOwned, 'SKILL.md'), 'utf8'), 'owned');
  } finally {
    if (previous === undefined) delete process.env.SEALSEEK_MEDIA_STATE_DIR;
    else process.env.SEALSEEK_MEDIA_STATE_DIR = previous;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('CLI advertises the generic contract and installs without borrowing another host identity', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'media-generic-cli-'));
  const cli = args => {
    const result = spawnSync(process.execPath, [path.join(ROOT, 'bin/sealseek-media.mjs'), ...args], {
      encoding: 'utf8', env: { ...process.env, SEALSEEK_MEDIA_AUTO_UPDATE: '0', SEALSEEK_MEDIA_STATE_DIR: path.join(dir, 'state') }
    });
    return { code: result.status, body: JSON.parse(result.stdout) };
  };
  try {
    const source = cli(['skill', 'source', '--json']);
    assert.equal(source.code, 0);
    assert.equal(source.body.installation.fallback_agent, 'generic');
    assert.equal(source.body.installation.custom_path_required, true);
    const missing = cli(['skill', 'install', '--agent', 'sealcraft', '--json']);
    assert.equal(missing.code, 1);
    assert.equal(missing.body.error.code, 'TARGET_PATH_REQUIRED');
    assert.equal(await fs.stat(path.join(dir, 'state')).catch(() => null), null);
    const target = path.join(dir, 'skills', 'sealseek-media');
    assert.equal(cli(['skill', 'install', '--agent', 'sealcraft', '--path', target, '--json']).body.current, true);
    assert.equal(cli(['skill', 'status', '--agent', 'sealcraft', '--path', target, '--json']).body.adapter, 'generic');
    assert.equal(cli(['skill', 'update', '--agent', 'sealcraft', '--path', target, '--json']).body.state, 'unchanged');
    const generic = JSON.parse(await fs.readFile(path.join(target, 'adapters/generic.json'), 'utf8'));
    assert.equal(generic.platform, 'generic');
    assert(generic.mappings.every(mapping => mapping.status === 'implemented'));
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
