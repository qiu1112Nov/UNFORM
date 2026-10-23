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

test('directional guidance is not a hard octahedral envelope or an equal-radius shell',async()=>{
 for(const name of ['ring','vertical','horizontal','clusters','corner','transparent','low','noise']){
  const m=await new TranslationJob().run(densityImage(name),fast);
  const radii=m.cached.map(p=>Math.hypot(...p.point));
  assert.ok(radii.every(r=>Number.isFinite(r)&&r<DENSITY_FIELD.maxRadius),name);
  assert.ok(Math.max(...radii)-Math.min(...radii)>.15,name);
  // A feature may naturally fit inside the reference; it need not be forced
  // outside. Corner UVs prove there is no L1 clipping of every sample.
  const corner=m.embed(.99,.01,1,0);
  assert.ok(corner.reduce((s,v)=>s+Math.abs(v),0)>1.025,name);
 }
});

test('the six base directions have pointed volume rather than a shallow rounded image slab',async()=>{
 const m=await new TranslationJob().run(densityImage('low'),fast),n=m.field.resolution;
 const cell=(u,v)=>Math.min(n-1,Math.floor(v*n))*n+Math.min(n-1,Math.floor(u*n));
 for(const [u,v,depth,axis,sign]of [[.99,.5,0,0,1],[.01,.5,0,0,-1],[.5,.01,0,1,1],[.5,.99,0,1,-1],[.5,.5,1,2,1],[.5,.5,-1,2,-1]]){
  const p=m.embed(u,v,depth,cell(u,v));assert.ok(p[axis]*sign>.75);
  assert.ok(p.filter((_,a)=>a!==axis).every(v=>Math.abs(v)<.04));
 }
 const axis=m.embed(.99,.5,1,cell(.99,.5)),corner=m.embed(.99,.01,1,cell(.99,.01));
 assert.ok(corner[0]/axis[0]<.66,'square corners taper to diagonal directions');
 const z=[.56,.66,.76].map(u=>m.embed(u,.58,1,cell(u,.58))[2]);
 assert.ok(Math.abs(z[0]-2*z[1]+z[2])<.006,'face depth is nearly piecewise linear, not a Gaussian dome');
 assert.ok(z[0]-z[2]>.2,'a pronounced triangular roof, not near-constant thickness');
 for(const axis of OCTAHEDRON_BASE.vertices){
  const count=m.cached.filter(p=>{
   const along=p.point.reduce((sum,v,a)=>sum+v*axis[a],0);
   return along>.55&&along/Math.hypot(...p.point)>.8;
  }).length;
  assert.ok(count>5,'actual sampled volume occupies each of the six directional cones');
 }
});

test('image-supported ridge portions bend existing nodes without adding a scaffold or closing reference edges',async()=>{
 for(const name of ['ring','corner','clusters']){
  const m=await new TranslationJob().run(densityImage(name),fast),ridges=m.cached.filter(p=>p.ridge);
  assert.ok(ridges.length>30&&ridges.length<850*.25,name);
  for(const p of ridges){
   assert.ok(m.field.contour[p.cell]>.18);assert.notEqual(p.kind,'interior');
   assert.ok(Number.isInteger(p.referenceEdge)&&p.referenceEdge<12);
   assert.ok(p.referenceDirection.filter(v=>v!==0).length===2,'an octahedral diagonal');
  }
  assert.ok(m.mesh.primary.every(p=>!p));assert.equal(m.cached.length,850);
  const directionalLinks=m.mesh.links.filter(([i,j])=>{
   const p=m.cached[i],q=m.cached[j],d=p.point.map((v,a)=>v-q.point[a]);
   return (p.ridge||q.ridge)&&p.referenceEdge===q.referenceEdge&&
    Math.abs(d.reduce((s,v,a)=>s+v*p.referenceDirection[a],0))/(Math.hypot(...d)*Math.hypot(...p.referenceDirection))>.7;
  });
  assert.ok(directionalLinks.length>30,'local graph contains actual slanted ridge portions, not just metadata');
  for(const v of OCTAHEDRON_BASE.vertices)assert.ok(!m.mesh.nodes.some(p=>Math.hypot(...p.map((x,a)=>x-v[a]))<.015));
 }
});

test('sparse facets share local graph nodes and follow octahedral triangular face directions',async()=>{
 for(const name of ['ring','corner','clusters']){
  const m=await new TranslationJob().run(densityImage(name),fast);
  assert.ok(m.mesh.triangles.length>0&&m.mesh.triangles.length<=DENSITY_FIELD.mobile.faces);
  assert.ok(m.stats.areaRatio<=DENSITY_FIELD.faceAreaRatio);
  for(const [i,j,k]of m.mesh.triangles){
   const a=m.mesh.nodes[i],b=m.mesh.nodes[j].map((v,d)=>v-a[d]),c=m.mesh.nodes[k].map((v,d)=>v-a[d]);
   const normal=[b[1]*c[2]-b[2]*c[1],b[2]*c[0]-b[0]*c[2],b[0]*c[1]-b[1]*c[0]];
   assert.ok(normal.reduce((s,v)=>s+Math.abs(v),0)/(Math.sqrt(3)*Math.hypot(...normal))>=DENSITY_FIELD.faceAlignment-1e-8);
   assert.ok(m.mesh.adjacency[i].includes(j)&&m.mesh.adjacency[j].includes(k)&&m.mesh.adjacency[k].includes(i));
  }
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
