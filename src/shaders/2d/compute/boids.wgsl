@binding(0) @group(0) var<uniform> params : Params;
@binding(1) @group(0) var<storage, read> boidsIn : array<u32>;
@binding(2) @group(0) var<storage, read_write> boidsOut : array<u32>;
@binding(3) @group(0) var<storage, read> sortedIndices : array<u32>;
@binding(4) @group(0) var<storage, read> gridOffsets : array<u32>;
@binding(5) @group(0) var<storage, read_write> gridOffsetsIn : array<atomic<u32>>;
@binding(6) @group(0) var<storage, read_write> grid : array<u32>;
// One packed rgba8 colour per pixel, rows from the bottom of the screen up.
// Cleared to 0 each frame, which the display draws as the background.
@binding(7) @group(0) var<storage, read_write> raster : array<atomic<u32>>;
// Both topology generations share one storage binding. This keeps the compute
// pipeline within WebGPU's portable eight-storage-buffer limit.
@binding(8) @group(0) var<storage, read_write> flockAttachments : array<vec2<u32>>;

// Neighbour rows staged once per group, as (pos, vel)
var<workgroup> tile : array<vec4<f32>, tileSize>;

const elasticDamping: f32 = 2.2;
const elasticReleaseFrames: u32 = 18u;
const elasticMaxAcceleration: f32 = 40.0;
const maxSpringConnections: u32 = 4u;

fn loadBoid(index: u32) -> Boid {
  return unpackBoid(boidsIn[index * 2u], boidsIn[index * 2u + 1u]);
}

fn storeBoid(index: u32, boid: Boid) {
  boidsOut[index * 2u] = pack2x16float(boid.pos);
  boidsOut[index * 2u + 1u] = pack2x16float(boid.vel);
}

fn addNeighbour(pos: vec2<f32>, otherPos: vec2<f32>, otherVel: vec2<f32>, otherIndex: u32, selfIndex: u32, candidateIndices: ptr<function, array<u32, 4>>, candidateDistances: ptr<function, array<f32, 4>>, center: ptr<function, vec2<f32>>, close: ptr<function, vec2<f32>>, avgVel: ptr<function, vec2<f32>>, neighbours: ptr<function, u32>, attachedCenter: ptr<function, vec2<f32>>, attachedVelocity: ptr<function, vec2<f32>>, attachedCount: ptr<function, u32>, closestAttachedDistSq: ptr<function, f32>) {
  let diff = pos - otherPos;
  let distSq = dot(diff, diff);
  if (distSq < params.visualRangeSq && distSq > 0.0) {
    if (params.springEnabled > 0u && otherIndex < selfIndex && distSq < params.minDistanceSq * (1.0 + f32(params.springConnections) * 0.5)) {
      let connectionLimit = min(params.springConnections, maxSpringConnections);
      var insertAt = maxSpringConnections;
      for (var candidate = 0u; candidate < connectionLimit; candidate += 1u) {
        if (distSq < (*candidateDistances)[candidate]) {
          insertAt = candidate;
          break;
        }
      }
      if (insertAt < connectionLimit) {
        var shift = i32(connectionLimit) - 1;
        loop {
          if (shift <= i32(insertAt)) { break; }
          (*candidateIndices)[u32(shift)] = (*candidateIndices)[u32(shift) - 1u];
          (*candidateDistances)[u32(shift)] = (*candidateDistances)[u32(shift) - 1u];
          shift -= 1;
        }
        (*candidateIndices)[insertAt] = otherIndex;
        (*candidateDistances)[insertAt] = distSq;
      }
    }
    if (distSq < params.minDistanceSq) {
      *close += diff * (1.0 / distSq - params.invMinDistanceSq);
    }
    *center += otherPos;
    *avgVel += otherVel;
    *neighbours += 1u;
  }
}

