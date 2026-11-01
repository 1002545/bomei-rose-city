/** FP32 is used only for isolated decisions. World coordinates and integration
 * remain FP64. Compatibility repairs deliberately retain the original strict
 * comparisons, zero-segment behavior and even JS NaN/Infinity semantics.
 * Conservative absolute uncertainty guards for declared bounded domains:
 * AABB gap .1; band dz*dir .0001, overlap .001, x margins 1;
 * local circle squared margin .05. These exceed accumulated FP32 rounding
 * (including signed ReGLU multiply decomposition) by generous factors.
 */
export function nativeSegmentAABB(ax,az,bx,bz,box,radius){
 let enter=0,exit=1,hit=true;
 for(const [p,d,lo,hi]of[[ax,bx-ax,box[0]-radius+1e-8,box[1]+radius-1e-8],[az,bz-az,box[2]-radius+1e-8,box[3]+radius-1e-8]]){
  if(Math.abs(d)<1e-8){if(p<=lo||p>=hi){hit=false;break;}}
  else{let a=(lo-p)/d,b=(hi-p)/d;if(a>b)[a,b]=[b,a];enter=Math.max(enter,a);exit=Math.min(exit,b);if(enter>exit){hit=false;break;}}
 }return hit&&exit>=0&&enter<=1;
}
export function nativeDirectionalBand(ax,az,bx,bz,b){
 if((bz-az)*b.dir<-.001){const low=Math.max(Math.min(az,bz),b.z0),high=Math.min(Math.max(az,bz),b.z1);if(low<high){const t=((low+high)/2-az)/(bz-az),x=ax+(bx-ax)*t;if(x>b.x0&&x<b.x1)return true;}}return false;
}
export function nativeSegmentCircle(ax,az,bx,bz,c,radius){const dx=bx-ax,dz=bz-az,s=dx*dx+dz*dz,t=s?Math.max(0,Math.min(1,((c.x-ax)*dx+(c.z-az)*dz)/s)):0;return Math.hypot(ax+dx*t-c.x,az+dz*t-c.z)<c.radius+radius-1e-8;}
const within=(n,max)=>Number.isFinite(n)&&Math.abs(n)<=max;
const inRange=(a,max)=>{for(let i=0;i<a.length;i++)if(!within(a[i],max))return false;return true;};
const outputLengths={nav_segment_aabb:2,nav_directional_band:5,nav_segment_circle:2};
const aabbUncertain=o=>Math.abs(o[1])<=.1;
const bandUncertain=o=>Math.abs(o[1])<=.0001||Math.abs(o[2])<=.001||(o[1]<0&&o[2]>0&&(Math.abs(o[3])<=1||Math.abs(o[4])<=1));
const circleUncertain=o=>Math.abs(o[1])<=.05;
export function createNavigationLogic(engine,{mode='weights',warn=()=>{}}={}){
 if(!['weights','native'].includes(mode))throw Error('Invalid navigation mode '+mode);
 if(mode==='weights'&&typeof engine?.evaluate!=='function')throw Error('Navigation weights engine required');
 const stats={graphCalls:0,accepted:0,broadphaseSkipped:0,repairs:0,outOfDomain:0,errors:0};
 const inputs={nav_segment_aabb:new Float32Array(11),nav_directional_band:new Float32Array(10),nav_segment_circle:new Float32Array(6)};
 function repair(fn,out=false){stats.repairs++;if(out)stats.outOfDomain++;return fn();}
 function run(name,values,fn,uncertain){if(mode==='native')return repair(fn,true);try{const input=inputs[name];input.set(values);const out=engine.evaluate(name,input);stats.graphCalls++;if(!out||out.length!==outputLengths[name]||!out.every(Number.isFinite)||!(out[0]===0||out[0]===1))throw Error('Invalid navigation graph output '+name);if(uncertain(out))return repair(fn);stats.accepted++;return out[0]===1;}catch(error){stats.errors++;throw error;}}
 return {navStats:stats,snapshot:()=>({mode,...stats}),
  navSegmentAABB(ax,az,bx,bz,box,radius){const fn=()=>nativeSegmentAABB(ax,az,bx,bz,box,radius),v=[ax,az,bx,bz,box[0],box[1],box[2],box[3]];
   if(!inRange(v,64)||!Number.isFinite(radius)||radius<0||radius>4)return repair(fn,true);
   // Explicit native broadphase. Strict separation only: equal/touching edges
   // still reach the original slab semantics. Never count skips as inference.
   const x0=box[0]-radius+1e-8,x1=box[1]+radius-1e-8,z0=box[2]-radius+1e-8,z1=box[3]+radius-1e-8;
   if(x0<=x1&&z0<=z1&&((ax<x0&&bx<x0)||(ax>x1&&bx>x1)||(az<z0&&bz<z0)||(az>z1&&bz>z1))){stats.broadphaseSkipped++;return false;}
   const ix=1/(bx-ax),iz=1/(bz-az);if(!within(ix,64)||!within(iz,64))return repair(fn,true);v.push(radius,ix,iz);return run('nav_segment_aabb',v,fn,aabbUncertain);},
  navDirectionalBand(ax,az,bx,bz,b){const fn=()=>nativeDirectionalBand(ax,az,bx,bz,b),v=[ax,az,bx,bz,b.x0,b.x1,b.z0,b.z1],iz=1/(bz-az);if(!inRange(v,64)||!within(b.dir,1)||!within(iz,64))return repair(fn,true);v.push(b.dir,iz);return run('nav_directional_band',v,fn,bandUncertain);},
  navSegmentCircle(ax,az,bx,bz,c,radius){const fn=()=>nativeSegmentCircle(ax,az,bx,bz,c,radius),dx=bx-ax,dz=bz-az,ox=ax-c.x,oz=az-c.z,length=Math.hypot(dx,dz),rr=c.radius+radius-1e-8;
   // Native subtraction order matters at large translated world positions.
   if(!within(ax,64)||!within(az,64)||!within(bx,64)||!within(bz,64)||!within(c.x,64)||!within(c.z,64)||!within(ox,8)||!within(oz,8)||!Number.isFinite(rr)||rr<0||rr>8||!Number.isFinite(length)||length>16)return repair(fn,true);
   return run('nav_segment_circle',[length?dx/length:0,length?dz/length:0,ox,oz,length,rr],fn,circleUncertain);
  }
 };
}
