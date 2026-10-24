import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile),root=path.resolve(import.meta.dirname,'..');
test('actual published old CLI uses real npm for supported copy/link handoff', {timeout:240000},async()=>{
 const {stdout}=await execute(process.execPath,[path.join(root,'scripts/verify-historical.mjs')],{cwd:root,env:process.env,timeout:230000,maxBuffer:8*1024*1024});
 const result=JSON.parse(stdout);assert.equal(result.ok,true);assert.equal(result.realNpm,true);assert.equal(result.sameVersionNoop,true);assert(result.archivedEntryHash);
});
test('real npm packed candidate covers same-version, local-edits, partial Skill sync failure and repeated recovery', {timeout:240000},async()=>{
 const {stdout}=await execute(process.execPath,[path.join(root,'scripts/verify-packed.mjs')],{cwd:root,env:process.env,timeout:230000,maxBuffer:8*1024*1024});
 const result=JSON.parse(stdout);assert.equal(result.ok,true);assert(result.realNpmCandidateAcquisition&&result.packedLocalEditsProtected&&result.partialFailure&&result.repeatedRecovery&&result.originalBackupPreserved&&result.rollback&&result.independentRuntime);
});
