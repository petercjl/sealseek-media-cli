// Preserve input order, stop scheduling on failure, and drain active operations
// before rejecting so task finalization cannot race outstanding side effects.
export async function mapLimited(values, operation, limit=2) {
  const results=new Array(values.length);let next=0,failure;
  await Promise.all(Array.from({length:Math.min(limit,values.length)},async()=>{
    while(!failure&&next<values.length){const i=next++;try{results[i]=await operation(values[i],i);}catch(e){failure??=e;}}
  }));
  if(failure)throw failure;
  return results;
}
