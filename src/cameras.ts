import { MathUtils, type PerspectiveCamera } from "three/webgpu";

const { clamp, degToRad } = MathUtils;

const pointerSensitivity = 0.1;
const scrollSensitivity = 0.1;

const moveTowards = (value: number, target: number, maxDelta: number) =>
  Math.abs(target - value) <= maxDelta
    ? target
    : value + Math.sign(target - value) * maxDelta;

const attachDrag = (
  canvas: HTMLCanvasElement,
  signal: AbortSignal,
  onDrag: (dx: number, dy: number) => void,
) => {
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  canvas.addEventListener(
    "pointerdown",
    (event) => {
      if (event.button !== 0 && event.button !== 2) return;
      dragging = true;
      lastX = event.clientX;
      lastY = event.clientY;
      canvas.setPointerCapture(event.pointerId);
      if (event.pointerType === "mouse") {
        void canvas.requestPointerLock?.()?.catch(() => {
          // Dragging still works when pointer lock is unavailable
        });
      }
    },
    { signal },
  );

  canvas.addEventListener(
    "pointermove",
    (event) => {
      const locked = document.pointerLockElement === canvas;
      const dx = locked ? event.movementX : event.clientX - lastX;
      const dy = locked ? event.movementY : event.clientY - lastY;
      lastX = event.clientX;
      lastY = event.clientY;
      if (dragging) onDrag(dx, dy);
    },
    { signal },
  );

  const release = () => {
    if (!dragging) return;
    dragging = false;
    if (document.pointerLockElement === canvas) document.exitPointerLock();
  };
  canvas.addEventListener("pointerup", release, { signal });
  canvas.addEventListener("pointercancel", release, { signal });
  canvas.addEventListener("contextmenu", (event) => event.preventDefault(), {
    signal,
  });

  return { isDragging: () => dragging };
};

export const createCamera2D = (canvas: HTMLCanvasElement, signal: AbortSignal) => {
  const maxZoom = 2;
  const smoothing = 10;
  let zoom = 1;
  let minZoom = 1;

  const view = {
    x: 0,
    y: 0,
    orthoSize: 1,

    resetView: (size: number) => {
      view.x = 0;
      view.y = 0;
      view.orthoSize = size;
      zoom = size;
      minZoom = zoom + Math.sqrt(zoom) / 2;
    },

    update: (deltaTime: number) => {
      zoom = clamp(zoom, maxZoom, minZoom);
      view.orthoSize +=
        (zoom - view.orthoSize) * Math.min(deltaTime * smoothing, 1);
    },
  };

  // Pointer tracking is shared by mouse, pen and touch. Two touch pointers
  // pinch to zoom; a single pointer pans. This avoids treating a pinch as two
  // competing one-finger drags.
  const pointers = new Map<number, { x: number; y: number; type: string }>();
  let pinchDistance = 0;

  const distance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.hypot(a.x - b.x, a.y - b.y);

  canvas.addEventListener(
    "pointerdown",
    (event) => {
      if (event.pointerType === "mouse" && event.button !== 0 && event.button !== 2) return;
      pointers.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
        type: event.pointerType,
      });
      canvas.setPointerCapture(event.pointerId);
      if (event.pointerType === "mouse") {
        void canvas.requestPointerLock?.()?.catch(() => {
          // Pointer movement remains available without pointer lock
        });
      }
      const touches = [...pointers.values()].filter((pointer) => pointer.type === "touch");
      pinchDistance = touches.length >= 2 ? distance(touches[0], touches[1]) : 0;
    },
    { signal },
  );

  canvas.addEventListener(
    "pointermove",
    (event) => {
      const previous = pointers.get(event.pointerId);
      if (!previous) return;

      const locked = document.pointerLockElement === canvas;
      const dx = locked ? event.movementX : event.clientX - previous.x;
      const dy = locked ? event.movementY : event.clientY - previous.y;
      previous.x = event.clientX;
      previous.y = event.clientY;

      const touches = [...pointers.values()].filter((pointer) => pointer.type === "touch");
      if (touches.length >= 2) {
        const nextDistance = distance(touches[0], touches[1]);
        if (pinchDistance > 0 && nextDistance > 0) {
          // A wider pinch zooms in (smaller orthographic size).
          zoom = clamp(zoom * (pinchDistance / nextDistance), maxZoom, minZoom);
        }
        pinchDistance = nextDistance;
        return;
      }

      if (pointers.size === 1) {
        const panSpeed = view.orthoSize / 57.5;
        view.x -= dx * pointerSensitivity * panSpeed;
        view.y += dy * pointerSensitivity * panSpeed;
      }
    },
    { signal },
  );

  const releasePointer = (event: PointerEvent) => {
    pointers.delete(event.pointerId);
    const touches = [...pointers.values()].filter((pointer) => pointer.type === "touch");
    pinchDistance = touches.length >= 2 ? distance(touches[0], touches[1]) : 0;
    if (document.pointerLockElement === canvas) document.exitPointerLock();
  };
  canvas.addEventListener("pointerup", releasePointer, { signal });
  canvas.addEventListener("pointercancel", releasePointer, { signal });
  canvas.addEventListener("contextmenu", (event) => event.preventDefault(), {
    signal,
  });

  canvas.addEventListener(
    "wheel",
    (event) => {
      const notches =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? event.deltaY / 3
          : event.deltaY / 100;
      zoom += notches * scrollSensitivity * (view.orthoSize / 2);
    },
    { signal, passive: true },
  );

  return view;
};

