import test from 'node:test';
import assert from 'node:assert/strict';
import { TranslationJob, analyzeImage } from '../src/image-translation.js';
import { buildDensityField, DENSITY_FIELD } from '../src/density-field.js';
import { ParticleBudget } from '../src/performance.js';
import { advanceEdgeFlow } from '../src/flow-state.js';
import { densityImage } from './helpers/density-fixtures.js';
const fast = { yieldTask: async () => {} };
const make = (name, options = {}) => new TranslationJob().run(densityImage(name), { ...fast, ...options });

test('ring retains its density hole inside the mandatory geometric scaffold', async () => {
  const m = await make('ring');
  const image = m.cached.filter(p=>!p.pinned);
  const ring = image.filter(p=>{const r=Math.hypot((p.uv[0]-.5)*2,(p.uv[1]-.5)*2);return r>.36&&r<.76;}).length;
  assert.ok(ring/image.length>.9);
  assert.ok(image.filter(p=>Math.hypot(p.point[0],p.point[1])<.25).length<20);
  assert.ok(m.field.density[32*64+32]<.001);
  const min = Math.min(...m.cached.map(p => p.point[2])), max = Math.max(...m.cached.map(p => p.point[2]));
  assert.ok(max - min > .4, 'volume has front and back depth');
});

test('horizontal and vertical density patterns remain distinct inside the same base topology', async () => {
  const [vertical, horizontal] = await Promise.all([make('vertical'), make('horizontal')]);
  const variance = m => [0,1].map(a => m.cached.filter(p=>!p.pinned).reduce((s,p) => s+p.point[a]**2,0)/m.cached.filter(p=>!p.pinned).length);
  const [vx,vy] = variance(vertical), [hx,hy] = variance(horizontal);
  assert.ok(vy > vx * 6); assert.ok(hx > hy * 6);
  assert.notDeepEqual(vertical.mesh.links, horizontal.mesh.links);
});

test('separated subjects preserve negative space and do not receive bridging lines', async () => {
  const m = await make('clusters');
  assert.ok(m.cached.filter(p => !p.pinned && Math.abs(p.point[0]) < .10).length < 45);
  for (let link=0;link<m.mesh.links.length;link++){if(m.mesh.primary[link])continue;const [i,j]=m.mesh.links[link];assert.ok(Math.abs(m.cached[i].point[0]-m.cached[j].point[0])<.24);}
});

test('points, lines, facets and geometric glyphs share the same spatial node identities', async () => {
  const m = await make('corner'), links = new Set(m.mesh.links.map(([i,j]) => `${Math.min(i,j)},${Math.max(i,j)}`));
  assert.ok(m.stats.faces > 0 && m.stats.lines > 0 && m.stats.isolated > 0);
  assert.ok(m.cached.some(p => p.glyph === 'octa')); assert.ok(m.cached.some(p => p.glyph === 'tetra'));
  for (let i=0;i<m.cached.length;i++) assert.equal(m.mesh.nodes[i],m.cached[i].point);
  for (const t of m.mesh.triangles) {
    assert.equal(new Set(t).size,3);
    for (let i=0;i<3;i++) assert.ok(links.has(`${Math.min(t[i],t[(i+1)%3])},${Math.max(t[i],t[(i+1)%3])}`));
  }
});

test('line length and connectivity vary; a deliberate population of isolated points remains', async () => {
  const m = await make('ring');
  const lengths = m.mesh.links.map(([i,j]) => Math.hypot(...m.mesh.nodes[i].map((v,a)=>v-m.mesh.nodes[j][a])));
  assert.ok(Math.max(...lengths) > Math.min(...lengths) * 2);
  assert.ok(m.stats.isolated >= m.cachedCount * .08);
  assert.ok(m.mesh.adjacency.every(a=>a.length<=DENSITY_FIELD.degree));
});

test('mobile and desktop enforce node, line, facet, glyph and total facet area budgets', async () => {
  for (const count of [850,1900]) {
    const m = await make('ring',{count}), limits=count===850?DENSITY_FIELD.mobile:DENSITY_FIELD.desktop;
    assert.equal(m.cached.length,count);assert.ok(m.stats.lines<=limits.lines);assert.ok(m.stats.faces<=limits.faces);
    assert.ok(m.cached.filter(p=>p.glyph!=='point').length<=limits.glyphs);
    assert.ok(m.stats.areaRatio<=DENSITY_FIELD.faceAreaRatio+1e-8);
    assert.ok(m.stats.candidateChecks<=count*DENSITY_FIELD.candidates);
    assert.ok(m.cached.every(p=>p.point.every(v=>Number.isFinite(v)&&Math.abs(v)<1.5)));
  }
});

