/** Browser adapter: actual tensor outputs become production gameplay state. */
const smooth = p => p * p * (3 - 2 * p);
const clamp01 = p => Math.max(0, Math.min(1, p));
const lerp = (a,b,t) => a+(b-a)*t;
// Conservative absolute-error bound for the squared-distance graph. Includes
// six FP32 source roundings, three rounded subtractions/products and additions.
// The safety factor also covers the signed multiply's ReGLU decomposition.
export function distanceSquaredErrorBound(x,y,z,tx,ty,tz){
  const u=2**-24,a=[x,y,z],b=[tx,ty,tz];let error=0,magnitude=0;
  for(let i=0;i<3;i++){
    const d=Math.abs(a[i]-b[i]),e=u*(Math.abs(a[i])+Math.abs(b[i])+d)+2**-149;
    error+=2*d*e+e*e+u*(d+e)*(d+e);magnitude+=(d+e)*(d+e);
  }
  return 8*(error+4*u*magnitude)+1e-12;
}
export const native = {
  npcMotion(x,z,tx,tz,distance,playerDistance,delta,following,stroll) {
    const velocity=following?Math.min(1.15,Math.max(.3,(playerDistance-1.25)*.65+.3)):stroll?.35:.29;
    const step=Math.min(distance,delta*velocity);
    return {x:distance>1e-5?x+(tx-x)*step/distance:tx,z:distance>1e-5?z+(tz-z)*step/distance:tz,step,velocity,speed:step/Math.max(delta,.001)};
  },
  npcScore(distance,playerDistance,activityDistance,repeated,yielding,hasActivity,stroll) {
    return yielding?-playerDistance+distance*.3+(repeated?10:0):hasActivity?Math.abs(activityDistance-1.1)+distance*.1+(repeated?10:0):Math.abs(distance-(stroll?2.5:1.3))+(repeated?10:0);
  },
  npcArrivalWait(random,rest,observe,greet) {return (rest?18:observe?11:greet?8:5)+random*7;},
  npcCandidate(x0,x1,z0,z1,randomX,randomZ) {return[x0+.1+(x1-x0-.2)*randomX,z0+.1+(z1-z0-.2)*randomZ];},
  addScaled(base,delta,factor) {return base+delta*factor;},
  smoothDelta(base,delta,progress) {return base+delta*smooth(progress);},
  smoothstep(progress) {return smooth(progress);},
  smoothLerp(from,to,progress) {return lerp(from,to,smooth(progress));},
  smoothLerp3(x,y,z,tx,ty,tz,progress) {const t=smooth(progress);return [lerp(x,tx,t),lerp(y,ty,t),lerp(z,tz,t),t];},
  seatTransfer(x,y,z,tx,ty,tz,progress,clearance=.11) {
    const p=clamp01(progress),peak=Math.max(y,ty)+clearance;
    if(p<.22)return[x,lerp(y,peak,smooth(p/.22)),z];
    if(p<.78){const t=smooth((p-.22)/.56);return[lerp(x,tx,t),peak,lerp(z,tz,t)];}
    return[tx,lerp(peak,ty,smooth((p-.78)/.22)),tz];
  },
  treadmillTransfer(x,y,z,tx,ty,tz,progress,clearance=.10) {
    const peak=Math.max(y,ty)+.10;
    if(progress<.28)return[x,lerp(y,peak,smooth(clamp01(progress/.28))),z];
    if(progress<.78){const t=smooth(clamp01((progress-.28)/.5));return[lerp(x,tx,t),peak,lerp(z,tz,t)];}
    return[tx,lerp(peak,ty,smooth(clamp01((progress-.78)/.22))),tz];
  },
  distanceSquared3(x,y,z,tx,ty,tz) {const dx=x-tx,dy=y-ty,dz=z-tz;return dx*dx+dy*dy+dz*dz;},
  motionMarker(age) {const f=Math.max(0,1-age/1.2);return[f*.75,1+(1-f)*.35,f];},
};

const contracts={
  npc_motion:[[-512,512],[-512,512],[-512,512],[-512,512],[0,2048],[0,2048],[0,.1],[0,1],[0,1],[0,10000],[0,1],[10,1000]],
  npc_score:[[0,2048],[0,2048],[0,2048],[0,1],[0,1],[0,1],[0,1]],
  npc_arrival_wait:[[0,1],[0,1],[0,1],[0,1]],
  npc_candidate:[[-512,512],[-512,512],[-512,512],[-512,512],[0,1],[0,1]],
  add_scaled:[[-512,512],[-512,512],[0,1]],
  smooth_delta:[[-512,512],[-512,512],[0,1]],
  smoothstep:[[0,1]],
  smooth_lerp:[[-512,512],[-512,512],[0,1]],
  smooth_lerp3:[[-512,512],[-512,512],[-512,512],[-512,512],[-512,512],[-512,512],[0,1]],
  seat_transfer:[[-512,512],[-512,512],[-512,512],[-512,512],[-512,512],[-512,512],[0,1],[0,4]],
  treadmill_transfer:[[-512,512],[-512,512],[-512,512],[-512,512],[-512,512],[-512,512],[0,1],[0,4]],
  distance_squared3:[[-512,512],[-512,512],[-512,512],[-512,512],[-512,512],[-512,512]],
  motion_marker:[[0,1.2]],
};

/** Fallbacks are explicit compatibility paths, recorded by kernel and reason.
 * Missing/corrupt weights or executor failures throw; they are never presented
 * as successful neural execution. Out-of-domain game values retain native math.
 */
