import { LinearSRGBColorSpace, NodeMaterial, QuadMesh } from "three/webgpu";
import { createCamera2D } from "./cameras";
import { createBoidCompute, edgeMargin, visualRange } from "./compute";
import { type GPUContext, createStorageBuffer, shareWithRenderer } from "./gpu";
import { createRasterMaterial, kernels2d } from "./shaders/2d";

const backgroundColour = [0.19215687, 0.3019608, 0.4745098] as const;
const worldHalfHeight = 2.5;

export const createSim = async (
  { device, renderer }: GPUContext,
  canvas: HTMLCanvasElement,
  initialBoids: number,
) => {
  renderer.outputColorSpace = LinearSRGBColorSpace;
  const compute = await createBoidCompute(device, kernels2d, {
    mousePredator: "u32",
    zoom: "f32",
    mousePos: "vec2<f32>",
    renderWidth: "u32",
    renderHeight: "u32",
    viewportHalfSize: "vec2<f32>",
    cameraPos: "vec2<f32>",
    behaviorMode: "u32",
    behaviorStrength: "f32",
    flowBias: "vec2<f32>",
    modulation: "f32",
    simTime: "f32",
    dotRadius: "f32",
    renderStride: "u32",
    neighborSampleLimit: "u32",
  });
  const { params } = compute;
  params.set("behaviorMode", 0);
  params.set("behaviorStrength", 1);
  params.set("flowBias", [0, 0]);
  params.set("modulation", 0);
  params.set("simTime", 0);
  params.set("dotRadius", 0.85);
  params.set("renderStride", 1);

  const abort = new AbortController();
  const view = createCamera2D(canvas, abort.signal);
  const pointer = { x: 0, y: 0 };
  let gpuBusy = false;
  canvas.addEventListener("pointermove", (event) => {
    pointer.x = event.offsetX;
    pointer.y = event.offsetY;
  }, { signal: abort.signal });

  let numBoids = initialBoids;
  let pendingNumBoids = 0;
  let quad: QuadMesh | null = null;
  let rasterBuffer: GPUBuffer | null = null;
  let rasterMaterial: NodeMaterial | null = null;
  let rasterWidth = 0;
  let rasterHeight = 0;
  let previousAspect = 0;
  let viewInitialized = false;
  let simTime = 0;
  let lastDensityPixels = 0;

  const updateRasterDensity = () => {
    const pixels = rasterWidth * rasterHeight;
    if (pixels === 0) return;
    const stride = Math.max(1, Math.min(256, Math.ceil(numBoids / Math.max(1, pixels * 0.58))));
    const radius = numBoids >= 2_000_000 ? 0.56 : numBoids >= 262_144 ? 0.68 : numBoids >= 65_536 ? 0.9 : numBoids >= 1_024 ? 1.25 : 1.8;
    params.set("renderStride", stride);
    params.set("dotRadius", radius);
    params.set("neighborSampleLimit", Math.max(1, Math.min(8, Math.round(8 * Math.sqrt(65_536 / numBoids)))));
    lastDensityPixels = pixels;
  };

  const ensureRaster = () => {
    const width = Math.max(1, canvas.width);
    const height = Math.max(1, canvas.height);
    if (width === rasterWidth && height === rasterHeight) return;

    rasterBuffer?.destroy();
    rasterMaterial?.dispose();
    rasterBuffer = createStorageBuffer(device, width * height * 4);
    rasterWidth = width;
    rasterHeight = height;
    rasterMaterial = createRasterMaterial(
      shareWithRenderer(renderer, rasterBuffer, 1),
      width,
      height,
      backgroundColour,
    );
    if (quad) quad.material = rasterMaterial;
    else quad = new QuadMesh(rasterMaterial);
    compute.setViewBuffers({ raster: rasterBuffer });
  };

  const setup = () => {
    if (!viewInitialized) {
      view.resetView(worldHalfHeight);
      viewInitialized = true;
    }
    const aspect = rasterWidth / rasterHeight;
    previousAspect = aspect;
    const xBound = (worldHalfHeight - edgeMargin) * aspect;
    const yBound = worldHalfHeight - edgeMargin;
    const gridDimX = (Math.floor((xBound * 2) / visualRange) + 30) * 2;
    const gridDimY = Math.floor((yBound * 2) / visualRange) + 30;
    compute.setup(numBoids, gridDimX * gridDimY, { xBound, yBound, gridDimX, gridDimY });
    updateRasterDensity();
  };

  ensureRaster();
  setup();

  const frame = (deltaTime: number) => {
    if (gpuBusy) return;
    if (pendingNumBoids > 0) {
      numBoids = pendingNumBoids;
      pendingNumBoids = 0;
      setup();
    }
    ensureRaster();
    if (rasterWidth * rasterHeight !== lastDensityPixels) updateRasterDensity();
    const aspect = rasterWidth / rasterHeight;
    if (Math.abs(aspect - previousAspect) > 0.0001) setup();

    view.update(deltaTime);
    const mouseX = (pointer.x / canvas.clientWidth - 0.5) * view.orthoSize * 2 * aspect + view.x;
    const mouseY = -(pointer.y / canvas.clientHeight - 0.5) * view.orthoSize * 2 + view.y;
    params.set("zoom", view.orthoSize / 3);
    params.set("mousePos", [mouseX, mouseY]);
    params.set("renderWidth", rasterWidth);
    params.set("renderHeight", rasterHeight);
    params.set("viewportHalfSize", [view.orthoSize * aspect, view.orthoSize]);
    params.set("cameraPos", [view.x, view.y]);
    simTime += deltaTime;
    params.set("simTime", simTime);

    const encoder = device.createCommandEncoder();
    encoder.clearBuffer(rasterBuffer!);
    compute.encode(encoder, deltaTime);
    device.queue.submit([encoder.finish()]);
    quad!.render(renderer);
    gpuBusy = true;
    void device.queue.onSubmittedWorkDone().then(
      () => { gpuBusy = false; },
      () => { gpuBusy = false; },
    );
  };

  return {
    boidLimit: compute.boidLimit,
    frame,
    setNumBoids: (count: number) => {
      pendingNumBoids = Math.min(count, compute.boidLimit);
    },
    setPredator: (enabled: boolean) => params.set("mousePredator", enabled ? 1 : 0),
    setBehavior: (mode: number, strength: number, flow: number, pulse: number) => {
      params.set("behaviorMode", mode);
      params.set("behaviorStrength", strength);
      params.set("flowBias", [flow, 0]);
      params.set("modulation", pulse);
    },
    dispose: () => {
      abort.abort();
      compute.dispose();
      rasterBuffer?.destroy();
      rasterMaterial?.dispose();
    },
  };
};
