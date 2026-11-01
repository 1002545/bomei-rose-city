/** Stateless hw4 numerical adapter. Unsupported legacy inputs are explicitly counted.
 * Weight faults never silently fall back. Native camera/input/actor motion is untouched.
 */
const clamp=x=>Math.max(0,Math.min(1,x)),smooth=x=>{const p=clamp(x);return p*p*(3-2*p);};
export const logicPhase4Native={
 railViewProfile(p,d){const q=smooth(p);return[(d>0?q:1-q)*260,Math.max(1-smooth(p/.12),smooth((p-.88)/.12)),smooth((p-.22)/.06)*(1-smooth((p-.48)/.06))];},
 flightRouteCurve(progress,width,height){const point=p=>{const q=1-p;return[q*q*(50*(width/320))+2*p*q*(width*.5)+p*p*(width-50*(width/320)),q*q*(height*.72)+2*p*q*(height*.1)+p*p*(height*.32)];};return[...Array.from({length:31},(_,i)=>point(progress*i/30)).flat(),...point(progress)];},
 musicPeriod:hour=>hour>=6&&hour<17?0:hour>=17&&hour<20?1:2,
 socialCues:(night,walking,companions)=>[night?2:walking?1:0,+(!!companions&&!walking)],
 audioMixProfile:(dark,volume,map,music,effects,ambience,hidden)=>[hidden?0:volume,music?(map?.9:1.6)*(1-.3*dark):0,effects?2.6:0,ambience?1.2:0],
 audioToneProfile:(dark,reverb)=>[9000-6200*dark,.5+.4*dark,reverb*(1+.6*dark)],
};
export const logicPhase4Contracts={rail_view_profile:[[0,1],[0,1]],flight_route_curve:[[0,1],[1,4096],[1,4096]],music_period:[[0,24]],npc_social_cues:[[0,1],[0,1],[0,1]],audio_mix_profile:[[0,1],[0,1],[0,1],[0,1],[0,1],[0,1],[0,1]],audio_tone_profile:[[0,1],[0,8]]};
const sizes={rail_view_profile:3,flight_route_curve:64,music_period:1,npc_social_cues:2,audio_mix_profile:4,audio_tone_profile:3};
const bitInputs={rail_view_profile:[1],npc_social_cues:[0,1,2],audio_mix_profile:[2,3,4,5,6]};
const near=(a,b)=>Math.abs(a-b)<=16*2**-24*(1+Math.abs(a)+Math.abs(b));
export function createLogicPhase4(engine,{mode='weights',warn=console.warn}={}){
 if(!['weights','native'].includes(mode))throw Error('Unknown logicPhase4 Handwired mode: '+mode);
 if(mode==='weights'&&typeof engine?.evaluate!=='function')throw Error('LogicPhase4 Handwired engine required');
 const stats={mode,calls:0,weighted:0,native:0,domainFallbacks:0,boundaryFallbacks:0,failures:0,kernels:{}},warned=new Set(),buffers=Object.fromEntries(Object.entries(logicPhase4Contracts).map(([name,d])=>[name,new Float32Array(d.length)]));
 function evaluate(name,values,native,boundary=false,extraValid=true){
  stats.calls++;const c=stats.kernels[name]??={calls:0,weighted:0,native:0,domainFallbacks:0,boundaryFallbacks:0,failures:0};c.calls++;
  const domain=logicPhase4Contracts[name],valid=extraValid&&values.length===domain.length&&values.every((x,i)=>Number.isFinite(x)&&x>=domain[i][0]&&x<=domain[i][1])&&(bitInputs[name]??[]).every(i=>values[i]===0||values[i]===1);
  if(mode==='native'||!valid||boundary){stats.native++;c.native++;if(mode==='weights'){const why=!valid?'domainFallbacks':'boundaryFallbacks';stats[why]++;c[why]++;const key=name+':'+why;if(!warned.has(key)){warned.add(key);warn('[博美2 Handwired] Explicit logicPhase4 native compatibility path: '+key);}}return native();}
  const input=buffers[name];input.set(values);let out;
  try{out=engine.evaluate(name,input);if(!out||out.length!==sizes[name]||!Array.from(out).every(Number.isFinite))throw Error('Invalid logicPhase4 Handwired output: '+name);if(name==='music_period'&&(!Number.isInteger(out[0])||out[0]<0||out[0]>2))throw Error('Invalid weighted music period');if(name==='npc_social_cues'&&(!Number.isInteger(out[0])||out[0]<0||out[0]>2||out[1]!==0&&out[1]!==1))throw Error('Invalid weighted social cues');}catch(error){stats.failures++;c.failures++;throw error;}
  stats.weighted++;c.weighted++;return Array.from(out);
 }
 return{stats,snapshot:()=>JSON.parse(JSON.stringify(stats)),
  railViewProfile(p,direction){return evaluate('rail_view_profile',[p,+(direction>0)],()=>logicPhase4Native.railViewProfile(p,direction),false,direction===1||direction===-1);},
  flightRouteCurve(progress,width,height){return evaluate('flight_route_curve',[progress,width,height],()=>logicPhase4Native.flightRouteCurve(progress,width,height));},
  musicPeriod(hour){return evaluate('music_period',[hour],()=>[logicPhase4Native.musicPeriod(hour)],[6,17,20].some(t=>near(hour,t)))[0];},
  socialCues(night,walking,companions){return evaluate('npc_social_cues',[night,walking,companions],()=>logicPhase4Native.socialCues(night,walking,companions));},
  audioMixProfile(dark,volume,map,music,effects,ambience,hidden){return evaluate('audio_mix_profile',[dark,volume,map,music,effects,ambience,hidden],()=>logicPhase4Native.audioMixProfile(dark,volume,map,music,effects,ambience,hidden));},
  audioToneProfile(dark,reverb){return evaluate('audio_tone_profile',[dark,reverb],()=>logicPhase4Native.audioToneProfile(dark,reverb));},
 };
}