fn mergedBehaviours(boid: ptr<function, Boid>, localID: u32, selfIndex: u32, candidateIndices: ptr<function, array<u32, 4>>, candidateDistances: ptr<function, array<f32, 4>>, firstCell: u32, lastCell: u32, attachedCenter: ptr<function, vec2<f32>>, attachedVelocity: ptr<function, vec2<f32>>, attachedCount: ptr<function, u32>, closestAttachedDistSq: ptr<function, f32>, seedCenter: ptr<function, vec2<f32>>, neighbourCount: ptr<function, u32>) {
  var center : vec2<f32> = vec2<f32>();
  var close : vec2<f32> = vec2<f32>();
  var avgVel : vec2<f32> = vec2<f32>();
  var neighbours: u32 = 0u;
  for (var candidate = 0u; candidate < maxSpringConnections; candidate += 1u) {
    (*candidateIndices)[candidate] = 0xffffffffu;
    (*candidateDistances)[candidate] = 1e30;
  }

  let pos = (*boid).pos;
  *attachedCenter = vec2<f32>(0.0);
  *attachedVelocity = vec2<f32>(0.0);
  *attachedCount = 0u;
  *closestAttachedDistSq = 1e30;
  *seedCenter = vec2<f32>(0.0);
  *neighbourCount = 0u;
  let cell = getGridID(pos);

  // Loop around own cell. The group's boids are sorted by cell, so each row
  // they search together is one run of sorted indices, whose boids are staged
  // into the tile when they fit
  for (var i: i32 = -1; i <= 1; i += 1) {
    let row = u32(i * i32(params.gridDimX));
    let start = gridOffsets[cell + row - 2u];
    let end = gridOffsets[cell + row + 3u];
    let tileStart = gridOffsets[firstCell + row - 2u];
    let tileCount = gridOffsets[lastCell + row + 3u] - tileStart;
    let tiled = tileCount <= tileSize;

    workgroupBarrier();
    if (tiled) {
      for (var s = 0u; s < stagePasses; s += 1u) {
        let k = localID + s * searchBlockSize;
        if (k < tileCount) {
          tile[k] = packBoid(loadBoid(sortedIndices[tileStart + k]));
        }
      }
    }
    workgroupBarrier();

    if (tiled) {
      var j = start - tileStart;
      let tileEnd = end - tileStart;
      for (; j + 3u < tileEnd; j += 4u) {
        let o0 = tile[j];
        let o1 = tile[j + 1u];
        let o2 = tile[j + 2u];
        let o3 = tile[j + 3u];
        addNeighbour(pos, o0.xy, o0.zw, sortedIndices[tileStart + j], selfIndex, &center, &close, &avgVel, &neighbours, candidateIndices, candidateDistances, attachedCenter, attachedVelocity, attachedCount, closestAttachedDistSq);
        addNeighbour(pos, o1.xy, o1.zw, sortedIndices[tileStart + j + 1u], selfIndex, &center, &close, &avgVel, &neighbours, candidateIndices, candidateDistances, attachedCenter, attachedVelocity, attachedCount, closestAttachedDistSq);
        addNeighbour(pos, o2.xy, o2.zw, sortedIndices[tileStart + j + 2u], selfIndex, &center, &close, &avgVel, &neighbours, candidateIndices, candidateDistances, attachedCenter, attachedVelocity, attachedCount, closestAttachedDistSq);
        addNeighbour(pos, o3.xy, o3.zw, sortedIndices[tileStart + j + 3u], selfIndex, &center, &close, &avgVel, &neighbours, candidateIndices, candidateDistances, attachedCenter, attachedVelocity, attachedCount, closestAttachedDistSq);
      }
      // Up to 3 are left. Reading all 3 slots and testing the ones past the
      // end as the boid itself, which is never a neighbour, avoids a branch
      let last = tileEnd - 1u;
      let j0 = min(j, last);
      let j1 = min(j + 1u, last);
      let j2 = min(j + 2u, last);
      let o0 = tile[j0];
      let o1 = tile[j1];
      let o2 = tile[j2];
      addNeighbour(pos, select(pos, o0.xy, j < tileEnd), o0.zw, select(0xffffffffu, sortedIndices[tileStart + j0], j < tileEnd), selfIndex, &center, &close, &avgVel, &neighbours, candidateIndices, candidateDistances, attachedCenter, attachedVelocity, attachedCount, closestAttachedDistSq);
      addNeighbour(pos, select(pos, o1.xy, j + 1u < tileEnd), o1.zw, select(0xffffffffu, sortedIndices[tileStart + j1], j + 1u < tileEnd), selfIndex, &center, &close, &avgVel, &neighbours, candidateIndices, candidateDistances, attachedCenter, attachedVelocity, attachedCount, closestAttachedDistSq);
      addNeighbour(pos, select(pos, o2.xy, j + 2u < tileEnd), o2.zw, select(0xffffffffu, sortedIndices[tileStart + j2], j + 2u < tileEnd), selfIndex, &center, &close, &avgVel, &neighbours, candidateIndices, candidateDistances, attachedCenter, attachedVelocity, attachedCount, closestAttachedDistSq);
    } else {
      // Dense cells are sampled instead of making every boid inspect thousands
      // of neighbours. Sparse groups still use the exact shared-tile path above.
      let candidateCount = end - start;
      let sampleCount = min(candidateCount, params.neighborSampleLimit);
      if (sampleCount > 0u) {
        let sampleStride = max(1u, (candidateCount + sampleCount - 1u) / sampleCount);
        let phase = localID % sampleStride;
        var j = start + phase;
        if (j >= end) { j = start; }
        for (var sample = 0u; sample < sampleCount && j < end; sample += 1u) {
          let other = packBoid(loadBoid(sortedIndices[j]));
          addNeighbour(pos, other.xy, other.zw, sortedIndices[j], selfIndex, &center, &close, &avgVel, &neighbours, candidateIndices, candidateDistances, attachedCenter, attachedVelocity, attachedCount, closestAttachedDistSq);
          j += sampleStride;
        }
      }
    }
  }

  *neighbourCount = neighbours;
  if (neighbours > 0u) {
    let invNeighbours = 1.0 / f32(neighbours);
    center *= invNeighbours;
    *seedCenter = center;
    avgVel *= invNeighbours;

    var cohesionScale = 1.0;
    var alignmentScale = 1.0;
    var separationScale = 1.0;
    switch params.behaviorMode {
      case 1u: { // tight schooling
        cohesionScale = 1.2;
        alignmentScale = 1.8;
      }
      case 2u: { // local vortex / milling
        cohesionScale = 0.45;
        alignmentScale = 0.65;
        separationScale = 1.15;
      }
      case 3u: { // orbiting schools
        cohesionScale = 0.65;
        alignmentScale = 0.8;
      }
      case 4u: { // dispersal / anti-flocking
        cohesionScale = -0.25;
        alignmentScale = 0.2;
        separationScale = 2.35;
      }
      case 5u: { // travelling wave / ribbon motion
        cohesionScale = 0.8;
        alignmentScale = 1.15;
      }
      default: {}
    }

    let pulse = 1.0 + sin(params.simTime * 1.7 + (*boid).pos.x * 1.6) * params.modulation * 0.35;
    let strength = params.behaviorStrength;
    (*boid).vel += (center - (*boid).pos) * (params.cohesionFactor * cohesionScale * pulse * strength * params.dt);
    (*boid).vel += (avgVel - (*boid).vel) * (params.alignmentFactor * alignmentScale * pulse * strength * params.dt);
    (*boid).vel += close * (params.separationFactor * separationScale * strength * params.dt);

    let radial = center - (*boid).pos;
    let tangent = vec2<f32>(-radial.y, radial.x);
    if (params.behaviorMode == 2u && dot(tangent, tangent) > 0.000001) {
      (*boid).vel += normalize(tangent) * (strength * 1.8 * params.dt);
    }
    if (params.behaviorMode == 3u && dot(tangent, tangent) > 0.000001) {
      (*boid).vel += (normalize(tangent) * 2.1 + normalize(radial) * 0.35) * (strength * params.dt);
    }
    if (params.behaviorMode == 5u) {
      let wave = sin(params.simTime * 1.3 + (*boid).pos.x * 2.2 + (*boid).pos.y * 1.4);
      (*boid).vel += vec2<f32>(cos((*boid).pos.y * 1.4), sin((*boid).pos.x * 2.2)) * (wave * params.modulation * strength * params.dt);
    }
  }

  (*boid).vel += params.flowBias * (params.dt * params.behaviorStrength * 0.9);

}

