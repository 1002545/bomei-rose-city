/** Runtime train profile. Native timestamp and exact edge compatibility shell. */
const phases=['away','arriving','opening','boarding','closing'];
const boundaries=[0,.3,6.7,7,8.6,10];
const nearBoundary=left=>{for(let i=0;i<boundaries.length;i++)if(Math.abs(left-boundaries[i])<=4e-6)return true;return false;};
const finiteOutput=output=>{for(let i=0;i<output.length;i++)if(!Number.isFinite(output[i]))return false;return true;};
const smooth=x=>{x=Math.max(0,Math.min(1,x));return x*x*(3-2*x);};
export function nativeTrainCycle(total){const depart=(Math.floor((total+1e-6)/10)+1)*10,left=depart-total,phase=left>8.6?'away':left>7?'arriving':left>6.7?'opening':left>.3?'boarding':'closing',doors=phase==='boarding'?1:phase==='opening'?smooth((7-left)/.3):phase==='closing'?smooth(left/.3):0;let offset=0;if(phase==='arriving')offset=28*(1-smooth((8.6-left)/1.6));else if(phase==='away')offset=-28*smooth((10-left)/1.25);return {depart,left,phase,doors,offset,board:phase==='boarding',seconds:Math.ceil(left*5)};}
export function createTransitLogic(engine,{mode='weights'}={}){
 if(!['weights','native'].includes(mode))throw Error('Invalid transit mode '+mode);
 if(mode==='weights'&&typeof engine?.evaluate!=='function')throw Error('Transit weight engine required');
 const input=new Float32Array(1),stats={mode,calls:0,graphCalls:0,accepted:0,native:0,boundaryRepairs:0,outOfDomain:0,errors:0};
 return {transitTrainCycle5(total){
  stats.calls++;if(mode==='native'){stats.native++;return nativeTrainCycle(total);}
  const depart=(Math.floor((total+1e-6)/10)+1)*10,left=depart-total;
  if(!Number.isFinite(left)||left<-.00001||left>10.00001){stats.native++;stats.outOfDomain++;return nativeTrainCycle(total);}
  if(nearBoundary(left)){stats.native++;stats.boundaryRepairs++;return nativeTrainCycle(total);}
  let output;try{input[0]=left;output=engine.evaluate('transit_train_cycle',input);stats.graphCalls++;if(!output||output.length!==4||!finiteOutput(output)||!Number.isInteger(output[0])||output[0]<0||output[0]>4||(output[3]!==0&&output[3]!==1)||output[3]!==+(output[0]===3))throw Error('Invalid transit graph output');}catch(error){stats.errors++;throw error;}
  stats.accepted++;return {depart,left,phase:phases[output[0]],doors:output[1],offset:output[2],board:output[3]===1,seconds:Math.ceil(left*5)};
 },snapshot:()=>({...stats})};
}