test('high density alone cannot create a solid mesh; low contrast and texture-only input avoid false glyphs/facets', async () => {
  for (const name of ['low','texture','noise']) {
    const m=await make(name);
    assert.ok(m.cached.every(p=>p.glyph==='point'));
    assert.equal(m.stats.faces,0);
    if(name==='noise')assert.equal(m.field.noiseDominated,true);
  }
});

test('transparent background is sparse while the opaque silhouette stays represented', async () => {
  const m=await make('transparent');
  const image=m.cached.filter(p=>!p.pinned);
  assert.ok(image.filter(p=>Math.hypot((p.uv[0]-.5)*2,(p.uv[1]-.5)*2)<.65).length/image.length>.95);
  await assert.rejects(make('empty'),/transparent/);
});

test('adjustable density weights change the field and default weights are not mutated', async () => {
  const f=await analyzeImage(densityImage('corner'),fast);
  const normal=await buildDensityField(f,fast), silhouettes=await buildDensityField(f,{...fast,weights:{contour:0,corner:0,silhouette:2}});
  assert.notDeepEqual(normal.density,silhouettes.density);assert.equal(DENSITY_FIELD.weights.contour,1.4);
});

test('regeneration varies placement, preserves silhouette, and a cancelled topology cannot publish', async () => {
  const job=new TranslationJob(), a=await job.run(densityImage('ring'),fast), b=await job.run(densityImage('ring'),fast);
  assert.notDeepEqual(a.cached.find(p=>!p.pinned).point,b.cached.find(p=>!p.pinned).point);assert.equal(a.cached.length,b.cached.length);
  await assert.rejects(job.run(densityImage('corner'),{...fast,progress(phase){if(phase==='CONNECTIONS')job.cancel();}}),{name:'AbortError'});
  assert.equal(job.result,null);
});

test('adaptive particle budgets handle variable image-driven categories without undefined nodes', async () => {
  const m=await make('ring');
  const points=m.cached.map((p,i)=>({...p,flow:m.createFlow(i)}));
  const budget=new ParticleBudget(points,595);
  assert.equal(budget.selected.reduce((a,b)=>a+b),595);
  for(const count of [425,850,510,595]){
    budget.setCount(count);budget.advance(1);
    assert.equal(budget.selected.reduce((a,b)=>a+b),count);assert.equal(budget.length,count);
    for(let i=0;i<points.length;i++)if(points[i].pinned)assert.equal(budget.selected[i],1);
    assert.ok([...budget.indices.subarray(0,budget.length)].every(i=>i<850));
  }
});

test('FLOW follows an actual graph edge, reuses its buffer, and cannot restore an octahedral path', async () => {
  const m=await make('ring');let flow;
  for(let i=0;i<850;i++){flow=m.createFlow(i);if(flow)break;}
  assert.ok(flow);const position=flow.position;
  for(const t of [0,1,4,10]){
    advanceEdgeFlow(flow,t);assert.equal(flow.position,position);
    const ab=flow.b.map((v,a)=>v-flow.a[a]);
    const d=ab.findIndex(v=>Math.abs(v)>.001),u=(position[d]-flow.a[d])/ab[d];
    assert.ok(u>=-.001&&u<=1.001);
    for(let a=0;a<3;a++)assert.ok(Math.abs(position[a]-(flow.a[a]+ab[a]*u))<1e-6);
  }
});

test('dark subjects on bright backgrounds attract density instead of weighting the empty bright backdrop', async () => {
  const m=await make('inverted');
  assert.ok(Math.abs(m.field.centroid.x-.23)<.04);assert.ok(Math.abs(m.field.centroid.y-.33)<.04);
  const image=m.cached.filter(p=>!p.pinned);
  const near=image.filter(p=>Math.hypot(p.uv[0]-.23,p.uv[1]-.33)<.2).length;
  assert.ok(near/image.length>.95);
});

test('a concentrated subject cannot turn spatial hashing into an unbounded all-pairs scan', async () => {
  const { buildTopology } = await import('../src/density-field.js');
  const samples=Array.from({length:1900},()=>({point:[0,0,0],density:1,tangent:0,coherence:0,kind:'surface',corner:0}));
  const mesh=await buildTopology(samples,DENSITY_FIELD.desktop,fast);
  assert.ok(mesh.stats.candidateChecks<=1900*DENSITY_FIELD.candidates);
  assert.equal(mesh.links.length,0);assert.equal(mesh.triangles.length,0);
});
