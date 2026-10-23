import { VERTICES, EDGES, FACES } from './octahedron.js';

// A reference describes connectivity, an optional guide and an envelope. Image
// materials can borrow a weak guide without rendering the reference or calling
// its hard envelope. Other bases must supply their
// own embedding/envelope; declaring a name alone never activates another shape.
export function defineBaseTopology({ id, vertices, edges, faces, embedImage, constrain }) {
  if (!id || typeof embedImage !== 'function' || typeof constrain !== 'function') throw new Error('A base requires an image embedding and envelope.');
  const edgeSet = new Set();
  for (const [a,b] of edges) {
    if (a === b || !vertices[a] || !vertices[b]) throw new Error('Invalid base edge.');
    edgeSet.add(`${Math.min(a,b)},${Math.max(a,b)}`);
  }
  for (const face of faces) for (let i=0;i<face.length;i++) {
    const a=face[i],b=face[(i+1)%face.length];
    if (!edgeSet.has(`${Math.min(a,b)},${Math.max(a,b)}`)) throw new Error('Base faces must reference base edges.');
  }
  return Object.freeze({ id,
    vertices: Object.freeze(vertices.map(v=>Object.freeze([...v]))),
    edges: Object.freeze(edges.map(v=>Object.freeze([...v]))),
    faces: Object.freeze(faces.map(v=>Object.freeze([...v]))), embedImage, constrain });
}

export const GEOMETRY_CONSTRAINT = Object.freeze({
  maxOffset: .065, maxEdgeOffset: .025, envelope: 1.025, edgeDivisions: 6,
});

export const OCTAHEDRON_BASE = defineBaseTopology({
  id: 'octahedron', vertices: VERTICES, edges: EDGES, faces: FACES,
  // Square-to-diamond embedding, with depth tapering to triangular face planes.
  // This is not an independent X/Y box plus constant front/back thickness.
  embedImage(u, v, depth) {
    const sx=(u-.5)*2, sy=(.5-v)*2;
    const x=sx*(1-Math.abs(sy)*.5)*.94, y=sy*(1-Math.abs(sx)*.5)*.94;
    return [x,y,Math.max(0,1-Math.abs(x)-Math.abs(y))*Math.max(-1,Math.min(1,depth))];
  },
  constrain(point, limit=GEOMETRY_CONSTRAINT.envelope) {
    const radius=Math.abs(point[0])+Math.abs(point[1])+Math.abs(point[2]);
    if(radius>limit)for(let a=0;a<3;a++)point[a]*=limit/radius;
    return point;
  },
});

export function createBaseScaffold(base, divisions=GEOMETRY_CONSTRAINT.edgeDivisions) {
  const points=base.vertices.map(v=>[...v]), links=[], paths=[];
  for(const [a,b]of base.edges){
    const path=[a];
    for(let i=1;i<divisions;i++){
      const t=i/divisions;path.push(points.length);
      points.push(base.vertices[a].map((v,axis)=>v*(1-t)+base.vertices[b][axis]*t));
    }
    path.push(b);paths.push(path);
    for(let i=1;i<path.length;i++)links.push([path[i-1],path[i]]);
  }
  return { base, points, links, paths, count:points.length };
}
