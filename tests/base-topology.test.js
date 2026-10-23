import test from 'node:test';
import assert from 'node:assert/strict';
import { OCTAHEDRON_BASE, defineBaseTopology } from '../src/base-topology.js';
import { DENSITY_FIELD } from '../src/density-field.js';
import { TranslationJob } from '../src/image-translation.js';
import { densityImage } from './helpers/density-fixtures.js';
const fast={yieldTask:async()=>{}};

test('six vertices, twelve edges and eight regions stay independent reference metadata, not display nodes',async()=>{
 const m=await new TranslationJob().run(densityImage('corner'),fast),reference=m.mesh.referenceTopology;
 assert.equal(reference,OCTAHEDRON_BASE);assert.equal(reference.vertices.length,6);assert.equal(reference.edges.length,12);assert.equal(reference.faces.length,8);
 assert.equal(reference.vertices.length-reference.edges.length+reference.faces.length,2);
 assert.equal(m.mesh.nodes.length,850);assert.ok(m.cached.every(p=>!p.pinned&&!p.baseVertex));
 assert.ok(m.mesh.primary.every(p=>!p));
 for(const vertex of reference.vertices)assert.equal(m.mesh.nodes.some(p=>p.every((v,a)=>v===vertex[a])),false);
 for(let i=0;i<850;i++)assert.equal(m.mesh.nodes[i],m.cached[i].point);
});

test('image structures can cross the old octahedral envelope without growing an equal-radius shell',async()=>{
 for(const name of ['ring','vertical','horizontal','clusters','corner','transparent','low','noise']){
  const m=await new TranslationJob().run(densityImage(name),fast);
  assert.ok(m.cached.some(p=>p.point.reduce((s,v)=>s+Math.abs(v),0)>1.025),name);
  const radii=m.cached.map(p=>Math.hypot(...p.point));
  assert.ok(radii.every(r=>Number.isFinite(r)&&r<DENSITY_FIELD.maxRadius),name);
  assert.ok(Math.max(...radii)-Math.min(...radii)>.15,name);
 }
});

test('continuous feature-dependent depth tapers away from the center rather than extruding parallel box faces',async()=>{
 const m=await new TranslationJob().run(densityImage('low'),fast),n=m.field.resolution;
 const center=m.embed(.5,.5,1,32*n+32),outer=m.embed(.94,.94,1,60*n+60);
 assert.ok(outer[2]<center[2]*.65);
 const depth=m.cached.map(p=>p.point[2]);
 assert.ok(new Set(depth.map(v=>Math.round(v*100))).size>30,'many depths instead of a pair of flat sheets');
});

test('regeneration changes visible placement while the implicit reference stays unchanged',async()=>{
 const job=new TranslationJob(),a=await job.run(densityImage('ring'),fast),b=await job.run(densityImage('ring'),fast);
 assert.equal(a.mesh.referenceTopology,b.mesh.referenceTopology);
 assert.notDeepEqual(a.cached[0].point,b.cached[0].point);
 assert.ok(a.cached.every(p=>!p.pinned));assert.ok(b.cached.every(p=>!p.pinned));
});

test('visible edges are all local connections, without seeded long reference-edge chains',async()=>{
 for(const name of ['ring','corner','clusters']){
  const m=await new TranslationJob().run(densityImage(name),fast);
  assert.ok(m.mesh.links.length>0);assert.ok(m.mesh.triangles.length>0);
  for(const [a,b]of m.mesh.links){
   const p=m.cached[a],q=m.cached[b];
   const d=Math.hypot(...p.point.map((v,i)=>v-q.point[i]));assert.ok(d<=.23+1e-8&&d>=.018-1e-8);
   const n=m.field.resolution,u=(p.uv[0]+q.uv[0])/2,v=(p.uv[1]+q.uv[1])/2;
   const support=m.field.density[Math.min(n-1,Math.floor(v*n))*n+Math.min(n-1,Math.floor(u*n))];
   assert.ok(support>=Math.max(.008,Math.min(p.density,q.density)*.1));
  }
 }
});

test('topology interface still rejects missing embeddings and disconnected faces',()=>{
 assert.throws(()=>defineBaseTopology({id:'future',vertices:[],edges:[],faces:[]}),/embedding/);
 assert.throws(()=>defineBaseTopology({id:'invalid',vertices:[[0,0,0],[1,0,0],[0,1,0]],edges:[[0,1]],faces:[[0,1,2]],embedImage(){},constrain(){}}),/faces/);
});