fn limitSpeed(boid: ptr<function, Boid>) {
  let speed = length((*boid).vel);
  let clampedSpeed = clamp(speed, params.minSpeed, params.maxSpeed);
  (*boid).vel *= clampedSpeed / speed;
}

fn keepInBounds(boid: ptr<function, Boid>) {
  let bounds = vec2<f32>(params.xBound, params.yBound);
  let outside = step(bounds, abs((*boid).pos));
  (*boid).vel -= sign((*boid).pos) * outside * (params.turnSpeed * params.dt);
}

fn avoidPredators(boid: ptr<function, Boid>) {
  let diff = (*boid).pos - params.mousePos;
  let zoomedDist = length(diff) / params.zoom;
  if (zoomedDist < 1.0
      && abs((*boid).pos.y) < params.yBound
      && abs((*boid).pos.x) < params.xBound) {
    let dist = max(sqrt(params.minDistanceSq), zoomedDist);
    let strength = max(1.0, 2.0 / params.zoom);
    (*boid).vel += normalize(diff) / (dist * dist) * strength * params.dt;
  }
}

@compute @workgroup_size(searchBlockSize)
fn main(@builtin(workgroup_id) GroupID : vec3<u32>, @builtin(local_invocation_index) localID : u32) {
  let first = (GroupID.y * params.updateGroupsX + GroupID.x) * searchBlockSize;
  if (first >= params.numBoids) {
    return;
  }

  // Threads past the last boid still take part in the staging, as copies of the last boid
  let last = min(first + searchBlockSize, params.numBoids) - 1u;
  let index = first + localID;
  let boidIndex = sortedIndices[min(index, last)];
  var boid = loadBoid(boidIndex);
  let firstCell = getGridID(loadBoid(sortedIndices[first]).pos);
  let lastCell = getGridID(loadBoid(sortedIndices[last]).pos);

  var candidateIndices: array<u32, 4>;
  var candidateDistances: array<f32, 4>;
  var attachedCenter = vec2<f32>(0.0);
  var attachedVelocity = vec2<f32>(0.0);
  var attachedCount = 0u;
  var closestAttachedDistSq = 1e30;
  var seedCenter = vec2<f32>(0.0);
  var neighbourCount = 0u;
  mergedBehaviours(&boid, localID, boidIndex, &candidateIndices, &candidateDistances, firstCell, lastCell, &attachedCenter, &attachedVelocity, &attachedCount, &closestAttachedDistSq, &seedCenter, &neighbourCount);

  if (params.springEnabled > 0u) {
    let connectionLimit = min(params.springConnections, maxSpringConnections);
    var retainedParents: array<u32, 4>;
    for (var slot = 0u; slot < maxSpringConnections; slot += 1u) {
      let attachmentIndex = params.attachmentReadOffset + boidIndex * maxSpringConnections + slot;
      let packedAttachment = flockAttachments[attachmentIndex];
      var parentIndex = packedAttachment.x;
      let wasAttached = (packedAttachment.y & 1u) != 0u;
      var isAttached = wasAttached;
      var strainFrames = (packedAttachment.y >> 1u) & 0x7fu;
      var restLength = unpack2x16float(packedAttachment.y >> 16u).x;
      if (slot < connectionLimit && wasAttached && parentIndex < params.numBoids) {
        let parent = loadBoid(parentIndex);
        let delta = parent.pos - boid.pos;
        let distance = length(delta);
        rasterizeSpring(boid, parent.pos, boidIndex);
        let breakDistance = max(restLength * 3.0, 0.2);
        if (distance > breakDistance) {
          strainFrames = min(strainFrames + 1u, 127u);
        } else if (strainFrames > 0u) {
          strainFrames -= 1u;
        }
        if (strainFrames >= elasticReleaseFrames) {
          isAttached = false;
          parentIndex = 0xffffffffu;
          strainFrames = 0u;
        } else if (distance > 0.0001) {
          let direction = delta / distance;
          let relativeSpeed = dot(parent.vel - boid.vel, direction);
          let stiffness = mix(120.0, 8.0, clamp(params.springStretchiness, 0.0, 1.0));
          let springAcceleration = clamp((distance - restLength) * stiffness - relativeSpeed * elasticDamping, -elasticMaxAcceleration, elasticMaxAcceleration);
          boid.vel += direction * springAcceleration * params.dt;
        }
      } else if (wasAttached) {
        isAttached = false;
        parentIndex = 0xffffffffu;
        strainFrames = 0u;
      }
      retainedParents[slot] = select(0xffffffffu, parentIndex, isAttached);
      if (index < params.numBoids) {
        let restBits = pack2x16float(vec2<f32>(restLength, 0.0)) & 0xffffu;
        let attachmentState = (restBits << 16u) | (strainFrames << 1u) | select(0u, 1u, isAttached);
        flockAttachments[params.attachmentWriteOffset + boidIndex * maxSpringConnections + slot] = vec2<u32>(parentIndex, attachmentState);
      }
    }
    // Fill empty slots with distinct nearest candidates, retaining each bond's own rest length.
    for (var slot = 0u; slot < connectionLimit; slot += 1u) {
      if (retainedParents[slot] == 0xffffffffu) {
        var chosen = 0xffffffffu;
        for (var candidate = 0u; candidate < connectionLimit; candidate += 1u) {
          let possible = candidateIndices[candidate];
          var duplicate = false;
          for (var existing = 0u; existing < maxSpringConnections; existing += 1u) {
            if (retainedParents[existing] == possible) { duplicate = true; }
          }
          if (possible != 0xffffffffu && !duplicate) { chosen = possible; break; }
        }
        if (chosen != 0xffffffffu) {
          retainedParents[slot] = chosen;
          let restLength = max(params.springLength, 0.01);
          let restBits = pack2x16float(vec2<f32>(restLength, 0.0)) & 0xffffu;
          let state = (restBits << 16u) | 1u;
          if (index < params.numBoids) {
            flockAttachments[params.attachmentWriteOffset + boidIndex * maxSpringConnections + slot] = vec2<u32>(chosen, state);
          }
        }
      }
    }
    // Apply new bonds in the same frame they are captured.
    for (var slot = 0u; slot < connectionLimit; slot += 1u) {
      let parentIndex = retainedParents[slot];
      if (parentIndex < params.numBoids) {
        let parent = loadBoid(parentIndex);
        let delta = parent.pos - boid.pos;
        let distance = length(delta);
        if (distance > 0.0001) {
          let direction = delta / distance;
          let relativeSpeed = dot(parent.vel - boid.vel, direction);
          let stiffness = mix(120.0, 8.0, clamp(params.springStretchiness, 0.0, 1.0));
          let acceleration = clamp((distance - max(params.springLength, 0.01)) * stiffness - relativeSpeed * elasticDamping, -elasticMaxAcceleration, elasticMaxAcceleration);
          boid.vel += direction * acceleration * params.dt;
        }
      }
    }
  } else if (index < params.numBoids) {
    for (var slot = 0u; slot < maxSpringConnections; slot += 1u) {
      flockAttachments[params.attachmentWriteOffset + boidIndex * maxSpringConnections + slot] = vec2<u32>(0xffffffffu, 0u);
    }
  }
  limitSpeed(&boid);
  keepInBounds(&boid);
  if (params.mousePredator > 0) {
    avoidPredators(&boid);
  }

  boid.pos += boid.vel * params.dt;

  // Steering turns boids around gradually, but never guarantees containment
  // at large delta times. Clamp the integrated position and reflect only the
  // velocity component that hit a wall so no boid can escape the finite grid.
  let bounds = vec2<f32>(params.xBound, params.yBound);
  let boundedPos = clamp(boid.pos, -bounds, bounds);
  if (boundedPos.x != boid.pos.x) {
    boid.vel.x = -boid.vel.x * 0.75;
  }
  if (boundedPos.y != boid.pos.y) {
    boid.vel.y = -boid.vel.y * 0.75;
  }
  boid.pos = boundedPos;

  // Written in cell order, so next frame's neighbour reads stay close together
  if (index < params.numBoids) {
    storeBoid(boidIndex, boid);

    // Preserve stable identity while rebuilding the next frame's spatial bins.
    let cell = getGridID(boid.pos);
    grid[boidIndex] = cell;
    atomicAdd(&gridOffsetsIn[cell], 1u);

    rasterizeBoid(boid, boidIndex);
  }
}
