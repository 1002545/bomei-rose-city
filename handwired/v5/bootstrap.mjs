/** Handwired v5: actual NPC/navigation decision circuits plus preserved v4 kernels. */
import {bomeiHW as baseLogic} from '../phase4/integration/bootstrap-hw4.mjs';
import {loadWeightEngine} from '../phase4/performance/loader.mjs';
import {createNpcStateLogic} from './npc-adapter.mjs';
import {createNavigationLogic} from './nav-adapter.mjs';
import {createTransitLogic} from './transit-adapter.mjs';
const baseRuntime=globalThis.bomeiHandwired;
const mode=baseRuntime.mode;
let extensionEngine;
try {
 extensionEngine=await loadWeightEngine(new URL('./artifacts/game-weights-hw5.manifest.json',import.meta.url));
} catch(error) {
 const text=globalThis.document?.getElementById('loading-text');
 if(text)text.textContent='神经网络玩法权重加载失败，请刷新重试。'+error.message;
 globalThis.document?.getElementById('loading')?.classList.add('load-error');
 const retry=globalThis.document?.getElementById('load-retry');
 if(retry){retry.hidden=false;retry.onclick=()=>globalThis.location.reload();}
 if(globalThis.document?.body)globalThis.document.body.dataset.handwired='error';
 throw error;
}
const modules={npcState:createNpcStateLogic(extensionEngine,{mode}),navigation:createNavigationLogic(extensionEngine,{mode}),transit:createTransitLogic(extensionEngine,{mode})};
const api={};
for(const logic of [baseLogic,...Object.values(modules)])for(const [name,value]of Object.entries(logic)){
 if(name==='snapshot'||name==='stats')continue;
 if(Object.hasOwn(api,name))throw Error('Duplicate neural gameplay API '+name);
 api[name]=value;
}
api.snapshot=()=>({base:baseLogic.snapshot(),modules:Object.fromEntries(Object.entries(modules).map(([name,logic])=>[name,logic.snapshot()]))});
Object.defineProperty(api,'stats',{get:()=>api.snapshot()});
export const bomeiHW=api;
globalThis.bomeiHandwired={version:'bomei-meme-hw5',mode,upstreamCommit:extensionEngine.manifest.upstream.commit,
 verifiedSha256:{base:baseRuntime.verifiedSha256,gameplay:extensionEngine.verifiedSha256},
 graphNames:[...baseRuntime.graphNames,...extensionEngine.graphNames],
 coverage:{base:baseRuntime.coverage,gameplay:extensionEngine.manifest.coverage??null},
 logic:api,engine:baseRuntime.engine,extensionEngine,
 snapshot:()=>({adapter:api.snapshot(),engineCalls:baseRuntime.engine.callCount+extensionEngine.callCount,
  perGraph:{...baseRuntime.engine.calls,...extensionEngine.calls},baseEngineCalls:baseRuntime.engine.callCount,gameplayEngineCalls:extensionEngine.callCount})};
if(globalThis.document?.body)globalThis.document.body.dataset.handwired=mode;
