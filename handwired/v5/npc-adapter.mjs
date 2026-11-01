/** Runtime-only fused NPC circuits. No compiler, dynamic code, or silent fallback.
 * FP64 timer commits, string/hash/modulo/ceil encoding, and object IO stay native.
 * Only comparison uncertainty bands use explicit, counted native decision repair.
 */
const habits=['read','observe','browse','stroll','greet','rest','travel'],intents=['stroll','observe','greet','rest'];
const rows=[[1,1,3,0],[1,0,1,3],[1,0,1,2],[0,0,1,3],[2,0,1,2],[3,1,3,0],[0,1,0,3],[2,0,1,2]];
const outputContract={npc5_intent:[1,[]],npc5_board:[1,[0]],npc5_depart:[2,[0,1]],npc5_frame:[3,[0,1]],npc5_wait:[2,[1]],npc5_rest:[2,[1]],npc5_blocked:[2,[1]]};
const bit=x=>+!!x,cap=(x,a,b)=>Math.max(a,Math.min(b,x)),near=(x,y)=>Math.abs(x-y)<=2e-5;
export const npcNative5={
 intent:(conversation,rest,pending,night,walking,habit,roll)=>conversation?2:rest||pending?3:night&&(habit===5||roll<3)?3:walking&&habit===4?(roll<3?2:0):rows[habit][roll%4],
 board:(route,linked,priv,open,type,phase)=>!!route&&!!linked&&!priv&&!!open&&(type===1?phase>=3.3&&phase<9.7:type===2?phase>=75&&phase<88:true),
 depart:(process,route,allowed,age,type,remaining)=>({eligible:!!process&&age>3,depart:!!process&&age>3&&!!route&&!!allowed&&(type===0||remaining<=0)}),
 frame:(change,age,raw)=>({jump:change<0||change>120,offscreen:age>=1,delta:Math.max(0,Math.min(.1,raw))}),
 wait:(wait,delta,path)=>({wait:wait-delta,ready:!path&&wait-delta<=0}),
 rest:(closeFor,delta,wait,close)=>({closeFor:close?closeFor+delta:0,release:(close?closeFor+delta:0)>1.5||wait<=0&&!close}),
 blocked:(blocked,delta)=>({blockedFor:blocked+delta,replan:blocked+delta>.65})
};
export function createNpcStateLogic(engine,{mode='weights'}={}){
 if(!['weights','native'].includes(mode))throw Error('Unknown NPC5 mode '+mode);
 if(mode==='weights'&&typeof engine?.evaluate!=='function')throw Error('NPC5 weight engine required');
 const stats={mode,calls:0,evaluated:0,weighted:0,native:0,boundaryRepairs:0,nativeTimerCommits:0,failures:0,kernels:{}};
 // Scratch inputs belong to this adapter and active call depth, not the caller.
 // Ordinary frames allocate no typed inputs; nested instrumented engines get a
 // distinct buffer, and finally restores the pool even when inference throws.
 const inputSizes={npc5_intent:7,npc5_board:6,npc5_depart:6,npc5_frame:3,npc5_wait:3,npc5_rest:4,npc5_blocked:2};
 const inputs=Object.fromEntries(Object.entries(inputSizes).map(([name,size])=>[name,{depth:0,buffers:[new Float32Array(size)]}]));
 function run(name,values,native,repair=false){
  stats.calls++;const k=stats.kernels[name]??={calls:0,evaluated:0,weighted:0,native:0,boundaryRepairs:0};k.calls++;
  if(!values.every(Number.isFinite)){stats.failures++;throw Error('NPC5 invalid inputs '+name);}
  if(mode==='native'){stats.native++;k.native++;return native();}
  const pool=inputs[name],depth=pool.depth++;let result;try{const input=pool.buffers[depth]??=new Float32Array(inputSizes[name]);input.set(values);result=Array.from(engine.evaluate(name,input));const [length,bits]=outputContract[name];if(result.length!==length||!result.every(Number.isFinite)||!bits.every(i=>result[i]===0||result[i]===1))throw Error('NPC5 malformed output '+name);if(name==='npc5_intent'&&(!Number.isInteger(result[0])||result[0]<0||result[0]>3))throw Error('NPC5 invalid intent output');}catch(error){stats.failures++;throw error;}finally{pool.depth=depth;}
  stats.evaluated++;k.evaluated++;
  if(repair){stats.boundaryRepairs++;k.boundaryRepairs++;stats.native++;k.native++;return native();}stats.weighted++;k.weighted++;return result;
 }
 const bool=x=>{if(x!==0&&x!==1){stats.failures++;throw Error('NPC5 non-bit output '+x);}return !!x;};
 const api={
  npcIntent5(conversation,rest,pending,night,walking,habit,roll){const index=habits.indexOf(habit||'greet'),h=index<0?7:index;if(!Number.isInteger(roll)||roll<0||roll>9)throw Error('NPC5 roll must be integer 0..9');const v=[bit(conversation),bit(rest),bit(pending),bit(night),bit(walking),h,roll],r=run('npc5_intent',v,()=>[npcNative5.intent(...v)])[0];if(!Number.isInteger(r)||r<0||r>3)throw Error('NPC5 invalid intent output');return intents[r];},
  npcBoard5(route,linked,priv,open,type,total){const t=type==='train'?1:type==='flight'?2:0,phase=t?((total%(t===1?10:90))+(t===1?10:90))%(t===1?10:90):0,v=[bit(route),bit(linked),bit(priv),bit(open),t,phase];return bool(run('npc5_board',v,()=>[+npcNative5.board(...v)],t===1?(near(phase,3.3)||near(phase,9.7)):t===2&&(near(phase,75)||near(phase,88)))[0]);},
  npcDepart5(process,route,allowed,scene,total,travelSince){const t=scene==='train'?1:scene==='flight'?2:0,age=total-travelSince,deadline=t===1?Math.ceil((travelSince+.15)/10)*10+3:t===2?Math.ceil((travelSince+.01)/90)*90+20:total,remaining=deadline-total,v=[bit(process),bit(route),bit(allowed),cap(age,-256,256),t,cap(remaining,-256,256)],r=run('npc5_depart',v,()=>{const n=npcNative5.depart(process,route,allowed,age,t,remaining);return[+n.eligible,+n.depart];},near(age,3)||(t!==0&&near(remaining,0)));return {eligible:bool(r[0]),depart:bool(r[1])};},
  npcFrame5(total,lastTotal,elapsed,lastOffscreen,rawDelta){const raw=Number.isFinite(rawDelta)?rawDelta:0,change=total-lastTotal,age=elapsed-lastOffscreen,v=[cap(change,-256,256),cap(age,-2,2),cap(raw,-1,1)],r=run('npc5_frame',v,()=>{const n=npcNative5.frame(change,age,raw);return[+n.jump,+n.offscreen,n.delta];},near(change,0)||near(change,120)||near(age,1));stats.nativeTimerCommits++;return {jump:bool(r[0]),offscreen:bool(r[1]),delta:Math.max(0,Math.min(.1,raw))};},
  npcWaitTick5(wait,delta,path){const next=wait-delta,r=run('npc5_wait',[cap(wait,-128,128),delta,bit(path)],()=>[next,+(!path&&next<=0)],near(next,0));stats.nativeTimerCommits++;return {wait:next,ready:bool(r[1])};},
  npcRestTick5(closeFor,delta,wait,close){const next=close?closeFor+delta:0,r=run('npc5_rest',[cap(closeFor,0,16),delta,cap(wait,-128,128),bit(close)],()=>[next,+(next>1.5||wait<=0&&!close)],near(next,1.5)||near(wait,0));stats.nativeTimerCommits++;return {closeFor:next,release:bool(r[1])};},
  npcBlockedTick5(blocked,delta){const next=blocked+delta,r=run('npc5_blocked',[cap(blocked,0,16),delta],()=>[next,+(next>.65)],near(next,.65));stats.nativeTimerCommits++;return {blockedFor:next,replan:bool(r[1])};},
  snapshot(){return {...stats,kernels:Object.fromEntries(Object.entries(stats.kernels).map(([k,v])=>[k,{...v}]))};}
 };
 return api;
}
