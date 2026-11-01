// Adapter: plays protagonist-clips.json on the EXISTING dog rig through the bomeiR48 action API of the shipped runtime
// (api = window.__dogPose48 / bomeiR48.api). It only returns action descriptors; it never edits the rig, the coat or the
// existing actions. Errors are explicit (unknown clip, missing api fields); there is no fallback pose.
//   const clips = await loadDogClips('/assets/npcs/office/protagonist-clips.json');
//   api.start(dogClipAction(api, clips, 'keyboard-swing', {onEvent: e => { if (e === 'impact') hitTheManager(); }}));
export async function loadDogClips(url, fetcher = fetch) {
  const response = await fetcher(url);
  if (!response.ok) throw Error(`dog clips HTTP ${response.status} for ${url}`);
  const data = await response.json();
  if (data.schema !== 'bomei-dog-r48-clips.v1' || !data.clips) throw Error('not a bomei-dog-r48-clips.v1 file');
  return data;
}

// Sample one clip at u seconds (loops wrap; one-shots clamp). Returns plain numbers/arrays in dog model space.
export function sampleDogClip(data, name, u) {
  const clip = data.clips[name];
  if (!clip) throw Error(`unknown dog clip ${name}`);
  const n = clip.frames, f = u * data.fps;
  let i0, i1, k;
  if (clip.loop) { const w = ((f % n) + n) % n; i0 = Math.floor(w); i1 = (i0 + 1) % n; k = w - i0; }
  else { const c = Math.min(Math.max(f, 0), n - 1); i0 = Math.floor(c); i1 = Math.min(i0 + 1, n - 1); k = c - i0; }
  const tr = clip.tracks, s = (a) => a[i0] + (a[i1] - a[i0]) * k, v = (a) => a[i0].map((x, j) => x + (a[i1][j] - x) * k);
  const out = { torso: s(tr.torso), pitch: s(tr.pitch), roll: s(tr.roll), hop: s(tr.hop), yawOffset: s(tr.yawOffset),
    head: { yaw: s(tr.headYaw), pitch: s(tr.headPitch), roll: s(tr.headRoll) }, pawA: v(tr.pawA), pawB: v(tr.pawB), kA: s(tr.kA), kB: s(tr.kB),
    mouth: s(tr.mouth), blink: s(tr.blink), prop: null };
  if (tr.propCenter && tr.propCenter[i0]) out.prop = { name: clip.prop, center: tr.propCenter[i0], axis: tr.propAxis[i0] };
  return out;
}

// bomeiR48 action definition. Root clips set pos/yaw/pitch/roll/hop around the pose at start; root:false clips keep skipRoot
// (seat / carry: the existing seat or walk owns the root). Blink is exposed through onFrame because the shipped rig owns it.
export function dogClipAction(api, data, name, { onEvent = () => {}, onFrame = null, loop = null } = {}) {
  const clip = data.clips[name];
  if (!clip) throw Error(`unknown dog clip ${name}`);
  if (!api?.dog || !api?.model) throw Error('dogClipAction needs the bomeiR48 api (dog, model)');
  const V = api.dog.position.constructor, yaw0 = api.dog.rotation.y, pos0 = [api.dog.position.x, api.dog.position.z];
  const loops = loop ?? clip.loop, fired = new Set();
  return { name: 'office:' + name, keepY: !clip.root, fn: (u) => {
    if (!loops && u > clip.seconds) return null;
    const uu = loops ? u % clip.seconds : u;
    for (const e of clip.events) { const key = e.name + '@' + e.t + '#' + (loops ? Math.floor(u / clip.seconds) : 0); if (uu >= e.t && !fired.has(key)) { fired.add(key); onEvent(e.name, e.t); } }
    const s = sampleDogClip(data, name, u);
    api.model.updateMatrixWorld(true);
    const w = p => api.model.localToWorld(new V(p[0], p[1], p[2]));
    const pose = { skipRoot: !clip.root, torso: s.torso, head: s.head, paws: [{ w: w(s.pawA), k: s.kA }, { w: w(s.pawB), k: s.kB }], mouth: s.mouth };
    if (clip.root) Object.assign(pose, { pos: pos0, yaw: yaw0 + s.yawOffset, pitch: s.pitch, roll: s.roll, hop: s.hop });
    if (onFrame) onFrame(s);
    return pose;
  } };
}
