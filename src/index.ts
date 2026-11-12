import "./style.css";
import { initRenderer } from "./gpu";
import { createUI, initialBoids } from "./ui";

type Sim = Awaited<ReturnType<typeof import("./main2d").createSim>>;

const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
const loader = document.getElementById("loader") as HTMLElement;

const gpu = await initRenderer(canvas);
if (!gpu) {
  loader.textContent =
    "WebGPU is not supported on this browser, please update to the latest version of Chrome";
  throw new Error("WebGPU is not supported");
}
const { renderer, device } = gpu;

const ui = createUI();
let sim: Sim | null = null;
let starting = 0;
let is3D = false;
let benchmarkSamples: number[] | null = null;
let benchmarkRunning = false;

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));

const percentile = (values: number[], fraction: number) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
};

const runBenchmark = async () => {
  if (benchmarkRunning || is3D || !sim) return;
  benchmarkRunning = true;
  ui.setBenchmarkRunning(true);
  ui.setBenchmarkResults("Warming up GPU…");
  const originalCount = ui.getNumBoids();
  const requestedLimit = Number(new URLSearchParams(window.location.search).get("benchmarkMax"));
  const benchmarkCap =
    Number.isFinite(requestedLimit) && requestedLimit >= 32
      ? Math.min(requestedLimit, 16_777_216)
      : 16_777_216;
  const limit = Math.min(sim.boidLimit, benchmarkCap);
  const counts = [32, 128, 512, 2_048, 8_192, 32_768, 131_072, 524_288, 1_048_576, 2_097_152, 4_194_304, 8_388_608, 16_777_216]
    .filter((count) => count <= limit);
  const results: Array<{
    count: number;
    fps: number;
    averageMs: number;
    p95Ms: number;
    queueDrainMs: number;
  }> = [];

  try {
    for (const count of counts) {
      if (is3D || !sim) break;
      ui.setNumBoids(count);
      await wait(900);

      const samples: number[] = [];
      benchmarkSamples = samples;
      const startedAt = performance.now();
      await wait(2_500);
      benchmarkSamples = null;

      const elapsedMs = performance.now() - startedAt;
      const frameMs = samples.map((sample) => sample * 1000);
      const averageMs =
        frameMs.length > 0
          ? frameMs.reduce((sum, value) => sum + value, 0) / frameMs.length
          : 0;
      const fps = elapsedMs > 0 ? (samples.length * 1000) / elapsedMs : 0;

      const queueStartedAt = performance.now();
      await device.queue.onSubmittedWorkDone();
      const queueDrainMs = performance.now() - queueStartedAt;
      results.push({
        count,
        fps,
        averageMs,
        p95Ms: percentile(frameMs, 0.95),
        queueDrainMs,
      });

      ui.setBenchmarkResults(
        [
          "GPU population sweep",
          "Count       FPS   avg ms   p95 ms   queue drain",
          ...results.map(
            (result) =>
              `${result.count.toLocaleString().padStart(9)}  ${result.fps.toFixed(1).padStart(5)}  ${result.averageMs.toFixed(2).padStart(7)}  ${result.p95Ms.toFixed(2).padStart(7)}  ${result.queueDrainMs.toFixed(1).padStart(8)} ms`,
          ),
          "",
          "Frame pacing includes browser/compositor scheduling.",
          "Queue drain is measured after each sample window.",
        ].join("\n"),
      );

      // Stop escalating when the current population is already well below
      // interactive speed; larger allocations would add risk without value.
      if (fps < 20 || queueDrainMs > 750) break;
    }
  } catch (error) {
    ui.setBenchmarkResults(
      `Benchmark stopped: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    benchmarkSamples = null;
    if (!is3D && sim) ui.setNumBoids(originalCount);
    benchmarkRunning = false;
    ui.setBenchmarkRunning(false);
  }
};

const startSim = async (view3D: boolean) => {
  const start = ++starting;
  is3D = view3D;
  sim?.dispose();
  sim = null;
  ui.setView(view3D);

  const { createSim } = view3D
    ? await import("./main3d")
    : await import("./main2d");
  const next = await createSim(gpu, canvas, initialBoids);
  if (start !== starting) {
    next.dispose();
    return;
  }
  sim = next;
  ui.setLimit(sim.boidLimit);
  loader.remove();
};

ui.on.viewChanged = startSim;
ui.on.numBoidsChanged = (count) => sim?.setNumBoids(count);
ui.on.predatorChanged = (enabled) => sim?.setPredator(enabled);
ui.on.benchmarkRequested = () => void runBenchmark();

const resize = () => {
  const width = Math.max(1, canvas.clientWidth);
  const height = Math.max(1, canvas.clientHeight);
  if (canvas.width !== width || canvas.height !== height) {
    renderer.setSize(width, height, false);
  }
};
resize();
await startSim(false);

let lastTime: number | undefined;
renderer.setAnimationLoop((time) => {
  const deltaTime = lastTime === undefined ? 0 : (time - lastTime) / 1000;
  lastTime = time;
  ui.frame(deltaTime);
  if (benchmarkSamples && deltaTime > 0 && deltaTime < 0.25) {
    benchmarkSamples.push(deltaTime);
  }

  resize();
  sim?.frame(Math.min(deltaTime, 1 / 3));
});
