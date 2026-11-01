import {loadWeightEngine} from '../performance/loader.mjs';
import {createGameLogic} from './adapter.mjs';
const mode=new URL(globalThis.location?.href??'https://localhost/').searchParams.get('handwired')==='native'?'native':'weights';
let engine;
try {
 engine=await loadWeightEngine(new URL('../../artifacts/game-weights-hw4.manifest.json',import.meta.url));
 if(engine.manifest.release!=='bomei2-hw4')throw Error('Handwired release mismatch: expected bomei2-hw4');
} catch(error) {
 const text=globalThis.document?.getElementById('loading-text');
 if(text)text.textContent='神经网络数值权重加载失败，请刷新重试。'+error.message;
 const loading=globalThis.document?.getElementById('loading');loading?.classList.add('load-error');
 const retry=globalThis.document?.getElementById('load-retry');
 if(retry){retry.hidden=false;retry.onclick=()=>globalThis.location.reload();}
 if(globalThis.document?.body)document.body.dataset.handwired='error';
 throw error;
}
export const bomeiHW=createGameLogic(engine,{mode});
globalThis.bomeiHandwired={version:'bomei2-hw4',mode,upstreamCommit:engine.manifest.upstream.commit,verifiedSha256:engine.verifiedSha256,graphNames:engine.graphNames,coverage:engine.manifest.coverage,logic:bomeiHW,engine,snapshot:()=>({adapter:bomeiHW.snapshot(),engineCalls:engine.callCount,perGraph:engine.calls})};
if(globalThis.document?.body)document.body.dataset.handwired=mode;
