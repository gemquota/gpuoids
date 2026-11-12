// Rasterises a density-aware sample of the simulated flock into the pixel buffer.
fn getBoidColour(boid: Boid) -> u32 {
  var d = 1.0;
  if (params.mousePredator > 0u) {
    d = distance(boid.pos, params.mousePos) / params.zoom;
  }
  return pack4x8unorm(vec4<f32>(1.0, d, d, 1.0));
}

fn rasterizeBoid(boid: Boid, index: u32) {
  if (index % params.renderStride != 0u) {
    return;
  }

  let rasterSize = vec2<f32>(f32(params.renderWidth), f32(params.renderHeight));
  let screenScale = rasterSize / (params.viewportHalfSize * 2.0);
  let center = boid.pos * screenScale + rasterSize * 0.5 - params.cameraPos * screenScale;
  let reach = vec2<f32>(params.dotRadius + 0.5);
  let first = max(vec2<i32>(floor(center - reach)), vec2<i32>(0));
  let last = min(vec2<i32>(floor(center + reach)), vec2<i32>(i32(params.renderWidth), i32(params.renderHeight)) - 1);
  if (first.x > last.x || first.y > last.y) {
    return;
  }

  let colour = getBoidColour(boid);
  let radiusSq = params.dotRadius * params.dotRadius;
  for (var y = first.y; y <= last.y; y += 1) {
    let row = u32(y) * params.renderWidth;
    for (var x = first.x; x <= last.x; x += 1) {
      let offset = vec2<f32>(f32(x) + 0.5, f32(y) + 0.5) - center;
      if (dot(offset, offset) <= radiusSq) {
        atomicStore(&raster[row + u32(x)], colour);
      }
    }
  }
}


 // Thin cyan spring segment, transformed with the same camera as the boids.
fn rasterizeSpring(boid: Boid, anchor: vec2<f32>, index: u32) {
  if (params.springEnabled == 0u || index % params.renderStride != 0u) { return; }
  let rasterSize = vec2<f32>(f32(params.renderWidth), f32(params.renderHeight));
  let screenScale = rasterSize / (params.viewportHalfSize * 2.0);
  let a = boid.pos * screenScale + rasterSize * 0.5 - params.cameraPos * screenScale;
  let b = anchor * screenScale + rasterSize * 0.5 - params.cameraPos * screenScale;
  let delta = b - a;
  let steps = min(u32(ceil(max(abs(delta.x), abs(delta.y)))), 256u);
  let colour = pack4x8unorm(vec4<f32>(0.08, 0.82, 1.0, 1.0));
  if (steps == 0u) { return; }
  for (var step = 0u; step <= steps; step += 1u) {
    let point = a + delta * (f32(step) / f32(steps));
    let pixel = vec2<i32>(floor(point));
    if (pixel.x >= 0 && pixel.y >= 0 && pixel.x < i32(params.renderWidth) && pixel.y < i32(params.renderHeight)) {
      atomicStore(&raster[u32(pixel.y) * params.renderWidth + u32(pixel.x)], colour);
    }
  }
}
