/** Recovery candidate ranking only. Camera transforms, look, joystick and
 * movement remain original FP64 to preserve antipodal gameplay turns.
 * No event, collision or permission gate is claimed as weights.
 */
export const controlsContracts={controls_recovery_score:[[0,1024],[-4,4],[0,1024]]};
const outputs={controls_recovery_score:1};
export const controlsNative={recoveryScore(cameraDistance,angleStep,focusDistance){return cameraDistance*.12+Math.abs(angleStep)*.28+Math.abs(focusDistance-2.2)*.7;}};
export function createControlsLogic(engine,{mode='weights',warn=console.warn}={}){
 if(!['weights','native'].includes(mode))throw Error('Unknown controls mode: '+mode);
 if(mode==='weights'&&typeof engine?.evaluate!=='function')throw Error('Controls weight engine is required');
 const buffers=Object.fromEntries(Object.entries(controlsContracts).map(([k,v])=>[k,new Float32Array(v.length)]));
 const stats={mode,calls:0,weighted:0,native:0,domainFallbacks:0,boundaryFallbacks:0,recoveryTieFallbacks:0,recoveryWeightedDecisions:0,recoveryNativeDecisions:0,failures:0,kernels:{}},warned=new Set();
 function evaluate(name,values,fallback,{boundary=false,allowInfinityAt=-1}={}){
  stats.calls++;const counter=stats.kernels[name]??={calls:0,weighted:0,native:0,domainFallbacks:0,boundaryFallbacks:0};counter.calls++;
  const domains=controlsContracts[name];
  if(values.length!==domains.length||!values.every((x,i)=>Number.isFinite(x)||(i===allowInfinityAt&&x===Infinity))){stats.failures++;throw Error('Controls received malformed or non-finite input: '+name);}
  const valid=values.every((x,i)=>x>=domains[i][0]&&x<=domains[i][1]);
  if(mode==='native'||!valid||boundary){
   stats.native++;counter.native++;
   if(mode==='weights'){const key=valid?'boundaryFallbacks':'domainFallbacks';stats[key]++;counter[key]++;const id=name+':'+key;if(!warned.has(id)){warned.add(id);warn?.('[博美2 Handwired controls] Explicit native compatibility path: '+id);}}
   return fallback();
  }
  let out;try{const input=buffers[name];input.set(values);out=engine.evaluate(name,input);}catch(error){stats.failures++;throw error;}
  if(!out||out.length!==outputs[name]||!Array.from(out).every(Number.isFinite)){stats.failures++;throw Error('Controls invalid tensor output: '+name);}
  stats.weighted++;counter.weighted++;return Array.from(out);
 }
 const api={
  stats,snapshot:()=>JSON.parse(JSON.stringify(stats)),
  controlsRecoveryScore(cameraDistance,angleStep,focusDistance,bestScore,bestExact,bestError=0){
   const before=stats.native,score=evaluate('controls_recovery_score',[cameraDistance,angleStep,focusDistance],()=>[controlsNative.recoveryScore(cameraDistance,angleStep,focusDistance)])[0];
   const error=64*2**-24*Math.max(1,cameraDistance*.12+Math.abs(angleStep)*.28+(Math.abs(focusDistance)+2.2)*.7),close=Math.abs(score-bestScore)<=error+bestError;
   let exact;
   if(close){stats.recoveryTieFallbacks++;exact=controlsNative.recoveryScore(cameraDistance,angleStep,focusDistance);}
   if(close||stats.native>before)stats.recoveryNativeDecisions++;else stats.recoveryWeightedDecisions++;
   const accepted=close?exact<bestExact:score<bestScore;
   if(accepted&&exact===undefined)exact=controlsNative.recoveryScore(cameraDistance,angleStep,focusDistance);
   return{accepted,score,exact,error};
  },
 };
 return api;
}
