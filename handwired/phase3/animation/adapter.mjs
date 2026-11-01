/** Safe presentation-only weight adapter. No time or persistent state is quantized. */
export const animationExtensionContracts = {
 visual_gesture_point: [[-1,1]], visual_gesture_slam: [[-2,1]], visual_gesture_calc: [[-1,1]], visual_gesture_sprinkle: [[-1,1],[-1,1]], visual_gesture_shrug: [[-1,1]], visual_gesture_wave: [[-1,1]], visual_gesture_clap: [[-1,1]],
 visual_npc_face_targets: [[-1,1],[-1,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1]],
 visual_dog_mouth: [[0,1]], visual_dog_tongue: [[0,1],[0,1],[-.06,.06],[-16,16],[-16,16]], visual_dog_eye_aperture: [[0,1],[0,1]], visual_npc_speech: [[0,1],[0,1],[-8,8],[0,1],[-1,1]],
};
export const animationExtensionNative = {
 visualGesturePoint: s => [1.38+.04*s,.16,.2],
 visualGestureSlam: hit => [.35+.75*hit,.22,.25+.5*hit],
 visualGestureCalc: s => [.9+.07*Math.max(0,s),-.12,1.15-.12*Math.max(0,s)],
 visualGestureSprinkle: (s,t) => [1+.1*s,.12,.95+.25*t],
 visualGestureShrug(s) { const t=.5+.5*s;return [.3,.7+.06*t,1.1+.15*t]; },
 visualGestureWave: s => [.3,1.9+.1*s,1+.5*s],
 visualGestureClap(s) { const t=.5+.5*s;return [.95,-.05-.25*t,1.2]; },
 visualDogMouth: t => [.012+.02*t,.003+.026*t,-.012*t,.008+.008*t,.012*t,-.01*t],
 visualDogTongue: (t,out,tremble,cy,z) => [.0105+.003*t,(.006+.012*out)*(1+tremble),-.38*out,cy-.01*t-out*.017-tremble*.004,z+.0006+out*.0045],
 visualDogEyeAperture: (blink,happy) => Math.max(.012,(1-blink*.988)*(1-.42*happy)),
 visualNpcFaceTargets: (base,smile,amount,hasSmile,wide,angry,deadpan,smug,puff) => [hasSmile?(1-amount)*base+amount*smile:base,wide*amount,angry*amount,deadpan*amount,smug*amount,puff*amount],
 visualNpcSpeech: (seed,open,wide,active,nod) => [(seed-.35)*.55*open,Math.max(wide,active?.55*open:0),open*.035*nod,open*.003],
};
const methods = {visualNpcFaceTargets:'visual_npc_face_targets',visualGesturePoint:'visual_gesture_point',visualGestureSlam:'visual_gesture_slam',visualGestureCalc:'visual_gesture_calc',visualGestureSprinkle:'visual_gesture_sprinkle',visualGestureShrug:'visual_gesture_shrug',visualGestureWave:'visual_gesture_wave',visualGestureClap:'visual_gesture_clap',visualDogMouth:'visual_dog_mouth',visualDogTongue:'visual_dog_tongue',visualDogEyeAperture:'visual_dog_eye_aperture',visualNpcSpeech:'visual_npc_speech'};
const lengths={visual_npc_face_targets:6,visual_dog_mouth:6,visual_dog_tongue:5,visual_dog_eye_aperture:1,visual_npc_speech:4};
export function createAnimationExtensionLogic(engine,{mode='weights',warn=console.warn}={}) {
 if (!['weights','native'].includes(mode)) throw Error('Unknown animation extension mode: '+mode);
 if (mode==='weights' && typeof engine?.evaluate!=='function') throw Error('Animation extension engine is required');
 const warned = new Set(), buffers=Object.fromEntries(Object.entries(animationExtensionContracts).map(([k,v])=>[k,new Float32Array(v.length)]));
 const stats={mode,calls:0,weighted:0,native:0,domainFallbacks:0,boundaryFallbacks:0,failures:0,kernels:{}};
 const api={stats,snapshot:()=>JSON.parse(JSON.stringify(stats)),animationExtensionStats:stats,animationExtensionSnapshot:()=>JSON.parse(JSON.stringify(stats))};
 for(const [method,name] of Object.entries(methods)) api[method]=(...values)=>{
  stats.calls++;const c=stats.kernels[name]??={calls:0,weighted:0,native:0,domainFallbacks:0,boundaryFallbacks:0};c.calls++;
  const d=animationExtensionContracts[name];
  if((name==='visual_npc_speech'||name==='visual_npc_face_targets')&&typeof values[3]==='boolean')values[3]=+values[3];
  if(values.length!==d.length || !values.every(Number.isFinite) || ((name==='visual_npc_speech'||name==='visual_npc_face_targets')&&values[3]!==0&&values[3]!==1)) {stats.failures++;throw Error('Animation extension malformed/non-finite input: '+name);}
  const valid=values.every((x,i)=>x>=d[i][0]&&x<=d[i][1]);
  if(mode==='native'||!valid){stats.native++;c.native++;if(mode==='weights'){stats.domainFallbacks++;c.domainFallbacks++;if(!warned.has(name)){warned.add(name);warn('[博美2 Handwired] Explicit visual domain compatibility path: '+name);}}return animationExtensionNative[method](...values);}
  const input=buffers[name];input.set(values);let out;
  try{out=engine.evaluate(name,input);}catch(error){stats.failures++;throw error;}
  let validOutput=!!out&&out.length===(lengths[name]??3);if(validOutput)for(let i=0;i<out.length;i++)if(!Number.isFinite(out[i])){validOutput=false;break;}
  if(!validOutput){stats.failures++;throw Error('Animation extension invalid output: '+name);}
  stats.weighted++;c.weighted++;return name==='visual_dog_eye_aperture'?out[0]:Array.from(out);
 };
 return api;
}