// Keys ramp in and out over a third of a second
const keyRamp = 3;
const moveSpeed = 10;
const fastMultiplier = 3;
const pitchLimit = degToRad(88);
const lookSensitivity = degToRad(pointerSensitivity * 1.5);

export const createCamera3D = (
  camera: PerspectiveCamera,
  canvas: HTMLCanvasElement,
  signal: AbortSignal,
) => {
  camera.rotation.order = "YXZ";
  const keyAxes = { x: 0, y: 0, z: 0 };
  const heldKeys = new Set<string>();

  const drag = attachDrag(canvas, signal, (dx, dy) => {
    camera.rotation.y -= dx * lookSensitivity;
    camera.rotation.x = clamp(
      camera.rotation.x - dy * lookSensitivity,
      -pitchLimit,
      pitchLimit,
    );
  });

  window.addEventListener(
    "keydown",
    (event) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      heldKeys.add(event.code);
    },
    { signal },
  );
  window.addEventListener("keyup", (event) => heldKeys.delete(event.code), {
    signal,
  });
  window.addEventListener("blur", () => heldKeys.clear(), { signal });

  const held = (...codes: string[]) => codes.some((code) => heldKeys.has(code));

  const ramp = (value: number, negative: boolean, positive: boolean, deltaTime: number) => {
    const target = (positive ? 1 : 0) - (negative ? 1 : 0);
    if (value * target < 0) value = 0;
    return moveTowards(value, target, keyRamp * deltaTime);
  };

  return {
    resetView: (z: number) => {
      camera.position.set(0, 0, z);
      camera.rotation.set(0, 0, 0);
    },

    update: (deltaTime: number) => {
      keyAxes.x = ramp(keyAxes.x, held("KeyA", "ArrowLeft"), held("KeyD", "ArrowRight"), deltaTime);
      keyAxes.y = ramp(keyAxes.y, held("KeyQ"), held("KeyE"), deltaTime);
      keyAxes.z = ramp(keyAxes.z, held("KeyS", "ArrowDown"), held("KeyW", "ArrowUp"), deltaTime);

      if (drag.isDragging()) {
        const speed =
          moveSpeed * (held("ShiftLeft", "ShiftRight") ? fastMultiplier : 1) * deltaTime;
        camera.translateX(keyAxes.x * speed);
        camera.translateY(keyAxes.y * speed);
        camera.translateZ(-keyAxes.z * speed);
      }
    },
  };
};
