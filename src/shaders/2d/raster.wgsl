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
        raster[row + u32(x)] = colour;
      }
    }
  }
}
