import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";

const origin = process.env.BENCHMARK_ORIGIN ?? "http://127.0.0.1:4173";
const cap = process.env.BENCHMARK_MAX ?? "131072";
const targets = [
  { name: "baseline", path: `/gpuoids/baseline/?benchmarkMax=${cap}` },
  { name: "improved", path: `/gpuoids/?benchmarkMax=${cap}` },
];

const browser = await chromium.launch({
  headless: true,
  args: [
    "--enable-unsafe-webgpu",
    "--enable-features=Vulkan",
    "--use-angle=swiftshader",
    "--disable-dev-shm-usage",
    "--no-sandbox",
  ],
});

const report = {
  environment: {
    browser: "Chromium headless",
    renderer: "SwiftShader requested; actual adapter reported by WebGPU",
    viewport: "1280x720",
    benchmarkMax: Number(cap),
    generatedAt: new Date().toISOString(),
  },
  runs: [],
};

try {
  for (const target of targets) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(origin + target.path, { waitUntil: "load", timeout: 60_000 });

    const ready = await page.waitForFunction(
      () => !document.getElementById("loader") && !!document.getElementById("benchmark-button"),
      undefined,
      { timeout: 90_000 },
    ).then(() => true).catch(() => false);

    if (!ready) {
      report.runs.push({ name: target.name, skipped: true, reason: "WebGPU app did not finish initialization", errors });
      await page.close();
      continue;
    }

    const adapter = await page.evaluate(async () => {
      if (!navigator.gpu) return null;
      const gpuAdapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
      if (!gpuAdapter) return null;
      return {
        features: [...gpuAdapter.features],
        limits: {
          maxBufferSize: gpuAdapter.limits.maxBufferSize,
          maxStorageBufferBindingSize: gpuAdapter.limits.maxStorageBufferBindingSize,
          maxComputeWorkgroupsPerDimension: gpuAdapter.limits.maxComputeWorkgroupsPerDimension,
        },
      };
    });

    if (!adapter) {
      report.runs.push({ name: target.name, skipped: true, reason: "No WebGPU adapter in this runner", errors });
      await page.close();
      continue;
    }

    await page.click("#benchmark-button");
    await page.waitForFunction(
      () => {
        const button = document.getElementById("benchmark-button");
        return !!button && !button.disabled && button.textContent?.includes("Run GPU benchmark");
      },
      undefined,
      { timeout: 600_000 },
    );

    const resultText = await page.locator("#benchmark-results").innerText();
    report.runs.push({
      name: target.name,
      adapter,
      resultText,
      errors,
      skipped: resultText.startsWith("Benchmark stopped:"),
    });
    await page.close();
    // Give the software renderer a short breather between equivalent sweeps.
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
} finally {
  await browser.close();
}

await writeFile("benchmark-results.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
