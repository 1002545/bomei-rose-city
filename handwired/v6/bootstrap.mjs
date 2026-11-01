/** Verified fused NPC seat transitions layered on all retained v5 neural logic. */
import {bomeiHW as baseLogic} from '../v5/bootstrap.mjs';
import {loadWeightEngine} from '../phase4/performance/loader.mjs';
import {createNpcSeatLogic} from './seat-adapter.mjs';
const baseRuntime=globalThis.bomeiHandwired,mode=baseRuntime.mode;
let seatEngine;
try { seatEngine=await loadWeightEngine(new URL('./artifacts/game-weights-hw6.manifest.json',import.meta.url)); }
catch(error){
 const text=globalThis.document?.getElementById('loading-text');
 if(text)text.textContent='神经网络座位权重加载失败，请刷新重试。'+error.message;
 globalThis.document?.getElementById('loading')?.classList.add('load-error');
 const retry=globalThis.document?.getElementById('load-retry');
 if(retry){retry.hidden=false;retry.onclick=()=>globalThis.location.reload();}
 if(globalThis.document?.body)globalThis.document.body.dataset.handwired='error';
 throw error;
}
const seatLogic=createNpcSeatLogic(seatEngine,{mode}),api={};
for(const logic of [baseLogic,seatLogic])for(const [name,value]of Object.entries(logic)){
 if(name==='stats'||name==='snapshot')continue;
 if(Object.hasOwn(api,name))throw Error('Duplicate neural gameplay API '+name);
 api[name]=value;
}
api.snapshot=()=>({base:baseLogic.snapshot(),seat:seatLogic.snapshot()});
Object.defineProperty(api,'stats',{get:()=>api.snapshot()});
export const bomeiHW=api;
globalThis.bomeiHandwired={...baseRuntime,version:'bomei-meme-hw6',logic:api,seatEngine,
 graphNames:[...baseRuntime.graphNames,...seatEngine.graphNames],
 verifiedSha256:{...baseRuntime.verifiedSha256,seat:seatEngine.verifiedSha256},
 coverage:{...baseRuntime.coverage,seat:seatEngine.manifest.coverage},
 snapshot:()=>{const base=baseRuntime.snapshot();return {...base,adapter:api.snapshot(),engineCalls:base.engineCalls+seatEngine.callCount,seatEngineCalls:seatEngine.callCount,perGraph:{...base.perGraph,...seatEngine.calls}};}};
if(globalThis.document?.body)globalThis.document.body.dataset.handwired=mode;
