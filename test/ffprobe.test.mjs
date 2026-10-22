import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {ffprobeCommand,ffprobeStatus,runFFprobe,setupFFprobe} from '../src/ffprobe.mjs';

test('ffprobe resolver keeps explicit intent and executes literal Unicode/quoted input without a shell',()=>{
 const configured='C:\\自有 工具\\ffprobe.exe';
 assert.deepEqual(ffprobeCommand({env:{SEALSEEK_MEDIA_FFPROBE_BIN:configured},packaged:()=>'/bundled'}),{file:configured,source:'configured'});
 assert.equal(ffprobeCommand({env:{},packaged:()=>'/bundled'}).source,'package');
 assert.equal(ffprobeCommand({env:{},packaged:()=>{throw Error('unsupported')}}).source,'PATH');
 let seen;const input=['-of','json','C:\\中文 空格\\"素材".mp4'];
 runFFprobe(input,{env:{SEALSEEK_MEDIA_FFPROBE_BIN:configured},spawn:(file,args,opts)=>{seen={file,args,opts};return {status:0,stdout:'{}'};}});
 assert.equal(seen.file,configured);assert.deepEqual(seen.args,input);assert.equal(seen.opts.shell,false);assert.equal(seen.opts.windowsHide,true);
 const missing=ffprobeStatus({env:{SEALSEEK_MEDIA_FFPROBE_BIN:configured},spawn:()=>({error:{code:'ENOENT'}})});
 assert.equal(missing.ok,false);assert.equal(missing.error.dependency,'ffprobe');assert.match(missing.error.message,/optional dependencies/);
});

test('npm-managed ffprobe reads real saved MP4 dimensions and duration with no PATH dependency',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ffprobe-中文 空格-'));
 const file=path.join(dir,'视频.mp4');
 try{
  await fs.writeFile(file,Buffer.from('AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQAAAs1tZGF0AAACrQYF//+p3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDE2NSByMzIyMiBiMzU2MDVhIC0gSC4yNjQvTVBFRy00IEFWQyBjb2RlYyAtIENvcHlsZWZ0IDIwMDMtMjAyNSAtIGh0dHA6Ly93d3cudmlkZW9sYW4ub3JnL3gyNjQuaHRtbCAtIG9wdGlvbnM6IGNhYmFjPTEgcmVmPTMgZGVibG9jaz0xOjA6MCBhbmFseXNlPTB4MzoweDExMyBtZT1oZXggc3VibWU9NyBwc3k9MSBwc3lfcmQ9MS4wMDowLjAwIG1peGVkX3JlZj0xIG1lX3JhbmdlPTE2IGNocm9tYV9tZT0xIHRyZWxsaXM9MSA4eDhkY3Q9MSBjcW09MCBkZWFkem9uZT0yMSwxMSBmYXN0X3Bza2lwPTEgY2hyb21hX3FwX29mZnNldD0tMiB0aHJlYWRzPTEgbG9va2FoZWFkX3RocmVhZHM9MSBzbGljZWRfdGhyZWFkcz0wIG5yPTAgZGVjaW1hdGU9MSBpbnRlcmxhY2VkPTAgYmx1cmF5X2NvbXBhdD0wIGNvbnN0cmFpbmVkX2ludHJhPTAgYmZyYW1lcz0zIGJfcHlyYW1pZD0yIGJfYWRhcHQ9MSBiX2JpYXM9MCBkaXJlY3Q9MSB3ZWlnaHRiPTEgb3Blbl9nb3A9MCB3ZWlnaHRwPTIga2V5aW50PTI1MCBrZXlpbnRfbWluPTEgc2NlbmVjdXQ9NDAgaW50cmFfcmVmcmVzaD0wIHJjX2xvb2thaGVhZD00MCByYz1jcmYgbWJ0cmVlPTEgY3JmPTIzLjAgcWNvbXA9MC42MCBxcG1pbj0wIHFwbWF4PTY5IHFwc3RlcD00IGlwX3JhdGlvPTEuNDAgYXE9MToxLjAwAIAAAAAQZYiEABX//vfJ78Cm69vfgQAAAxVtb292AAAAbG12aGQAAAAAAAAAAAAAAAAAAAPoAAAD6AABAAABAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAACP3RyYWsAAABcdGtoZAAAAAMAAAAAAAAAAAAAAAEAAAAAAAAD6AAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAEAAAABAAAAAAACRlZHRzAAAAHGVsc3QAAAAAAAAAAQAAA+gAAAAAAAEAAAAAAbdtZGlhAAAAIG1kaGQAAAAAAAAAAAAAAAAAAEAAAABAAFXEAAAAAAAtaGRscgAAAAAAAAAAdmlkZQAAAAAAAAAAAAAAAFZpZGVvSGFuZGxlcgAAAAFibWluZgAAABR2bWhkAAAAAQAAAAAAAAAAAAAAJGRpbmYAAAAcZHJlZgAAAAAAAAABAAAADHVybCAAAAABAAABInN0YmwAAAC+c3RzZAAAAAAAAAABAAAArmF2YzEAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAEAAQAEgAAABIAAAAAAAAAAEVTGF2YzYyLjI4LjEwMCBsaWJ4MjY0AAAAAAAAAAAAAAAY//8AAAA0YXZjQwFkAAr/4QAXZ2QACqzZXsBEAAADAAQAAAMACDxIllgBAAZo6+PLIsD9+PgAAAAAEHBhc3AAAAABAAAAAQAAABRidHJ0AAAAAAAAFigAAAAAAAAAGHN0dHMAAAAAAAAAAQAAAAEAAEAAAAAAHHN0c2MAAAAAAAAAAQAAAAEAAAABAAAAAQAAABRzdHN6AAAAAAAAAsUAAAABAAAAFHN0Y28AAAAAAAAAAQAAADAAAABidWR0YQAAAFptZXRhAAAAAAAAACFoZGxyAAAAAAAAAABtZGlyYXBwbAAAAAAAAAAAAAAAAC1pbHN0AAAAJal0b28AAAAdZGF0YQAAAAEAAAAATGF2ZjYyLjEyLjEwMA==','base64'),{flag:'wx'});
  const env={...process.env,PATH:''};delete env.SEALSEEK_MEDIA_FFPROBE_BIN;
  const status=ffprobeStatus({env});assert.equal(status.ok,true,JSON.stringify(status));assert.equal(status.source,'package');
  const r=runFFprobe(['-v','error','-show_entries','stream=codec_type,width,height:format=duration','-of','json',file],{env});
  assert.equal(r.status,0,r.stderr||r.error?.message);const data=JSON.parse(r.stdout),v=data.streams.find(s=>s.codec_type==='video');
  assert.equal(v.width,16);assert.equal(v.height,16);assert.equal(Number(data.format.duration),1);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('explicit package dependency setup is repeatable and verifies the actual executable',()=>{
 const first=setupFFprobe(),second=setupFFprobe();assert.equal(first.ok,true);assert.equal(second.ok,true);assert.equal(second.source,'package');
});
