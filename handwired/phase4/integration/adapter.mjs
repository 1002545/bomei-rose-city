/** Compose hw3 gameplay with additive, observable visual/daylight kernels. */
import {createGameLogic as createPhase2Logic} from './adapter-base-hw4.mjs';
import {createNewLogic} from '../../phase3/newlogic/adapter.mjs';
import {createAnimationExtensionLogic} from '../../phase3/animation/adapter.mjs';
import {createLogicPhase4} from '../logic/adapter.mjs';
import {createVisualPhase4} from '../visual/adapter.mjs';
export function createGameLogic(engine,options={}){
 const base=createPhase2Logic(engine,options);
 const extensions={newlogic:createNewLogic(engine,options),animationExtension:createAnimationExtensionLogic(engine,options),logicPhase4:createLogicPhase4(engine,options),visualPhase4:createVisualPhase4(engine,options)};
 const api={};
 for(const [module,logic] of [['phase2',base],...Object.entries(extensions)]){
  if(typeof logic.snapshot!=='function')throw Error(`Handwired ${module}: snapshot missing`);
  for(const [name,value] of Object.entries(logic)){
   if(name==='stats'||name==='snapshot')continue;
   if(Object.hasOwn(api,name))throw Error(`Handwired duplicate adapter method: ${name}`);
   api[name]=value;
  }
 }
 function snapshot(){
  const result=base.snapshot();
  for(const [module,logic] of Object.entries(extensions)){
   const stats=logic.snapshot();result.modules[module]=stats;
   for(const [key,value] of Object.entries(stats))if(typeof value==='number'&&Number.isFinite(value))result[key]=(result[key]??0)+value;
   for(const [name,counter] of Object.entries(stats.kernels??{})){
    const target=result.kernels[name]??={};
    for(const [key,value] of Object.entries(counter))if(typeof value==='number'&&Number.isFinite(value))target[key]=(target[key]??0)+value;
   }
  }
  return result;
 }
 api.snapshot=snapshot;
 api.stats=new Proxy({}, {get:(_target,key)=>snapshot()[key],ownKeys:()=>Reflect.ownKeys(snapshot()),getOwnPropertyDescriptor:()=>({enumerable:true,configurable:true}),set:()=>false});
 return api;
}
