import test from 'node:test';
import assert from 'node:assert/strict';
import { OCTAHEDRON_BASE, GEOMETRY_CONSTRAINT, defineBaseTopology } from '../src/base-topology.js';
import { TranslationJob } from '../src/image-translation.js';
import { densityImage } from './helpers/density-fixtures.js';
const fast={yieldTask:async()=>{}};

test('base contract has six fixed vertices, twelve edge paths and eight closed triangular faces',async()=>{
 const m=await new TranslationJob().run(densityImage('corner'),fast),base=m.mesh.baseTopology;
 assert.equal(base.id,'octahedron');assert.equal(base.vertices.length,6);assert.equal(base.edges.length,12);assert.equal(base.faces.length,8);
 assert.equal(base.vertices.length-base.edges.length+base.faces.length,2);
 const links=new Set(m.mesh.links.map(([a,b])=>`${Math.min(a,b)},${Math.max(a,b)}`));
 for(let i=0;i<6;i++)assert.deepEqual(m.cached[i].point,OCTAHEDRON_BASE.vertices[i]);
 const coarse=new Set();
 for(const path of base.edges){
  const a=path[0],b=path.at(-1);coarse.add(`${Math.min(a,b)},${Math.max(a,b)}`);
  for(let i=1;i<path.length;i++)assert.ok(links.has(`${Math.min(path[i-1],path[i])},${Math.max(path[i-1],path[i])}`));
 }
 for(const face of base.faces)for(let i=0;i<3;i++){
  const a=face[i],b=face[(i+1)%3];assert.ok(coarse.has(`${Math.min(a,b)},${Math.max(a,b)}`));
 }
 assert.equal(m.mesh.primary.filter(Boolean).length,12*GEOMETRY_CONSTRAINT.edgeDivisions);
});

test('different image shapes cannot stretch the base into a box or remove its axial extent',async()=>{
 for(const name of ['ring','vertical','horizontal','clusters','corner','transparent','low','noise']){
  const m=await new TranslationJob().run(densityImage(name),fast);
  for(const p of m.cached){
   assert.ok(p.point.reduce((s,v)=>s+Math.abs(v),0)<=GEOMETRY_CONSTRAINT.envelope+1e-9,name);
   const delta=Math.hypot(...p.point.map((v,a)=>v-p.canonical[a]));
   assert.ok(delta<=(p.pinned?GEOMETRY_CONSTRAINT.maxEdgeOffset:GEOMETRY_CONSTRAINT.maxOffset)+1e-9,name);
  }
  const extents=[0,1,2].map(a=>Math.max(...m.cached.map(p=>p.point[a]))-Math.min(...m.cached.map(p=>p.point[a])));
  assert.ok(extents.every(v=>v>=2));assert.ok(Math.max(...extents)/Math.min(...extents)<=GEOMETRY_CONSTRAINT.envelope+1e-9);
  assert.equal(m.cached.filter(p=>Math.abs(p.point[0])>.65&&Math.abs(p.point[1])>.65).length,0,'box corners cannot exist');
 }
});

test('embedding tapers depth along triangular planes instead of assigning a rectangular slab thickness',()=>{
 const center=OCTAHEDRON_BASE.embedImage(.5,.5,1),corner=OCTAHEDRON_BASE.embedImage(1,1,1);
 assert.equal(center[2],1);assert.ok(corner[2]<.07);
 for(const u of [0,.2,.5,.8,1])for(const v of [0,.2,.5,.8,1])for(const depth of [-1,0,1]){
  const p=OCTAHEDRON_BASE.embedImage(u,v,depth);assert.ok(p.reduce((s,v)=>s+Math.abs(v),0)<=1+1e-9);
 }
});

test('regeneration varies image detail but preserves the same coarse scaffold and face incidence',async()=>{
 const job=new TranslationJob(),a=await job.run(densityImage('ring'),fast),b=await job.run(densityImage('ring'),fast);
 assert.deepEqual(a.mesh.baseTopology,b.mesh.baseTopology);assert.deepEqual(a.cached.slice(0,6).map(p=>p.point),b.cached.slice(0,6).map(p=>p.point));
 assert.notDeepEqual(a.cached.find(p=>!p.pinned).point,b.cached.find(p=>!p.pinned).point);
});

test('topology interface rejects missing embeddings and faces disconnected from their declared edges',()=>{
 assert.throws(()=>defineBaseTopology({id:'future',vertices:[],edges:[],faces:[]}),/embedding/);
 assert.throws(()=>defineBaseTopology({id:'invalid',vertices:[[0,0,0],[1,0,0],[0,1,0]],edges:[[0,1]],faces:[[0,1,2]],embedImage(){},constrain(){}}),/faces/);
});
