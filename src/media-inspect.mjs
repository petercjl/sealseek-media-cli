import {imageSize} from 'image-size';
import {runFFprobe,ffprobeStatus} from './ffprobe.mjs';
import {secureUrl,requireValue} from './core.mjs';
export async function inspectMediaUrl(url,kind='image'){
  url=secureUrl(url).href;
  requireValue(['image','video'].includes(kind),'INVALID_INPUT','Kind must be image or video.');
  if(kind==='video'){
    const dependency=ffprobeStatus();requireValue(dependency.ok,'DEPENDENCY_UNAVAILABLE',dependency.error?.message,{dependency:'ffprobe'});
    const r=runFFprobe(['-v','error','-protocol_whitelist','http,https,tcp,tls,crypto','-show_entries','stream=codec_type,width,height:format=duration','-of','json',url]);
    requireValue(r.status===0,'MEDIA_INSPECT_FAILED','ffprobe could not read the video URL; inspect a downloaded local task instead.');
    const v=JSON.parse(r.stdout),s=v.streams?.find(s=>s.codec_type==='video');requireValue(s?.width>0&&s.height>0,'MEDIA_INSPECT_FAILED','No video dimensions.');return {url,kind,width:s.width,height:s.height,duration:Number(v.format?.duration)||null};
  }
  const r=await fetch(url,{signal:AbortSignal.timeout(30000)});requireValue(r.ok,'MEDIA_INSPECT_FAILED','Image URL is unavailable.',{status:r.status});
  const reader=r.body.getReader(),chunks=[];let total=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;total+=value.length;requireValue(total<=16*1024*1024,'MEDIA_TOO_LARGE','Image metadata exceeds 16 MiB limit.');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
  let d;try{d=imageSize(Buffer.concat(chunks));}catch{requireValue(false,'MEDIA_INSPECT_FAILED','Unsupported image data.');}
  requireValue(d.width>0&&d.height>0,'MEDIA_INSPECT_FAILED','No image dimensions.');return {url,kind,width:d.width,height:d.height,mime_type:r.headers.get('content-type')?.split(';')[0],format:d.type};
}
