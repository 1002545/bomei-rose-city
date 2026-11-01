/** Actual collision decisions consume serialized Handwired clearance margins.
 * Native guards are explicit, counted, and retain the original double predicate.
 * Domain violations are compatible only if finite. No missing-weight fallback.
 */
const U=2**-24, TINY=1e-12;
export const collisionContracts={
  collision_box_margins:[[-512,512],[-512,512],[-512,512],[-512,512],[-512,512],[-512,512],[0,64]],
  collision_circle_margin2:[[-1024,1024],[-1024,1024],[0,64]],
  collision_segment_circle_margin2:[[-1024,1024],[-1024,1024],[-1024,1024],[-1024,1024],[0,1e8],[0,64]],
  collision_oriented_box_margins:[[-1024,1024],[-1024,1024],[0,64],[0,64],[-1,1],[-1,1],[0,64],[0,64]],
  collision_oriented_circle_margin2:[[-1024,1024],[-1024,1024],[-1,1],[-1,1],[0,64],[0,64],[0,64]],
  collision_interval_margins:[[-512,512],[-512,512],[-512,512],[-512,512]],
  collision_point_box_margin2:[[-512,512],[-512,512],[-512,512],[-512,512],[-512,512],[-512,512],[0,64]],
};
export const nativeCollision={
  boxContains(x,z,x0,x1,z0,z1,radius=0,strict=false){return strict?x>x0-radius&&x<x1+radius&&z>z0-radius&&z<z1+radius:x>=x0-radius&&x<=x1+radius&&z>=z0-radius&&z<=z1+radius;},
  circleWithin(x,z,cx,cz,radius,inclusive=false){const d=Math.hypot(x-cx,z-cz);return inclusive?d<=radius:d<radius;},
  segmentCircleWithin(x,z,tx,tz,cx,cz,radius){const dx=tx-x,dz=tz-z,s=dx*dx+dz*dz,t=s?Math.max(0,Math.min(1,((cx-x)*dx+(cz-z)*dz)/s)):0;return Math.hypot(x+dx*t-cx,z+dz*t-cz)<radius;},
  orientedBoxHit(dx,dz,rx,rz,c,s,w,l){return Math.abs(dx)<=rx+Math.abs(c)*w+Math.abs(s)*l&&Math.abs(dz)<=rz+Math.abs(s)*w+Math.abs(c)*l&&Math.abs(dx*c-dz*s)<=w+Math.abs(c)*rx+Math.abs(s)*rz&&Math.abs(dx*s+dz*c)<=l+Math.abs(s)*rx+Math.abs(c)*rz;},
  orientedCircleHit(dx,dz,c,s,w,l,radius,pad=0){const x=Math.max(0,Math.abs(dx*c-dz*s)-w-pad),z=Math.max(0,Math.abs(dx*s+dz*c)-l-pad);return x*x+z*z<radius*radius;},
  intervalOverlap(a0,a1,b0,b1){return a0<b1&&a1>b0;},
  pointBoxWithin(x,z,x0,x1,z0,z1,radius){return Math.hypot(Math.max(x0-x,0,x-x1),Math.max(z0-z,0,z-z1))<radius;},
};
collisionContracts.collision_boxes8_margins=[[-512,512],[-512,512],[0,64],...Array.from({length:32},()=>[-512,512])];
collisionContracts.collision_circles8_margin2=Array.from({length:8},()=>[[-1024,1024],[-1024,1024],[0,64]]).flat();
const magnitude=v=>{let m=1;for(let i=0;i<v.length;i++)m=Math.max(m,Math.abs(v[i]));return m;};
const linearError=v=>{let sum=0;for(let i=0;i<v.length;i++)sum+=Math.abs(v[i]);return 16*U*(1+sum)+TINY;};
const allMargins=(v,strict)=>{for(let i=0;i<v.length;i++)if(!(strict?v[i]>0:v[i]>=0))return false;return true;};
const nearMargin=(v,error)=>{for(let i=0;i<v.length;i++)if(Math.abs(v[i])<=error)return true;return false;};
const circleError=v=>64*U*magnitude(v)**2+TINY;
function squaredClearanceError(qx,qz,radius,coordinateError){
  const q=Math.max(Math.abs(qx),Math.abs(qz),Math.abs(radius));
  return 32*U*q*q+8*q*coordinateError+4*coordinateError*coordinateError+TINY;
}
export function createCollisionLogic(engine,{mode='weights',warn=console.warn}={}){
  if(mode!=='weights'&&mode!=='native')throw Error('Unknown Handwired collision mode: '+mode);
  if(mode==='weights'&&typeof engine?.evaluate!=='function')throw Error('Handwired collision engine is required');
  const buffers=Object.fromEntries(Object.entries(collisionContracts).map(([n,d])=>[n,new Float32Array(d.length)]));
  const stats={mode,calls:0,evaluated:0,weighted:0,native:0,domainFallbacks:0,boundaryFallbacks:0,failures:0,kernels:{},pointCacheScopes:0,pointCacheHits:0,pointCacheMisses:0,pointCacheBypasses:0,pointCacheStored:0,pointCachePeakEntries:0};
  const warned=new Set();
  function decide(name,values,native,weighted,boundary,forcedBoundary=false,semanticDomain=true){
    stats.calls++;const counter=stats.kernels[name]??={calls:0,weighted:0,native:0,domainFallbacks:0,boundaryFallbacks:0};counter.calls++;
    const contract=collisionContracts[name];
    let malformed=values.length!==contract.length;
    if(!malformed)for(let i=0;i<values.length;i++)if(!Number.isFinite(values[i])){malformed=true;break;}
    if(malformed){stats.failures++;throw Error('Handwired collision received malformed or non-finite input: '+name);}
    let valid=semanticDomain;
    if(valid)for(let i=0;i<values.length;i++)if(!(values[i]>=contract[i][0]&&values[i]<=contract[i][1])){valid=false;break;}
    function fallback(reason){stats.native++;counter.native++;if(mode==='weights'){stats[reason]++;counter[reason]++;const key=name+':'+reason;if(!warned.has(key)){warned.add(key);warn?.('[博美2 Handwired] Explicit native collision compatibility: '+key);}}return native();}
    if(mode==='native')return fallback();
    if(!valid)return fallback('domainFallbacks');
    if(forcedBoundary)return fallback('boundaryFallbacks');
    const input=buffers[name];input.set(values);let out;
    try{out=engine.evaluate(name,input);}catch(error){stats.failures++;throw error;}
    if(!out||!out.length){stats.failures++;throw Error('Handwired collision produced invalid output: '+name);}
    for(let i=0;i<out.length;i++)if(!Number.isFinite(out[i])){stats.failures++;throw Error('Handwired collision produced invalid output: '+name);}
    stats.evaluated++;
    if(boundary(out))return fallback('boundaryFallbacks');
    stats.weighted++;counter.weighted++;return weighted(out);
  }
  const boxBatch={values:Array.from({length:35},()=>.5),errors:Array.from({length:8},()=>.5),rectangles:null,x:0,z:0,radius:0,strict:false,first:0,count:0};
  boxBatch.native=()=>{const {rectangles,x,z,radius,strict,first,count}=boxBatch;for(let j=0;j<count;j++){const q=rectangles[first+j];if(nativeCollision.boxContains(x,z,q[0],q[1],q[2],q[3],radius,strict))return true;}return false;};
  boxBatch.weighted=o=>{const {strict,count}=boxBatch;for(let j=0;j<count;j++){const i=j*4;if(strict?o[i]>0&&o[i+1]>0&&o[i+2]>0&&o[i+3]>0:o[i]>=0&&o[i+1]>=0&&o[i+2]>=0&&o[i+3]>=0)return true;}return false;};
  boxBatch.boundary=o=>{const {errors,count}=boxBatch;for(let j=0;j<count;j++)for(let k=0;k<4;k++)if(Math.abs(o[j*4+k])<=errors[j])return true;return false;};
  const circleBatch={values:Array.from({length:24},()=>.5),errors:Array.from({length:8},()=>.5),circles:null,x:0,z:0,extra:0,first:0,count:0};
  circleBatch.native=()=>{const {circles,x,z,extra,first,count}=circleBatch;for(let j=0;j<count;j++){const q=circles[first+j];if(nativeCollision.circleWithin(x,z,q.x,q.z,q.radius+extra))return true;}return false;};
  circleBatch.weighted=o=>{const count=circleBatch.count;for(let j=0;j<count;j++)if(o[j]<0)return true;return false;};
  circleBatch.boundary=o=>{const {errors,count}=circleBatch;for(let j=0;j<count;j++)if(Math.abs(o[j])<=errors[j])return true;return false;};
  const corridorContains=(x,z,corridors)=>{if(!corridors)return false;for(let i=0;i<corridors.length;i++){const q=corridors[i];if(api.collisionBoxContains(x,z,q[0],q[1],q[2],q[3]))return true;}return false;};
  const api={
    stats,snapshot:()=>JSON.parse(JSON.stringify(stats)),
    // Created once inside each synchronous Km invocation. Only that invocation
    // holds the closure; no cached navigation decision survives the search.
    // Number-keyed maps do not quantize coordinates. +/-0 are equivalent for
    // these boolean predicates, while other distinct doubles stay distinct.
    collisionPointChecker(nav,{capacity=32768}={}){
      if(!Number.isInteger(capacity)||capacity<0||capacity>32768)throw Error('Invalid collision point-cache capacity');
      stats.pointCacheScopes++;
      const byX=new Map;let size=0;
      return function(point){
        const x=point[0],z=point[1],row=byX.get(x),stored=row?.get(z);
        if(stored!==undefined){stats.pointCacheHits++;return stored;}
        stats.pointCacheMisses++;
        const result=api.collisionWalkable(x,z,nav);
        if(size<capacity){
          let target=row;if(!target){target=new Map;byX.set(x,target);}target.set(z,result);size++;
          stats.pointCacheStored++;stats.pointCachePeakEntries=Math.max(stats.pointCachePeakEntries,size);
        }else stats.pointCacheBypasses++;
        return result;
      };
    },
    collisionWalkable(x,z,nav,radius=nav.agentRadius??.27){
      const b=nav.bounds;
      if(!api.collisionBoxContains(x,z,b[0],b[1],b[2],b[3])&&!corridorContains(x,z,nav.corridors))return false;
      if(api.collisionBoxesContainAny(x,z,nav.obstacles,radius,true))return false;
      return !(nav.circles&&api.collisionCirclesWithinAny(x,z,nav.circles,radius));
    },
    // R53: batch inputs live in preallocated buffers and the decide() callbacks are created once;
    // arithmetic (including the error-bound summation order) is unchanged.
    collisionBoxesContainAny(x,z,rectangles,radius=0,strict=false){
      if(rectangles.length<4){for(let i=0;i<rectangles.length;i++){const q=rectangles[i];if(api.collisionBoxContains(x,z,q[0],q[1],q[2],q[3],radius,strict))return true;}return false;}
      const values=boxBatch.values,errors=boxBatch.errors;
      boxBatch.rectangles=rectangles;boxBatch.x=x;boxBatch.z=z;boxBatch.radius=radius;boxBatch.strict=strict;
      values[0]=x;values[1]=z;values[2]=radius;
      try{
        for(let first=0;first<rectangles.length;first+=8){
          const count=Math.min(8,rectangles.length-first);
          boxBatch.first=first;boxBatch.count=count;
          for(let j=0;j<8;j++){
            const q=rectangles[first+Math.min(j,count-1)],o=3+j*4;values[o]=q[0];values[o+1]=q[1];values[o+2]=q[2];values[o+3]=q[3];
            if(j<count){let sum=0;sum+=Math.abs(x);sum+=Math.abs(z);sum+=Math.abs(q[0]);sum+=Math.abs(q[1]);sum+=Math.abs(q[2]);sum+=Math.abs(q[3]);sum+=Math.abs(radius);errors[j]=16*U*(1+sum)+TINY;}
          }
          if(decide('collision_boxes8_margins',values,boxBatch.native,boxBatch.weighted,boxBatch.boundary))return true;
        }
        return false;
      }finally{boxBatch.rectangles=null;}
    },
    collisionCirclesWithinAny(x,z,circles,extra=0){
      if(circles.length<4){for(let i=0;i<circles.length;i++){const q=circles[i];if(api.collisionCircleWithin(x,z,q.x,q.z,q.radius+extra))return true;}return false;}
      const values=circleBatch.values,errors=circleBatch.errors;
      circleBatch.circles=circles;circleBatch.x=x;circleBatch.z=z;circleBatch.extra=extra;
      try{
        for(let first=0;first<circles.length;first+=8){
          const count=Math.min(8,circles.length-first);
          circleBatch.first=first;circleBatch.count=count;
          for(let j=0;j<8;j++){
            const q=circles[first+Math.min(j,count-1)],v0=x-q.x,v1=z-q.z,v2=q.radius+extra,o=j*3;values[o]=v0;values[o+1]=v1;values[o+2]=v2;
            if(j<count){const m=Math.max(Math.max(Math.max(1,Math.abs(v0)),Math.abs(v1)),Math.abs(v2));errors[j]=64*U*m**2+TINY;}
          }
          if(decide('collision_circles8_margin2',values,circleBatch.native,circleBatch.weighted,circleBatch.boundary))return true;
        }
        return false;
      }finally{circleBatch.circles=null;}
    },
    collisionBoxContains(x,z,x0,x1,z0,z1,radius=0,strict=false){
      const values=[x,z,x0,x1,z0,z1,radius],error=linearError(values);
      return decide('collision_box_margins',values,()=>nativeCollision.boxContains(...values,strict),o=>allMargins(o,strict),o=>nearMargin(o,error));
    },
    collisionCircleWithin(x,z,cx,cz,radius,inclusive=false){
      const values=[x-cx,z-cz,radius],error=circleError(values);
      return decide('collision_circle_margin2',values,()=>nativeCollision.circleWithin(x,z,cx,cz,radius,inclusive),o=>inclusive?o[0]<=0:o[0]<0,o=>Math.abs(o[0])<=error);
    },
    collisionSegmentCircleWithin(x,z,tx,tz,cx,cz,radius){
      const dx=tx-x,dz=tz-z,s=dx*dx+dz*dz,ox=x-cx,oz=z-cz,inverse=s>=1e-8?1/s:0;
      const values=[ox,oz,dx,dz,inverse,radius];
      return decide('collision_segment_circle_margin2',values,()=>nativeCollision.segmentCircleWithin(x,z,tx,tz,cx,cz,radius),o=>o[0]<0,o=>{
        // Dot-product, reciprocal and clamp perturbation. Clamp is 1-Lipschitz.
        const projectionError=32*U*(Math.abs(ox*dx)+Math.abs(oz*dz))*inverse+TINY;
        const coordinateError=16*U*(Math.abs(ox)+Math.abs(oz)+Math.abs(dx)+Math.abs(dz)+1)+(Math.abs(dx)+Math.abs(dz))*projectionError;
        // Native reference reconstructs world coordinates before subtracting the
        // circle center, so retain its float64 cancellation error in this bound.
        const hostError=16*Number.EPSILON*(Math.abs(x)+Math.abs(z)+Math.abs(tx)+Math.abs(tz)+Math.abs(cx)+Math.abs(cz)+1);
        return Math.abs(o[0])<=squaredClearanceError(o[2],o[3],radius,coordinateError+hostError);
      },s<1e-8);
    },
    collisionOrientedBoxHit(dx,dz,rx,rz,c,s,w,l){
      const values=[dx,dz,rx,rz,c,s,w,l],error=4*linearError(values);
      return decide('collision_oriented_box_margins',values,()=>nativeCollision.orientedBoxHit(...values),o=>allMargins(o,false),o=>nearMargin(o,error));
    },
    collisionOrientedCircleHit(dx,dz,c,s,w,l,radius,pad=0){
      const values=[dx,dz,c,s,w+pad,l+pad,radius],coordinateError=4*linearError(values);
      return decide('collision_oriented_circle_margin2',values,()=>nativeCollision.orientedCircleHit(dx,dz,c,s,w,l,radius,pad),o=>o[0]<0,o=>Math.abs(o[0])<=squaredClearanceError(o[1],o[2],radius,coordinateError));
    },
    collisionIntervalOverlap(a0,a1,b0,b1){
      const values=[a0,a1,b0,b1],error=linearError(values);
      return decide('collision_interval_margins',values,()=>nativeCollision.intervalOverlap(...values),o=>o[0]>0&&o[1]>0,o=>nearMargin(o,error));
    },
    collisionPointBoxWithin(x,z,x0,x1,z0,z1,radius){
      const values=[x,z,x0,x1,z0,z1,radius],coordinateError=linearError(values);
      return decide('collision_point_box_margin2',values,()=>nativeCollision.pointBoxWithin(...values),o=>o[0]<0,o=>Math.abs(o[0])<=squaredClearanceError(o[1],o[2],radius,coordinateError),false,x0<=x1&&z0<=z1);
    },
  };
  return api;
}
