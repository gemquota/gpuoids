const minExponent = 5;
const minBoids = 1 << minExponent;
const maxBoidsTarget = 16_777_216;
const fpsInterval = 0.25;

export const initialBoids = minBoids;

const getElement = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const format = (count: number) => count.toLocaleString("en-US");

export const createUI = () => {
  const fpsBadge = getElement("fps-badge");
  const fpsLabel = getElement("fps");
  const countLabel = getElement("boid-count");
  const minLabel = getElement("boid-min");
  const maxLabel = getElement("boid-max");
  const view2D = getElement<HTMLButtonElement>("view-2d");
  const view3D = getElement<HTMLButtonElement>("view-3d");
  const slider = getElement<HTMLInputElement>("boid-slider");
  const predatorLabel = getElement("predator-label");
  const predatorToggle = getElement<HTMLInputElement>("predator-toggle");
  const springToggle = getElement<HTMLInputElement>("spring-toggle");
  const springSettingsPanel = getElement("spring-settings");
  const springState = getElement("spring-state");
  const springLength = getElement<HTMLInputElement>("spring-length");
  const springStretchiness = getElement<HTMLInputElement>("spring-stretchiness");
  const springConnections = getElement<HTMLInputElement>("spring-connections");
  const springLengthValue = getElement("spring-length-value");
  const springStretchinessValue = getElement("spring-stretchiness-value");
  const springConnectionsValue = getElement("spring-connections-value");
  const hint = getElement("hint");
  const benchmarkButton = getElement<HTMLButtonElement>("benchmark-button");
  const benchmarkResults = getElement<HTMLPreElement>("benchmark-results");
  const copyBenchmark = getElement<HTMLButtonElement>("copy-benchmark");
  const behaviorControls = getElement("behavior-controls");
  const behaviorMode = getElement<HTMLSelectElement>("behavior-mode");
  const behaviorStrength = getElement<HTMLInputElement>("behavior-strength");
  const behaviorFlow = getElement<HTMLInputElement>("behavior-flow");
  const behaviorPulse = getElement<HTMLInputElement>("behavior-pulse");
  const strengthValue = getElement("strength-value");
  const flowValue = getElement("flow-value");
  const pulseValue = getElement("pulse-value");

  let numBoids = initialBoids;
  let maxBoids = maxBoidsTarget;
  let is3D = false;
  let frames = 0;
  let fpsTimer = 0;
  let benchmarkRunning = false;

  const handlers = {
    numBoidsChanged: (_count: number) => {},
    viewChanged: (_is3D: boolean) => {},
    predatorChanged: (_enabled: boolean) => {},
    springBondsChanged: (_enabled: boolean) => {},
    springSettingsChanged: (_length: number, _stretchiness: number, _connections: number) => {},
    behaviorChanged: (_mode: number, _strength: number, _flow: number, _pulse: number) => {},
    benchmarkRequested: () => {},
  };

  const countFor = (exponent: number) =>
    exponent >= Math.log2(maxBoids) - 0.0001 ? maxBoids : Math.round(Math.pow(2, exponent));

  const getSpringSettings = () => ({
    length: springLength.valueAsNumber,
    stretchiness: springStretchiness.valueAsNumber,
    connections: springConnections.valueAsNumber,
  });

  const emitSpringSettings = () => {
    const settings = getSpringSettings();
    springLengthValue.textContent = settings.length.toFixed(2);
    springStretchinessValue.textContent = settings.stretchiness.toFixed(2);
    springConnectionsValue.textContent = settings.connections.toFixed(0);
    handlers.springSettingsChanged(settings.length, settings.stretchiness, settings.connections);
  };

  const emitBehavior = () => {
    const strength = behaviorStrength.valueAsNumber;
    const flow = behaviorFlow.valueAsNumber;
    const pulse = behaviorPulse.valueAsNumber;
    strengthValue.textContent = strength.toFixed(2);
    flowValue.textContent = flow.toFixed(2);
    pulseValue.textContent = pulse.toFixed(2);
    handlers.behaviorChanged(Number(behaviorMode.value), strength, flow, pulse);
  };

  const refresh = () => {
    const maxExponent = Math.log2(maxBoids);
    slider.max = maxExponent.toString();
    if (countFor(slider.valueAsNumber) !== numBoids) slider.valueAsNumber = Math.min(Math.log2(numBoids), maxExponent);
    const fill = (slider.valueAsNumber - minExponent) / (maxExponent - minExponent);
    slider.style.setProperty("--fill", `${Math.max(0, fill) * 100}%`);
    countLabel.textContent = format(numBoids);
    maxLabel.textContent = format(maxBoids);
    view2D.classList.toggle("segment--selected", !is3D);
    view3D.classList.toggle("segment--selected", is3D);
    predatorLabel.textContent = is3D ? "You are predator" : "Mouse is predator";
    hint.textContent = is3D
      ? "Drag to look around\nWASD + Q/E while dragging to fly\nHold Shift to fly faster"
      : "Drag to pan · Pinch to zoom";
    benchmarkButton.disabled = is3D || benchmarkRunning;
    behaviorControls.hidden = is3D;
  };

  view2D.onclick = () => { if (is3D) handlers.viewChanged(false); };
  view3D.onclick = () => { if (!is3D) handlers.viewChanged(true); };
  slider.oninput = () => {
    const count = countFor(slider.valueAsNumber);
    if (count !== numBoids) {
      numBoids = count;
      handlers.numBoidsChanged(count);
    }
    refresh();
  };
  slider.onpointerup = () => slider.blur();
  springToggle.onchange = () => {
    springToggle.blur();
    springSettingsPanel.classList.toggle("spring-settings--inactive", !springToggle.checked);
    springState.textContent = springToggle.checked ? "ON" : "OFF";
    springState.classList.toggle("spring-state--on", springToggle.checked);
    handlers.springBondsChanged(springToggle.checked);
  };
  springLength.oninput = emitSpringSettings;
  springStretchiness.oninput = emitSpringSettings;
  springConnections.oninput = emitSpringSettings;
  predatorToggle.onchange = () => {
    predatorToggle.blur();
    handlers.predatorChanged(predatorToggle.checked);
  };
  behaviorMode.onchange = emitBehavior;
  behaviorStrength.oninput = emitBehavior;
  behaviorFlow.oninput = emitBehavior;
  behaviorPulse.oninput = emitBehavior;
  benchmarkButton.onclick = () => handlers.benchmarkRequested();
  copyBenchmark.onclick = async () => {
    try {
      await navigator.clipboard.writeText(benchmarkResults.textContent ?? "");
      copyBenchmark.textContent = "Copied";
    } catch {
      copyBenchmark.textContent = "Select and copy the results above";
    }
  };

  minLabel.textContent = format(minBoids);
  emitBehavior();
  springSettingsPanel.classList.toggle("spring-settings--inactive", !springToggle.checked);
  springState.textContent = springToggle.checked ? "ON" : "OFF";
  springState.classList.toggle("spring-state--on", springToggle.checked);
  emitSpringSettings();
  refresh();

  return {
    on: handlers,
    getNumBoids: () => numBoids,
    getSpringSettings,
    setNumBoids: (count: number) => {
      numBoids = Math.max(minBoids, Math.min(Math.floor(count), maxBoids));
      slider.valueAsNumber = Math.log2(numBoids);
      refresh();
      handlers.numBoidsChanged(numBoids);
    },
    setBenchmarkRunning: (running: boolean) => {
      benchmarkRunning = running;
      benchmarkButton.textContent = running ? "Benchmark running…" : "Run GPU benchmark";
      refresh();
    },
    setBenchmarkResults: (report: string) => {
      benchmarkResults.hidden = !report;
      benchmarkResults.textContent = report;
      copyBenchmark.hidden = !report;
    },
    setView: (view3D: boolean) => {
      is3D = view3D;
      numBoids = initialBoids;
      predatorToggle.checked = false;
      refresh();
    },
    setLimit: (limit: number) => {
      maxBoids = Math.max(minBoids, Math.min(maxBoidsTarget, limit));
      numBoids = Math.min(numBoids, maxBoids);
      refresh();
    },
    frame: (deltaTime: number) => {
      frames++;
      fpsTimer += deltaTime;
      if (fpsTimer < fpsInterval) return;
      const fps = Math.round(frames / fpsTimer);
      fpsLabel.textContent = fps.toString();
      fpsBadge.classList.toggle("fps--good", fps >= 55);
      fpsBadge.classList.toggle("fps--ok", fps >= 30 && fps < 55);
      fpsBadge.classList.toggle("fps--bad", fps < 30);
      frames = 0;
      fpsTimer = 0;
    },
  };
};
