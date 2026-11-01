/** Presentation-only adapter; finite compatibility paths are explicit and counted. */
export const visualPhase4Contracts={
 visual_rest_lid:[[0,1],[0,1]],visual_blink_asymmetry:[[-2,2],[-2,2],[0,1]],
 visual_blind_profile:[[0,.1],[0,1],[0,1],[-4,4],[0,16],[1,255],[0,16]],visual_blind_transmission:[[0,1],[-4,4]],visual_sash_position:[[-16,16],[0,1],[0,16]],
 visual_window_spill:[[0,32],[0,1],[0,128],[1,128]],visual_home_glow:[[0,1]],visual_home_lamp_profile:[[0,1]],visual_corridor_glow:[[0,1],[0,32]],visual_pool_boat:[[-1,1],[-1,1],[-1,1]],visual_pool_buoy:[[-1,1],[-1,1]],
};
export const visualPhase4Native={
 visualRestLid:(fadeIn,fadeOut)=>.32+.68*fadeIn*(1-fadeOut),
 visualBlinkAsymmetry:(lag,blink,wink)=>Math.min(.35,Math.max(-.35,lag-blink))+wink,
 visualBlindProfile(stack,openPitch,lowered,tilt,slatTop,intervals,top){const pitch=stack+(openPitch-stack)*lowered,angle=tilt*lowered,railY=slatTop-intervals*pitch-.02,cordTop=top-.05,cordBottom=railY+.008;return[pitch,angle,railY,cordTop-cordBottom,(cordTop+cordBottom)/2];},
 visualBlindTransmission:(lowered,coverage)=>1-lowered*Math.min(.94,.06+.92*Math.min(1,coverage)),
 visualSashPosition:(baseX,eased,travel)=>baseX-eased*travel,
 visualWindowSpill:(base,day,sum,count)=>base*day*sum/count,
 visualHomeGlow:day=>.18+1.1*(1-day),
 visualHomeLampProfile:day=>[.6+.85*(1-day),.55+.7*(1-day)],
 visualCorridorGlow(amount,base){const level=.2+.8*amount;return[base*level,1.1*level];},
 visualPoolBoat:(a,b,c)=>[-.11+a*.045,b*.04,c*.025],
 visualPoolBuoy:(a,b)=>[-.11+a*.05,b*.12],
};
export const visualPhase4Methods={visualRestLid:'visual_rest_lid',visualBlinkAsymmetry:'visual_blink_asymmetry',visualBlindProfile:'visual_blind_profile',visualBlindTransmission:'visual_blind_transmission',visualSashPosition:'visual_sash_position',visualWindowSpill:'visual_window_spill',visualHomeGlow:'visual_home_glow',visualHomeLampProfile:'visual_home_lamp_profile',visualCorridorGlow:'visual_corridor_glow',visualPoolBoat:'visual_pool_boat',visualPoolBuoy:'visual_pool_buoy'};
const lengths={visual_blind_profile:5,visual_home_lamp_profile:2,visual_corridor_glow:2,visual_pool_boat:3,visual_pool_buoy:2};
export function createVisualPhase4(engine,{mode='weights',warn=console.warn}={}){
 if(!['weights','native'].includes(mode))throw Error('Unknown phase-four visual mode: '+mode);
 if(mode==='weights'&&typeof engine?.evaluate!=='function')throw Error('Phase-four visual weight engine is required');
 const buffers=Object.fromEntries(Object.entries(visualPhase4Contracts).map(([k,v])=>[k,new Float32Array(v.length)])),warned=new Set();
 const stats={mode,calls:0,weighted:0,native:0,domainFallbacks:0,boundaryFallbacks:0,failures:0,kernels:{}};
 const snapshot=()=>JSON.parse(JSON.stringify(stats)),api={stats,snapshot,visualPhase4Stats:stats,visualPhase4Snapshot:snapshot};
 for(const[method,name]of Object.entries(visualPhase4Methods))api[method]=(...values)=>{
  stats.calls++;const c=stats.kernels[name]??={calls:0,weighted:0,native:0,domainFallbacks:0,boundaryFallbacks:0};c.calls++;
  const ranges=visualPhase4Contracts[name];
  if(values.length!==ranges.length||!values.every(Number.isFinite)){stats.failures++;throw Error('Phase-four visual malformed/non-finite input: '+name);}
  const integerValid=name==='visual_window_spill'?Number.isInteger(values[3]):name==='visual_blind_profile'?Number.isInteger(values[5]):true;
  const valid=integerValid&&values.every((x,i)=>x>=ranges[i][0]&&x<=ranges[i][1]);
  if(mode==='native'||!valid){stats.native++;c.native++;if(mode==='weights'){stats.domainFallbacks++;c.domainFallbacks++;if(!warned.has(name)){warned.add(name);warn('[博美2 Handwired] Explicit phase-four visual domain compatibility path: '+name);}}return visualPhase4Native[method](...values);}
  const input=buffers[name];input.set(values);if(name==='visual_window_spill')input[3]=1/values[3];
  let out;try{out=engine.evaluate(name,input);}catch(error){stats.failures++;throw error;}
  const size=lengths[name]??1;
  if(!out||out.length!==size||!Array.from(out).every(Number.isFinite)){stats.failures++;throw Error('Phase-four visual invalid output: '+name);}
  stats.weighted++;c.weighted++;return size===1?out[0]:Array.from(out);
 };
 return api;
}
