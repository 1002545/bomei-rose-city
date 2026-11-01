/** Compose independently compiled, observable numerical gameplay modules. */
import {createGameLogic as createV1GameLogic} from '../../logic/adapter.mjs';
import {createCollisionLogic} from '../performance/collision-adapter.mjs';
import {createNpcLogic} from '../../phase2/npc/adapter.mjs';
import {createAnimationLogic} from '../performance/animation-adapter.mjs';
import {createControlsLogic} from '../../phase2/controls/adapter.mjs';

export function createGameLogic(engine, options={}) {
  const modules={
    core:createV1GameLogic(engine,options),
    collision:createCollisionLogic(engine,options),
    npc:createNpcLogic(engine,options),
    animation:createAnimationLogic(engine,options),
    controls:createControlsLogic(engine,options),
  };
  const api={};
  for(const [module,logic] of Object.entries(modules)) {
    if(typeof logic.snapshot!=='function')throw Error(`Handwired ${module}: snapshot missing`);
    for(const [name,value] of Object.entries(logic)) {
      if(name==='stats'||name==='snapshot')continue;
      // Keep the cached v1 dependency byte-identical while making retired
      // uncompiled entry points inaccessible from the phase-two public API.
      if(module==='core'&&(name==='npcMotion'||name==='addScaled'))continue;
      if(Object.hasOwn(api,name))throw Error(`Handwired duplicate adapter method: ${name}`);
      api[name]=value;
    }
  }
  function snapshot(){
    const moduleStats=Object.fromEntries(Object.entries(modules).map(([name,logic])=>[name,logic.snapshot()]));
    const result={mode:options.mode??'weights',calls:0,weighted:0,native:0,domainFallbacks:0,boundaryFallbacks:0,failures:0,kernels:{},modules:moduleStats};
    for(const stats of Object.values(moduleStats)){
      for(const [key,value] of Object.entries(stats)){
        if(typeof value==='number'&&Number.isFinite(value))result[key]=(result[key]??0)+value;
      }
      for(const [name,counter] of Object.entries(stats.kernels??{})){
        const target=result.kernels[name]??={};
        for(const [key,value] of Object.entries(counter))if(typeof value==='number'&&Number.isFinite(value))target[key]=(target[key]??0)+value;
      }
    }
    return result;
  }
  api.snapshot=snapshot;
  // A live read-only view preserves the v1 diagnostics interface without mixing
  // two state owners or periodically copying counters in the animation loop.
  api.stats=new Proxy({}, {
    get:(_target,key)=>snapshot()[key],
    ownKeys:()=>Reflect.ownKeys(snapshot()),
    getOwnPropertyDescriptor:()=>({enumerable:true,configurable:true}),
    set:()=>false,
  });
  return api;
}
