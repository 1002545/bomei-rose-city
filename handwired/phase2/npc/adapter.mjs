/** Production adapter for phase-2 NPC decisions. No compiler/vendor imports.
 * Ordinary decisions consume serialized matrix results. Explicit compatibility
 * paths preserve FP64 boundary behavior or out-of-domain inputs. Broken weights
 * and execution errors throw, rather than pretending to have used a graph.
 */
export const npcContracts = {
  npc_decision_try_rest:[[0,1],[0,1],[0,1],[0,1]],
  npc_decision_follow_stop:[[0,1],[0,2048]],
  npc_decision_greet_stop:[[0,1],[0,1],[0,1],[0,2048]],
  npc_decision_attention:[[0,1],[0,1],[0,1],[0,2048],[-Math.PI,Math.PI]],
  npc_decision_idle_turn:[[0,1],[0,1],[0,2048],[0,2048]],
  npc_decision_rest_release:[[0,3600],[-3600,3600],[0,1]],
  npc_decision_rest_entry:[[0,2048]],
  npc_decision_path_arrival:[[0,2048],[0,.125],[0,1]],
  npc_decision_blocked_replan:[[0,3600]],
  npc_decision_moving:[[0,.125]],
  npc_decision_wait_ready:[[0,1],[-3600,3600]],
  npc_intent_eligibility:[[0,1],[0,1],[0,1],[0,1]],
  npc_activity_interest:[[0,1],[0,1],[0,1]],
  npc_candidate_distance:[[0,2048]],
};
const bitFields = {
  npc_decision_try_rest:[1,2,3], npc_decision_follow_stop:[0], npc_decision_greet_stop:[0,1,2],
  npc_decision_attention:[0,1,2], npc_decision_idle_turn:[0,1], npc_decision_rest_release:[2],
  npc_decision_rest_entry:[], npc_decision_path_arrival:[2], npc_decision_blocked_replan:[],
  npc_decision_moving:[], npc_decision_wait_ready:[0], npc_intent_eligibility:[0,1,2,3],
  npc_activity_interest:[0,1,2], npc_candidate_distance:[],
};
const bit = x => +!!x;
const roundError = x => Math.abs(Math.fround(x)-x);
const tiny = 2**-149;
// emitCompare implements exact comparisons of its FP32 operands. Outside the
// sum of their source-rounding errors, a rounded comparison has the same sign
// as the original Number comparison. Zero-width/equality boundaries are kept
// native too, preserving strict versus inclusive comparisons and signed zero.
export function npcNearBoundary(a,b,extraError=0) {
  return Math.abs(a-b) <= roundError(a)+roundError(b)+extraError+tiny;
}
export function npcArrivalThresholdError(step,finalSeatStep) {
  if(finalSeatStep)return roundError(step);
  const addError=roundError(step)+roundError(.001)+(2**-24)*(Math.abs(Math.fround(step))+Math.abs(Math.fround(.001)))+tiny;
  return Math.max(roundError(.012),addError);
}
export const npcNative = {
  npcDecisionTryRest:(random,rest,habitRest,observe)=>random<((rest||habitRest) ? .85 : observe ? .35 : .12),
  npcDecisionFollowStop:(following,distance)=>!!following&&distance<1.5,
  npcDecisionGreetStop:(yielding,following,greet,distance)=>!yielding&&!following&&!!greet&&distance<2.2,
  npcDecisionAttention(selected,moving,greet,distance,angle) {
    const attentive=!!selected||!moving&&!!greet&&distance<2;
    return {attentive,look:attentive?Math.max(-.75,Math.min(.75,angle)):0};
  },
  npcDecisionIdleTurn:(moving,hasGoal,goalDistance,playerDistance)=>!moving&&!!hasGoal&&goalDistance>.35&&playerDistance>1.1,
  npcDecisionRestRelease:(closeFor,wait,close)=>closeFor>1.5||wait<=0&&!close,
  npcDecisionRestEntry:distance=>distance<.25,
  npcDecisionPathArrival:(distance,step,finalSeatStep)=>distance<=(finalSeatStep?step:Math.max(.012,step+.001)),
  npcDecisionBlockedReplan:blockedFor=>blockedFor>.65,
  npcDecisionMoving:step=>step>.00001,
  npcDecisionWaitReady:(hasPath,wait)=>!hasPath&&wait<=0,
  npcIntentEligibility:(conversation,rest,pendingRest,validIntent)=>!conversation&&!rest&&!pendingRest&&!!validIntent,
  npcActivityInterest:(hasStand,instant,matchesHabit)=>!!hasStand&&!instant&&!!matchesHabit,
  npcCandidateDistance:distance=>distance>.65,
};
export function createNpcLogic(engine,{mode='weights',warn=console.warn}={}) {
  if(mode!=='weights'&&mode!=='native')throw Error('Unknown NPC Handwired mode: '+mode);
  if(mode==='weights'&&typeof engine?.evaluate!=='function')throw Error('NPC Handwired engine is required');
  const buffers=Object.fromEntries(Object.entries(npcContracts).map(([name,d])=>[name,new Float32Array(d.length)]));
  const stats={mode,calls:0,weighted:0,native:0,domainFallbacks:0,boundaryFallbacks:0,failures:0,retainedNativeCalls:0,retainedNativeMotion:0,retainedNativeYaw:0,kernels:{}};
  const warned=new Set();
  function evaluate(name,values,fallback,boundary=false) {
    stats.calls++; const counter=stats.kernels[name]??={calls:0,weighted:0,native:0,domainFallbacks:0,boundaryFallbacks:0}; counter.calls++;
    const domain=npcContracts[name];
    if(values.length!==domain.length||!values.every(Number.isFinite)||!bitFields[name].every(i=>values[i]===0||values[i]===1)){
      stats.failures++;throw Error('NPC Handwired received malformed or non-finite input: '+name);
    }
    const valid=values.every((x,i)=>x>=domain[i][0]&&x<=domain[i][1]);
    if(mode==='native'||!valid||boundary){
      stats.native++;counter.native++;
      if(mode==='weights'){
        const reason=valid?'boundaryFallbacks':'domainFallbacks';stats[reason]++;counter[reason]++;
        const key=name+':'+reason;
        if(!warned.has(key)){warned.add(key);warn('[博美2 Handwired NPC] Explicit native compatibility path: '+key);}
      }
      return fallback();
    }
    const input=buffers[name];input.set(values);let output;
    try{output=engine.evaluate(name,input);}catch(error){stats.failures++;throw error;}
    const size=name==='npc_decision_attention'?2:1;
    if(!output||output.length!==size||!Array.from(output).every(Number.isFinite)||output[0]!==0&&output[0]!==1){
      stats.failures++;throw Error('NPC Handwired produced malformed decision output: '+name);
    }
    stats.weighted++;counter.weighted++;return output;
  }
  function decision(name,method,values,boundary=false) {
    return evaluate(name,values,()=>[+npcNative[method](...values)],boundary)[0]===1;
  }
  return {
    stats,snapshot:()=>JSON.parse(JSON.stringify(stats)),
    // These are deliberately native production formulas, never compiled graphs.
    // FP32 motion/yaw failed exact/near U-turn behavior even when tested alone.
    // Count the retained scopes separately from compatibility and graph calls.
    recordNpcNativeScope(scope){
      if(scope!=='motion'&&scope!=='yaw')throw Error('Unknown retained native NPC scope: '+scope);
      stats.calls++;stats.native++;stats.retainedNativeCalls++;
      if(scope==='motion')stats.retainedNativeMotion++;else stats.retainedNativeYaw++;
    },
    npcDecisionTryRest(random,rest,habitRest,observe){
      const values=[random,bit(rest),bit(habitRest),bit(observe)],threshold=(rest||habitRest) ? .85 : observe ? .35 : .12;
      return decision('npc_decision_try_rest','npcDecisionTryRest',values,npcNearBoundary(random,threshold));
    },
    npcDecisionFollowStop(following,distance){return decision('npc_decision_follow_stop','npcDecisionFollowStop',[bit(following),distance],npcNearBoundary(distance,1.5));},
    npcDecisionGreetStop(yielding,following,greet,distance){return decision('npc_decision_greet_stop','npcDecisionGreetStop',[bit(yielding),bit(following),bit(greet),distance],npcNearBoundary(distance,2.2));},
    npcDecisionAttention(selected,moving,greet,distance,angle){
      const values=[bit(selected),bit(moving),bit(greet),distance,angle];
      const output=evaluate('npc_decision_attention',values,()=>{const o=npcNative.npcDecisionAttention(...values);return[+o.attentive,o.look];},npcNearBoundary(distance,2));
      return {attentive:output[0]===1,look:output[1]};
    },
    npcDecisionIdleTurn(moving,hasGoal,goalDistance,playerDistance){return decision('npc_decision_idle_turn','npcDecisionIdleTurn',[bit(moving),bit(hasGoal),goalDistance,playerDistance],npcNearBoundary(goalDistance,.35)||npcNearBoundary(playerDistance,1.1));},
    npcDecisionRestRelease(closeFor,wait,close){return decision('npc_decision_rest_release','npcDecisionRestRelease',[closeFor,wait,bit(close)],npcNearBoundary(closeFor,1.5)||npcNearBoundary(wait,0));},
    npcDecisionRestEntry(distance){return decision('npc_decision_rest_entry','npcDecisionRestEntry',[distance],npcNearBoundary(distance,.25));},
    npcDecisionPathArrival(distance,step,finalSeatStep){
      const threshold=finalSeatStep?step:Math.max(.012,step+.001);
      // The threshold is computed by a graph addition and max/select. Its
      // rounding envelope is separate from direct-input comparison envelopes.
      const boundary=Math.abs(distance-threshold)<=roundError(distance)+npcArrivalThresholdError(step,finalSeatStep)+tiny;
      return decision('npc_decision_path_arrival','npcDecisionPathArrival',[distance,step,bit(finalSeatStep)],boundary);
    },
    npcDecisionBlockedReplan(blockedFor){return decision('npc_decision_blocked_replan','npcDecisionBlockedReplan',[blockedFor],npcNearBoundary(blockedFor,.65));},
    npcDecisionMoving(step){return decision('npc_decision_moving','npcDecisionMoving',[step],npcNearBoundary(step,.00001));},
    npcDecisionWaitReady(hasPath,wait){return decision('npc_decision_wait_ready','npcDecisionWaitReady',[bit(hasPath),wait],npcNearBoundary(wait,0));},
    npcIntentEligibility(conversation,rest,pendingRest,validIntent){return decision('npc_intent_eligibility','npcIntentEligibility',[bit(conversation),bit(rest),bit(pendingRest),bit(validIntent)]);},
    npcActivityInterest(hasStand,instant,matchesHabit){return decision('npc_activity_interest','npcActivityInterest',[bit(hasStand),bit(instant),bit(matchesHabit)]);},
    npcCandidateDistance(distance){return decision('npc_candidate_distance','npcCandidateDistance',[distance],npcNearBoundary(distance,.65));},
  };
}
