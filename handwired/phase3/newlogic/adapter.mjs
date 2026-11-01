/** Explicit stateless numeric adapter. No input/camera/movement/yaw mutation. */
const clamp=x=>Math.max(0,Math.min(1,x));
const smooth=(a,b,x)=>{const u=clamp((x-a)/(b-a));return u*u*(3-2*u);};
const night=hour=>hour<12?1-smooth(5.5,8,hour):smooth(16.5,19.5,hour);
export const newLogicContracts={clock_presentation:[[0,24]],venue_hours_open:[[0,24],[0,24],[0,24]],hotel_lamp_amount:[[0,1]],street_night_amount:[[0,24]],lobby_night_profile:[[0,24],[0,1]],pool_night_profile:[[0,24],[0,1]],city_light_palette:[[0,1],[0,1],[0,1]]};
const lengths={clock_presentation:2,venue_hours_open:1,hotel_lamp_amount:1,street_night_amount:1,lobby_night_profile:4,pool_night_profile:5,city_light_palette:14};
export const newLogicNative={
 clockPresentation(hour){return[+(hour<6||hour>=19),hour<6||hour>=20?0:hour<10?1:hour<17?2:3];},
 venueHoursOpen:(hour,start,end)=>hour>=start&&hour<end,
 hotelLampAmount(daylight){const u=clamp((daylight-.25)/.35);return 1-u*u*(3-2*u);},
 streetNightAmount:night,
 lobbyNightProfile:(hour,lamp)=>[night(hour),2.55*lamp,1.44*lamp,1.5*lamp],
 poolNightProfile(hour,lamp){const n=night(hour),stars=hour<12?1-smooth(5.5,7,hour):smooth(18,20,hour);return[n,stars,2.1*lamp,1.8*lamp,1+.10*n];},
 cityLightPalette(daylight,streetNight,hotelLamp){const s=clamp((daylight-.02)/.33);return[s,.16+.64*daylight,.22+.6*daylight,.32+.52*daylight,.16+.84*s,.27+.73*daylight,.22+.78*daylight,.42+.58*s,.12+.88*streetNight,.08+1.12*streetNight,1.2*hotelLamp,.58*(.3+.7*daylight),.72*(.62+.38*s),.3*(.48+.52*daylight)];},
};
// Conservative envelopes include input rounding and official comparison lowering.
// They guard exact/adjacent FP64 decisions without reimplementing normal weights.
const U=2**-24;
export const comparisonBoundary=(a,b)=>Math.abs(a-b)<=16*U*(1+Math.abs(a)+Math.abs(b));
export function createNewLogic(engine,{mode='weights',warn=console.warn}={}){
 if(!['weights','native'].includes(mode))throw Error('Unknown newlogic Handwired mode: '+mode);
 if(mode==='weights'&&typeof engine?.evaluate!=='function')throw Error('Newlogic Handwired engine required');
 const stats={mode,calls:0,weighted:0,native:0,domainFallbacks:0,boundaryFallbacks:0,failures:0,kernels:{}},warned=new Set(),buffers=Object.fromEntries(Object.entries(newLogicContracts).map(([name,d])=>[name,new Float32Array(d.length)]));
 function evaluate(name,values,fallback,boundary=false){
  stats.calls++;const c=stats.kernels[name]??={calls:0,weighted:0,native:0,domainFallbacks:0,boundaryFallbacks:0,failures:0};c.calls++;
  const domain=newLogicContracts[name],valid=values.length===domain.length&&values.every((x,i)=>Number.isFinite(x)&&x>=domain[i][0]&&x<=domain[i][1]);
  // Preserve legacy unsupported/nonfinite semantics, including Qm's false result.
  if(mode==='native'||!valid||boundary){stats.native++;c.native++;if(mode==='weights'){const reason=!valid?'domainFallbacks':'boundaryFallbacks';stats[reason]++;c[reason]++;const key=name+':'+reason;if(!warned.has(key)){warned.add(key);warn('[博美2 Handwired] Explicit newlogic native compatibility path: '+key);}}return fallback();}
  const input=buffers[name];input.set(values);let out;
  try{out=engine.evaluate(name,input);if(!out||out.length!==lengths[name]||!Array.from(out).every(Number.isFinite))throw Error('Invalid newlogic Handwired output: '+name);if(name==='clock_presentation'&&(out[0]!==0&&out[0]!==1||!Number.isInteger(out[1])||out[1]<0||out[1]>3))throw Error('Invalid weighted clock classification');if(name==='venue_hours_open'&&out[0]!==0&&out[0]!==1)throw Error('Invalid weighted venue bit');}catch(error){stats.failures++;c.failures++;throw error;}
  stats.weighted++;c.weighted++;return Array.from(out);
 }
 const api={stats,snapshot:()=>JSON.parse(JSON.stringify(stats)),
  clockPresentation(hour){return evaluate('clock_presentation',[hour],()=>newLogicNative.clockPresentation(hour),[6,10,17,19,20].some(t=>comparisonBoundary(hour,t)));},
  venueHoursOpen(hour,start,end){return !!evaluate('venue_hours_open',[hour,start,end],()=>[+newLogicNative.venueHoursOpen(hour,start,end)],comparisonBoundary(hour,start)||comparisonBoundary(hour,end))[0];},
  hotelLampAmount(daylight){return evaluate('hotel_lamp_amount',[daylight],()=>[newLogicNative.hotelLampAmount(daylight)],[.25,.425,.6].some(t=>comparisonBoundary(daylight,t)))[0];},
  streetNightAmount(hour){return evaluate('street_night_amount',[hour],()=>[newLogicNative.streetNightAmount(hour)])[0];},
  lobbyNightProfile(hour,lamp){return evaluate('lobby_night_profile',[hour,lamp],()=>newLogicNative.lobbyNightProfile(hour,lamp));},
  poolNightProfile(hour,lamp){return evaluate('pool_night_profile',[hour,lamp],()=>newLogicNative.poolNightProfile(hour,lamp));},
  cityLightPalette(daylight,streetNight,hotelLamp){return evaluate('city_light_palette',[daylight,streetNight,hotelLamp],()=>newLogicNative.cityLightPalette(daylight,streetNight,hotelLamp));},
 };return api;
}
