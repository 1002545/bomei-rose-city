/** Live animation adapter, deliberately retaining host float64 accumulators. */
const clamp=(x,a,b)=>Math.min(b,Math.max(a,x));
const threeDamp=(a,b,rate,dt)=>{const t=1-Math.exp(-rate*dt);return(1-t)*a+t*b;};
const petDamp=(a,b,rate,dt)=>b+(a-b)*Math.exp(-rate*dt);
export const animationContracts={
 animation_damp_delta:[[-8,8],[-8,8],[0,1]],
 npc_animation_targets:[[0,8],[-8,8],[0,1]],
 npc_lively_targets:[[0,2],[-1,1],[-1,1],[-1,1],[-1,1],[-8,8],[-1,1],[-1,1]],
 npc_antenna_step:[[-8,8],[-8,8],[-128,128],[-128,128],[-2048,2048],[-2048,2048],[-2048,2048],[-2048,2048],[0,1/30]],
 pet_bone_pose:[[0,1],[0,2],[-1,1],[0,1],[0,1],[-1,1],[0,1]],
 pet_face_targets:[[-1,1],[0,1],[-1,1],[0,1]],
 animation_gesture_blend4:[[-8,8],[-8,8],[-8,8],[-8,8],[-8,8],[-8,8],[-8,8],[0,1.5],[0,1],[0,1]],
 dog_gait_step:[[0,8],[0,.1],[0,1]],
 dog_body_pose:[[-1,1],[0,1],[0,1],[-1,1],[-1,1],[0,16],[0,1]],
 dog_paw_gait:[[-1,1],[-1,1],[-1,1],[0,1]],
};
const outputLengths={animation_damp_delta:1,npc_animation_targets:3,npc_lively_targets:3,npc_antenna_step:4,pet_bone_pose:9,pet_face_targets:3,animation_gesture_blend4:4,dog_gait_step:1,dog_body_pose:4,dog_paw_gait:3};
const bits={npc_animation_targets:[2],pet_bone_pose:[4,6],pet_face_targets:[1,3],animation_gesture_blend4:[8],dog_gait_step:[2],dog_body_pose:[6]};
export const animationNative={
 animationDamp:threeDamp,petAnimationDamp:petDamp,
 npcAnimationTargets(speed,turning,moving){return[moving?clamp(speed/.3,1,2):0,moving?clamp(speed/.3,.2,1.7):0,clamp(turning,-.6,.6)];},
 npcLivelyTargets(motion,gaitSin,breathSin,leanSinA,leanSinB,look,tiltSin,halfGaitSin){const u=1-motion;return[motion*Math.abs(gaitSin)*.016+u*(breathSin*.5+.5)*.005,u*(leanSinA*.011+leanSinB*.003),clamp(look,-.28,.28)*-.55*u+tiltSin*.07*u+halfGaitSin*.03*motion];},
 npcAntennaStep(x,z,vx,vz,yawRate,pitchRate,leanRate,bobRate,dt){const dvx=(-60*x-5.5*vx-(yawRate*2.2+leanRate*28))*dt,dvz=(-60*z-5.5*vz-(pitchRate*2.2-bobRate*30))*dt;return[dvx,dvz,(vx+dvx)*dt,(vz+dvz)*dt];},
 petBonePose(sit,motion,gait,reach,holdingPaws,breathSin,rest){motion*=1-sit;const out=[];for(const sign of [1,-1]){const pulling=sign===-1?reach:0,holding=sign===1&&holdingPaws?1:0;out.push(.32*gait*sign*motion-sit*1.35,.36*Math.max(0,-gait*sign)*motion+sit*1.5,-.27*gait*sign*motion*(1-pulling)+pulling*.62-holding*.55,.12*Math.max(0,gait*sign)*motion*(1-pulling)-holding*.9);}out.push(rest?0:.025*breathSin*(1-motion));return out;},
 petFaceTargets(blinkSin,blinkActive,jawSin,greeting){return[blinkActive?blinkSin**2:0,greeting?.4*Math.abs(jawSin):0,greeting?.3:0];},
 animationGestureBlend4(a0,a1,a2,a3,t0,t1,t2,amount,active,rate,dt){return[a0,a1,a2,a3].map((a,i)=>threeDamp(a,i===3?+!!active:active?[t0,t1,t2][i]*amount:0,rate,dt));},
 dogGaitStep(speed,dt,exercise){return dt*(exercise?8:8.3*Math.max(.15,speed/.72));},
 dogBodyPose(gaitSin,amount,dip,idleSin,breathSin,baseScale,sleeping){return[(sleeping?-Math.PI/2:0)+gaitSin*.014*amount+dip*.14,gaitSin*.017*amount+idleSin*.004*(1-amount),baseScale*(1+breathSin*.0018),baseScale*(1+breathSin*.003)];},
 dogPawGait(side,gaitSin,gaitCos,amount){return[side*(.247+gaitSin*.003*amount),-.14+Math.max(0,gaitSin)*.01*amount,.157+gaitCos*.026*amount];},
};
// Damping drives a few discrete presentation/mount decisions. If roundoff could
// straddle their existing threshold, retain the original Number expression.
const dampingThresholds=[0,.03,.05,.06,.2,.35,.5,.8,1];
const U=2**-24;
export function dampingBoundary(a,b,factor,nativeResult){const bound=16*U*(Math.abs(a)+Math.abs(b)+Math.abs(b-a)*factor)+1e-14;if(factor===0||factor===1||a===b)return true;for(let i=0;i<dampingThresholds.length;i++)if(Math.abs(nativeResult-dampingThresholds[i])<=bound)return true;return false;}
export function createAnimationLogic(engine,{mode='weights',warn=console.warn}={}){
 if(!['weights','native'].includes(mode))throw Error('Unknown animation Handwired mode: '+mode);
 if(mode==='weights'&&typeof engine?.evaluate!=='function')throw Error('Animation Handwired engine is required');
 const buffers=Object.fromEntries(Object.entries(animationContracts).map(([n,d])=>[n,new Float32Array(d.length)])),warned=new Set();
 const stats={mode,calls:0,weighted:0,native:0,domainFallbacks:0,boundaryFallbacks:0,failures:0,kernels:{}};
 function evaluate(name,values,fallback,boundary=false,scalar=false){
  stats.calls++;const c=stats.kernels[name]??={calls:0,weighted:0,native:0,domainFallbacks:0,boundaryFallbacks:0};c.calls++;
  const d=animationContracts[name];
  let malformed=values.length!==d.length;
  if(!malformed)for(let i=0;i<values.length;i++)if(!Number.isFinite(values[i])){malformed=true;break;}
  const bitIndices=bits[name];
  if(!malformed&&bitIndices)for(let i=0;i<bitIndices.length;i++){const x=values[bitIndices[i]];if(x!==0&&x!==1){malformed=true;break;}}
  if(malformed){stats.failures++;throw Error('Animation Handwired malformed/non-finite input: '+name);}
  let valid=true;for(let i=0;i<values.length;i++)if(!(values[i]>=d[i][0]&&values[i]<=d[i][1])){valid=false;break;}
  if(mode==='native'||!valid||boundary){stats.native++;c.native++;if(mode==='weights'){const reason=!valid?'domainFallbacks':'boundaryFallbacks';stats[reason]++;c[reason]++;const key=name+':'+reason;if(!warned.has(key)){warned.add(key);warn('[博美2 Handwired] Explicit animation native compatibility path: '+key);}}return fallback();}
  const input=buffers[name];input.set(values);let out;try{out=engine.evaluate(name,input);}catch(error){stats.failures++;throw error;}
  if(!out||out.length!==outputLengths[name]){stats.failures++;throw Error('Animation Handwired invalid output: '+name);}
  for(let i=0;i<out.length;i++)if(!Number.isFinite(out[i])){stats.failures++;throw Error('Animation Handwired invalid output: '+name);}
  stats.weighted++;c.weighted++;return scalar?out[0]:Array.from(out);
 }
 const vector=(name,fn)=>(...v)=>evaluate(name,v,()=>fn(...v));
 function damp(a,b,rate,dt,fn){
  if(!Number.isFinite(a)||!Number.isFinite(b)||!Number.isFinite(rate)||!Number.isFinite(dt)){stats.failures++;throw Error('Animation Handwired damping inputs must be finite');}
  const attenuation=Math.exp(-rate*dt),factor=1-attenuation,result=fn===threeDamp?(1-factor)*a+factor*b:b+(a-b)*attenuation;
  // Finite but unusual rate/dt remains a native compatibility path. Never clamp.
  const boundary=rate<0||dt<0||rate>128||dt>.1||!Number.isFinite(factor)||dampingBoundary(a,b,factor,result);
  const delta=evaluate('animation_damp_delta',[a,b,Number.isFinite(factor)?factor:0],()=>result-a,boundary,true);
  return stats.mode==='native'||boundary||a< -8||a>8||b< -8||b>8?result:a+delta;
 }
 const api={stats,snapshot:()=>JSON.parse(JSON.stringify(stats)),animationStats:stats,animationSnapshot:()=>JSON.parse(JSON.stringify(stats)),
  animationDamp:(a,b,rate,dt)=>damp(a,b,rate,dt,threeDamp),petAnimationDamp:(a,b,rate,dt)=>damp(a,b,rate,dt,petDamp),
  npcAnimationTargets:(speed,turning,moving)=>evaluate('npc_animation_targets',[speed,turning,+!!moving],()=>animationNative.npcAnimationTargets(speed,turning,moving)),
  npcLivelyTargets:vector('npc_lively_targets',animationNative.npcLivelyTargets),npcAntennaStep:vector('npc_antenna_step',animationNative.npcAntennaStep),
  petBonePose:(sit,motion,gait,reach,holding,breath,rest)=>evaluate('pet_bone_pose',[sit,motion,gait,reach,+!!holding,breath,+!!rest],()=>animationNative.petBonePose(sit,motion,gait,reach,holding,breath,rest)),
  petFaceTargets:(blink,active,jaw,greeting)=>evaluate('pet_face_targets',[blink,+!!active,jaw,+!!greeting],()=>animationNative.petFaceTargets(blink,active,jaw,greeting)),
  animationGestureBlend4(a0,a1,a2,a3,t0,t1,t2,amount,active,rate,dt){
   if(!Number.isFinite(rate)||!Number.isFinite(dt)){stats.failures++;throw Error('Animation gesture rate/dt must be finite');}
   const factor=1-Math.exp(-rate*dt),old=[a0,a1,a2,a3],targets=[active?t0*amount:0,active?t1*amount:0,active?t2*amount:0,+!!active],native=()=>animationNative.animationGestureBlend4(a0,a1,a2,a3,t0,t1,t2,amount,active,rate,dt);
   const values=[...old,t0,t1,t2,amount,+!!active,Number.isFinite(factor)?factor:0],boundary=rate<0||rate>128||dt<0||dt>.1||!Number.isFinite(factor)||factor===0||factor===1;
   const valid=values.every((x,i)=>Number.isFinite(x)&&x>=animationContracts.animation_gesture_blend4[i][0]&&x<=animationContracts.animation_gesture_blend4[i][1]);
   // Native reference arithmetic is needed only on the unchanged compatibility path.
   const exact=mode==='native'||boundary||!valid?native():null;
   const delta=evaluate('animation_gesture_blend4',values,()=>exact.map((x,i)=>x-old[i]),boundary);
   return mode==='native'||boundary||!valid?exact:delta.map((x,i)=>x+old[i]);
  },
  dogGaitStep:(speed,dt,exercise)=>evaluate('dog_gait_step',[speed,dt,+!!exercise],()=>animationNative.dogGaitStep(speed,dt,exercise),false,true),
  dogBodyPose:(a,b,c,d,e,f,g)=>evaluate('dog_body_pose',[a,b,c,d,e,f,+!!g],()=>animationNative.dogBodyPose(a,b,c,d,e,f,g)),
  dogPawGait:vector('dog_paw_gait',animationNative.dogPawGait),
 };return api;
}
