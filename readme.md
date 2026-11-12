# gpuoids

A mobile-oriented, performance-focused evolution of [BoidsWebGPU](https://github.com/jtsorlinis/BoidsWebGPU), retaining its Three.js + WebGPU compute architecture and 2D/3D simulation modes.

## Live builds

- **Improved build:** https://gemquota.github.io/gpuoids/
- **Benchmark baseline:** https://gemquota.github.io/gpuoids/baseline/
- **Upstream project:** https://github.com/jtsorlinis/BoidsWebGPU

The baseline page uses the upstream simulation code with the same benchmark controls added. A push to `main` rebuilds and publishes both pages. The improved page includes the changes listed below. Both are built and deployed together so they can be compared on the same device and browser. The baseline keeps its original simulation/storage layout but now uses the same extended benchmark population ladder.

**First-time setup:** enable GitHub Pages in repository **Settings → Pages → Build and deployment → Source: GitHub Actions**. The workflow builds both versions automatically and deploys them once Pages is enabled.

## Changes in gpuoids

- Fixed 2D world dimensions that follow the viewport aspect ratio instead of changing with population.
- Hard positional containment after integration, with damped wall reflection. Boids cannot drift outside the world or wrap around.
- Density-aware circular rendering: at high populations the renderer samples a representative subset of boids and shrinks their screen-space footprint, while every boid still participates in simulation.
- 8-byte packed 2D boid state (two `f16x2` words) and a compact 32-bit-per-agent spatial grid, plus bounded neighbour sampling in dense cells, reducing storage and per-agent work enough to expose a 16,777,216-agent 2D capacity target on adapters with suitable limits.
- GPU-side behaviour presets: classic, tight schooling, vortex/milling, orbiting schools, dispersal/anti-flocking and travelling waves. Influence, directional drift and wave modulation are uniform updates, not per-agent CPU work.
- Two-finger touch pinch zoom; one-finger drag pans. Mouse drag and wheel zoom remain supported.
- On-device population sweep with FPS, average frame time, p95 frame time and post-sample GPU queue-drain measurements.

The original GPU spatial-grid, prefix-sum, sorted-neighbour and compute-shader architecture is retained. The 2D state uses half-float packing, so positions and velocities have lower precision than the original 32-bit representation.

## Benchmarking

Open both live builds on the **same device, browser, orientation and power mode**. Run the benchmark on the baseline first, then the improved build. Let the device cool between runs if it becomes warm.

The benchmark performs a warm-up, then samples each population for 2.5 seconds. It increases population from 32 up to 16,777,216 and stops escalating when measured frame rate falls below 20 FPS or the post-sample GPU queue drain exceeds 750 ms. The 2D capacity is constrained by the adapter's storage-buffer and dispatch limits; a 16M allocation is not a promise of 16M at interactive frame rates.

Reported values:

- **FPS:** observed animation-loop frame rate during the sample window.
- **Average ms / p95 ms:** average and 95th-percentile frame intervals.
- **Queue drain:** time for submitted GPU work to finish after the sample window.

FPS includes browser/compositor scheduling and is not a pure compute-shader timing. Queue-drain time is a coarse backlog indicator, not per-frame GPU timestamp profiling. Results are device-specific; do not compare runs made under different thermal or power conditions.

## Development

Requirements: Node.js 24+ and a browser with WebGPU support.

```sh
npm ci
npm run dev
npm run build
```

## Upstream

The original project and its authorship remain credited to [jtsorlinis/BoidsWebGPU](https://github.com/jtsorlinis/BoidsWebGPU). This repository is an independent derivative; it does not modify the upstream project.
