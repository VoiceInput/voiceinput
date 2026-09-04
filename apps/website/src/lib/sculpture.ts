import * as THREE from "three";

export function mountSculpture(host: HTMLElement) {
  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true,
    powerPreference: "low-power",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setClearColor(0xffffff, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.35;
  const scene = new THREE.Scene();
  // A small baked-style matcap avoids runtime environment-map convolution.
  const surface = document.createElement("canvas");
  surface.width = surface.height = 128;
  const context = surface.getContext("2d");
  if (!context) {
    renderer.dispose();
    return;
  }
  const gradient = context.createLinearGradient(0, 0, 128, 105);
  for (const [offset, color] of [
    [0, "#ffffff"],
    [0.18, "#e9edf3"],
    [0.35, "#65707e"],
    [0.46, "#dce2eb"],
    [0.59, "#ffffff"],
    [0.75, "#9ca8b8"],
    [1, "#3e4755"],
  ] as const)
    gradient.addColorStop(offset, color);
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  const matcap = new THREE.CanvasTexture(surface);
  matcap.colorSpace = THREE.SRGBColorSpace;
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
  camera.position.set(0, 0.2, 13);
  const group = new THREE.Group();
  group.rotation.set(0.12, -0.36, -0.22);
  scene.add(group);
  const material = new THREE.MeshMatcapMaterial({ color: 0xe8edf4, matcap });
  const geometry = new THREE.CapsuleGeometry(0.115, 1, 6, 16);
  const bars = Array.from({ length: 23 }, (_, i) => {
    const bar = new THREE.Mesh(geometry, material);
    bar.position.x = (i - 11) * 0.275;
    bar.scale.y = 0.3 + 2.8 * Math.exp(-(((i - 11) / 5.5) ** 2));
    group.add(bar);
    return bar;
  });
  let frame = 0,
    active = true,
    disposed = false,
    pointer = 0,
    talking = false;
  let until = performance.now() + 3200;
  const start = performance.now();
  const draw = (now: number) => {
    if (disposed || !active) {
      frame = 0;
      return;
    }
    const elapsed = now - start;
    // Briefly compress the waveform into a caret, then settle into its resting form.
    const compress =
      elapsed < 2600
        ? Math.pow(Math.sin(Math.min(1, elapsed / 2600) * Math.PI), 10)
        : 0;
    bars.forEach((bar, i) => {
      bar.position.x = (i - 11) * 0.275 * (1 - compress * 0.985);
      const height = 0.3 + 2.8 * Math.exp(-(((i - 11) / 5.5) ** 2));
      bar.scale.y =
        THREE.MathUtils.lerp(height, 3.2, compress) *
        (talking ? 1 + 0.12 * Math.sin(now * 0.007 + i * 0.8) : 1);
    });
    group.rotation.y += (-0.36 + pointer * 0.2 - group.rotation.y) * 0.06;
    renderer.render(scene, camera);
    if (now < until || talking) frame = requestAnimationFrame(draw);
    else frame = 0;
  };
  const wake = () => {
    until = Math.max(until, performance.now() + 800);
    if (!frame && active && !disposed) frame = requestAnimationFrame(draw);
  };
  const resize = new ResizeObserver(() => {
    const { width, height } = host.getBoundingClientRect();
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    wake();
  });
  resize.observe(host);
  const visibility = new IntersectionObserver(([entry]) => {
    active = Boolean(entry?.isIntersecting) && !document.hidden;
    if (active) wake();
  });
  visibility.observe(host);
  const onPointer = (event: PointerEvent) => {
    pointer =
      (event.clientX - host.getBoundingClientRect().left) / host.clientWidth -
      0.5;
    wake();
  };
  const onLeave = () => {
    pointer = 0;
    wake();
  };
  const onDemo = (event: Event) => {
    talking = Boolean((event as CustomEvent<boolean>).detail);
    wake();
  };
  const onVisibility = () => {
    active = !document.hidden && host.getBoundingClientRect().bottom > 0;
    if (active) wake();
  };
  host.addEventListener("pointermove", onPointer);
  host.addEventListener("pointerleave", onLeave);
  window.addEventListener("voiceinput-demo", onDemo);
  document.addEventListener("visibilitychange", onVisibility);
  renderer.domElement.className = "sculpture-canvas";
  const initial = host.getBoundingClientRect();
  renderer.setSize(initial.width, initial.height);
  camera.aspect = initial.width / initial.height;
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);
  host.append(renderer.domElement);
  host.classList.add("has-webgl");
  frame = requestAnimationFrame(draw);
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(frame);
    resize.disconnect();
    visibility.disconnect();
    host.removeEventListener("pointermove", onPointer);
    host.removeEventListener("pointerleave", onLeave);
    window.removeEventListener("voiceinput-demo", onDemo);
    document.removeEventListener("visibilitychange", onVisibility);
    geometry.dispose();
    material.dispose();
    matcap.dispose();
    renderer.dispose();
    renderer.domElement.remove();
    host.classList.remove("has-webgl");
  };
  window.addEventListener("pagehide", dispose, { once: true });
  window.matchMedia("(prefers-reduced-motion: reduce)").addEventListener(
    "change",
    (event) => {
      if (event.matches) dispose();
    },
    { once: true },
  );
  renderer.domElement.addEventListener("webglcontextlost", dispose, {
    once: true,
  });
  return dispose;
}
