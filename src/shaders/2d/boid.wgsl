// Shared by every 2D kernel. Two packed f16x2 words per boid keep the
// simulation state at 8 bytes per agent instead of 16.
struct Boid {
  pos : vec2<f32>,
  vel : vec2<f32>,
};

fn unpackBoid(packedPos: u32, packedVel: u32) -> Boid {
  return Boid(unpack2x16float(packedPos), unpack2x16float(packedVel));
}

fn loadBoid(index: u32) -> Boid {
  return unpackBoid(boidsIn[index * 2u], boidsIn[index * 2u + 1u]);
}

fn storeBoid(index: u32, boid: Boid) {
  boidsOut[index * 2u] = pack2x16float(boid.pos);
  boidsOut[index * 2u + 1u] = pack2x16float(boid.vel);
}

fn packBoid(boid: Boid) -> vec4<f32> {
  return vec4<f32>(boid.pos, boid.vel);
}

fn getGridID(pos: vec2<f32>) -> u32 {
  let x = i32(floor(pos.x * params.gridInverseCellSize * 2.0)) + i32(params.gridDimX / 2u);
  let y = i32(floor(pos.y * params.gridInverseCellSize)) + i32(params.gridDimY / 2u);
  return params.gridDimX * u32(y) + u32(x);
}
