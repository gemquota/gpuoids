// Rasterises compact circular boids into the screen-sized pixel buffer.

const boidScale: f32 = 0.1;
const boidRadius: f32 = 0.4;

fn getBoidColour(boid: Boid) -> u32 {
  var d = 1.0;
  if (params.mousePredator > 0u) {
    d = distance(boid.pos, params.mousePos) / params.zoom;
  }
  return pack4x8unorm(vec4<f32>(1.0, d, d, 1.0));
}

fn rasterizeBoid(boid: Boid) {
  let rasterSize = vec2<f32>(f32(params.renderWidth), f32(params.renderHeight));
  let screenScale = rasterSize / (params.viewportHalfSize * 2.0);
  let center = boid.pos * screenScale + rasterSize * 0.5 - params.cameraPos * screenScale;

  // Bound the pixel loop tightly around the circular footprint.
  let reach = boidRadius * boidScale * screenScale;
  let first = max(vec2<i32>(ceil(center - reach - 0.5)), vec2<i32>(0));
  let last = min(
    vec2<i32>(floor(center + reach - 0.5)),
    vec2<i32>(i32(params.renderWidth), i32(params.renderHeight)) - 1
  );
  if (first.x > last.x || first.y > last.y) {
    return;
  }

  let toMesh = 1.0 / (screenScale * boidScale);
  let colour = getBoidColour(boid);
  let radiusSq = boidRadius * boidRadius;

  for (var y = first.y; y <= last.y; y += 1) {
    let row = u32(y) * params.renderWidth;
    for (var x = first.x; x <= last.x; x += 1) {
      let offset = (vec2<f32>(f32(x), f32(y)) + 0.5 - center) * toMesh;
      if (dot(offset, offset) <= radiusSq) {
        raster[row + u32(x)] = colour;
      }
    }
  }
}
