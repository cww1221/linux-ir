import { useEffect, useRef } from "react";

/** 透视 3D 粒子星场背景（Canvas 2D 模拟深度 + 鼠标视差） */
export function CyberBackground() {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!(el instanceof HTMLCanvasElement)) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    const canvasEl: HTMLCanvasElement = el;
    const c2d: CanvasRenderingContext2D = ctx;

    let w = 0;
    let h = 0;
    const N = 260;
    const fov = 400;
    let mx = 0;
    let my = 0;
    type P = { x: number; y: number; z: number; vz: number; hue: number };
    const particles: P[] = [];

    function resize() {
      w = canvasEl.width = window.innerWidth;
      h = canvasEl.height = window.innerHeight;
    }

    function init() {
      particles.length = 0;
      for (let i = 0; i < N; i++) {
        particles.push({
          x: (Math.random() - 0.5) * 4 * Math.max(w, 800),
          y: (Math.random() - 0.5) * 4 * Math.max(h, 600),
          z: Math.random() * 2600 + 120,
          vz: 0.9 + Math.random() * 2.8,
          hue: 160 + Math.random() * 110,
        });
      }
    }

    function onMove(e: MouseEvent) {
      mx = (e.clientX / Math.max(w, 1) - 0.5) * 72;
      my = (e.clientY / Math.max(h, 1) - 0.5) * 72;
    }

    let raf = 0;
    function tick() {
      const grad = c2d.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, "#050a18");
      grad.addColorStop(0.42, "#0a1430");
      grad.addColorStop(1, "#060818");
      c2d.fillStyle = grad;
      c2d.fillRect(0, 0, w, h);

      const cx = w * 0.5;
      const cy = h * 0.48;
      const proj: { sx: number; sy: number; r: number; a: number; hue: number; z: number }[] = [];

      for (const p of particles) {
        p.z -= p.vz;
        if (p.z < 50) {
          p.z = 2400 + Math.random() * 500;
          p.x = (Math.random() - 0.5) * 3.5 * Math.max(w, 800);
          p.y = (Math.random() - 0.5) * 3.5 * Math.max(h, 600);
        }
        const inv = 1 / p.z;
        const par = 620 * inv;
        const sx = cx + (p.x + mx * par) * fov * inv;
        const sy = cy + (p.y + my * par) * fov * inv;
        const r = Math.max(0.55, 3.8 * fov * inv);
        const depth = 1 - p.z / 2900;
        const a = 0.38 + depth * 0.52;
        proj.push({ sx, sy, r, a, hue: p.hue, z: p.z });
      }
      proj.sort((a, b) => b.z - a.z);
      for (const p of proj) {
        c2d.fillStyle = `hsla(${p.hue}, 95%, 68%, ${p.a})`;
        c2d.beginPath();
        c2d.arc(p.sx, p.sy, p.r, 0, Math.PI * 2);
        c2d.fill();
      }
      for (let i = 0; i < proj.length; i += 5) {
        for (let k = 1; k <= 3 && i + k < proj.length; k++) {
          const a = proj[i];
          const b = proj[i + k];
          const dx = a.sx - b.sx;
          const dy = a.sy - b.sy;
          if (dx * dx + dy * dy < 130 * 130) {
            c2d.strokeStyle = `rgba(120, 220, 255, ${0.08 + (1 - (a.z + b.z) / 5800) * 0.2})`;
            c2d.lineWidth = 0.85;
            c2d.beginPath();
            c2d.moveTo(a.sx, a.sy);
            c2d.lineTo(b.sx, b.sy);
            c2d.stroke();
          }
        }
      }
      raf = requestAnimationFrame(tick);
    }

    resize();
    init();
    window.addEventListener("resize", () => {
      resize();
      init();
    });
    window.addEventListener("mousemove", onMove);
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("mousemove", onMove);
    };
  }, []);

  return (
    <canvas
      ref={ref}
      className="cyberCanvas"
      aria-hidden
    />
  );
}
