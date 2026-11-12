@binding(0) @group(0) var<uniform> params : Params;
@binding(1) @group(0) var<storage, read_write> boids : array<u32>;
@binding(2) @group(0) var<storage, read_write> gridOffsetsIn : array<atomic<u32>>;
@binding(3) @group(0) var<storage, read_write> grid : array<u32>;

@compute @workgroup_size(boidBlockSize)
fn main(@builtin(global_invocation_id) GlobalInvocationID : vec3<u32>) {
  let index = getBoidIndex(GlobalInvocationID);
  if (index >= params.numBoids) {
    return;
  }

  let base = params.rngSeed + index * 4u;
  let boid = Boid(
    vec2<f32>(rand_pcg(base, -params.xBound, params.xBound), rand_pcg(base + 1u, -params.yBound, params.yBound)),
    vec2<f32>(rand_pcg(base + 2u, -params.maxSpeed, params.maxSpeed), rand_pcg(base + 3u, -params.maxSpeed, params.maxSpeed)),
  );
  boids[index * 2u] = pack2x16float(boid.pos);
  boids[index * 2u + 1u] = pack2x16float(boid.vel);

  let cell = getGridID(boid.pos);
  grid[index] = cell;
  atomicAdd(&gridOffsetsIn[cell], 1u);
}