export function createGameLogic(engine,{mode='weights',warn=console.warn}={}) {
  if(mode!=='weights'&&mode!=='native')throw Error('Unknown Handwired mode: '+mode);
  if(mode==='weights'&&typeof engine?.evaluate!=='function')throw Error('Handwired engine is required');
  const buffers=Object.fromEntries(Object.entries(contracts).map(([name,d])=>[name,new Float32Array(d.length)]));
  const stats={mode,calls:0,weighted:0,native:0,domainFallbacks:0,boundaryFallbacks:0,scoreTieFallbacks:0,nearestBoundaryFallbacks:0,nearestWeightedDecisions:0,nearestNativeDecisions:0,failures:0,kernels:{}};
  const warned=new Set();
  function evaluate(name,values,fallback,{boundary=false}={}) {
    stats.calls++; const counter=stats.kernels[name]??={calls:0,weighted:0,native:0,domainFallbacks:0,boundaryFallbacks:0}; counter.calls++;
    const domain=contracts[name];
    if(values.length!==domain.length||!values.every(Number.isFinite)){
      stats.failures++;throw Error('Handwired received malformed or non-finite input: '+name);
    }
    const valid=values.every((x,i)=>x>=domain[i][0]&&x<=domain[i][1]);
    if(mode==='native'||!valid||boundary){
      stats.native++;counter.native++;
      if(mode==='weights'){
        const key=valid?'boundaryFallbacks':'domainFallbacks';stats[key]++;counter[key]++;
        const warning=name+':'+key;
        if(!warned.has(warning)){warned.add(warning);warn('[博美2 Handwired] Explicit native compatibility path: '+warning);}
      }
      return fallback();
    }
    const input=buffers[name];input.set(values);
    let output;
    try{output=engine.evaluate(name,input);}catch(error){stats.failures++;throw error;}
    if(!output){stats.failures++;throw Error('Handwired produced no output: '+name);}
    for(const value of output)if(!Number.isFinite(value)){stats.failures++;throw Error('Handwired produced invalid output: '+name);}
    stats.weighted++;counter.weighted++;return output;
  }
  const scalar=(name,fn)=>(...values)=>{const result=evaluate(name,values,()=>[fn(...values)]);return result[0];};
  const vector=(name,fn)=>(...values)=>Array.from(evaluate(name,values,()=>fn(...values)));
  const api={
    stats,
    snapshot:()=>JSON.parse(JSON.stringify(stats)),
    npcMotion(x,z,tx,tz,distance,playerDistance,delta,following,stroll){
      // Preserve the host's float64 world-position accumulator. The graph owns
      // the actual local displacement, velocity and speed; quantizing a large
      // absolute world coordinate every frame causes avoidable long-run drift.
      const args=[0,0,tx-x,tz-z,distance,playerDistance,delta,+following,+stroll];
      const values=[...args,distance>1e-5?1/distance:0,+(distance>1e-5),1/Math.max(delta,.001)];
      const out=evaluate('npc_motion',values,()=>{const o=native.npcMotion(...args);return[o.x,o.z,o.step,o.velocity,o.speed];},{boundary:distance<1e-4});
      return{x:distance<=1e-5?tx:x+out[0],z:distance<=1e-5?tz:z+out[1],step:out[2],velocity:out[3],speed:out[4]};
    },
    npcScore:(distance,playerDistance,activityDistance,repeated,yielding,hasActivity,stroll)=>scalar('npc_score',native.npcScore)(distance,playerDistance,activityDistance,+repeated,+yielding,+hasActivity,+stroll),
    npcArrivalWait:(random,rest,observe,greet)=>scalar('npc_arrival_wait',native.npcArrivalWait)(random,+rest,+observe,+greet),
    npcCandidate:vector('npc_candidate',native.npcCandidate),
    addScaled:scalar('add_scaled',native.addScaled),
    smoothDelta:scalar('smooth_delta',native.smoothDelta),
    smoothstep:scalar('smoothstep',native.smoothstep),
    smoothLerp:scalar('smooth_lerp',native.smoothLerp),
    smoothLerp3:vector('smooth_lerp3',native.smoothLerp3),
    seatTransfer:vector('seat_transfer',native.seatTransfer),
    treadmillTransfer:vector('treadmill_transfer',native.treadmillTransfer),
    distanceSquared3:scalar('distance_squared3',native.distanceSquared3),
    nearestCandidate(x,y,z,tx,ty,tz,bestWeighted,bestNative,bestError=0){
      const nativeBefore=stats.native;
      const distance=api.distanceSquared3(x,y,z,tx,ty,tz);
      // Keep the selected candidate's double distance and error bound so strict
      // ties remain stable after any earlier unambiguous weighted selection.
      const error=distanceSquaredErrorBound(x,y,z,tx,ty,tz);
      const boundary=Math.abs(distance-bestWeighted)<=error+bestError;
      let exact;
      if(boundary){stats.nearestBoundaryFallbacks++;exact=native.distanceSquared3(x,y,z,tx,ty,tz);}
      if(boundary||stats.native>nativeBefore)stats.nearestNativeDecisions++;else stats.nearestWeightedDecisions++;
      const accepted=boundary?exact<bestNative:distance<bestWeighted;
      if(accepted&&exact===undefined)exact=native.distanceSquared3(x,y,z,tx,ty,tz);
      return{accepted,distance,nativeDistance:exact,error};
    },
    motionMarker:vector('motion_marker',native.motionMarker),
    // Preserve native stable ranking for scores too close to distinguish safely
    // after FP32 rounding; the weighted score still drives ordinary comparisons.
    compareScores(a,b,weightedScore,nativeScore){const av=weightedScore(a),bv=weightedScore(b);if(Math.abs(av-bv)<.0005){stats.scoreTieFallbacks++;return nativeScore(a)-nativeScore(b);}return av-bv;},
  };
  return api;
}

export {contracts};
