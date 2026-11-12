import { NodeMaterial, type StorageBufferAttribute } from "three/webgpu";
import { Fn, screenCoordinate, select, storage, uint, unpackUnorm4x8, uvec2, vec4 } from "three/tsl";
import type { BoidKernels } from "..";
import include from "./boid.wgsl?raw";
import boids from "./compute/boids.wgsl?raw";
import generateBoids from "./compute/generateBoids.wgsl?raw";
import raster from "./raster.wgsl?raw";

export const kernels2d: BoidKernels = {
  label: "2d",
  include,
  generateBoids,
  boids: `${boids}\n${raster}`,
  viewBindings: ["raster"],
  boidBytes: 8,
  searchBlockSize: 128,
  tileSize: 256,
  boidLimitPerGroup: 1024,
};

export const createRasterMaterial = (
  raster: StorageBufferAttribute,
  width: number,
  height: number,
  background: readonly [number, number, number],
) => {
  const pixels = storage(raster, "uint", width * height).toReadOnly();
  const material = new NodeMaterial();
  material.fragmentNode = Fn(() => {
    const pixel = uvec2(screenCoordinate);
    const row = uint(height - 1).sub(pixel.y);
    const packed = pixels.element(row.mul(width).add(pixel.x));
    return select(packed.equal(uint(0)), vec4(...background, 1), unpackUnorm4x8(packed));
  })();
  return material;
}
