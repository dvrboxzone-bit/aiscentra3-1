"use client";
import { useEffect, useRef } from "react";

export default function GlobeAnimation() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    const cx = W / 2, cy = H / 2;
    const R = Math.min(W, H) * 0.38;

    // Generate dots on sphere surface
    const dots: { lat: number; lon: number; size: number }[] = [];
    for (let i = 0; i < 320; i++) {
      dots.push({
        lat: (Math.random() - 0.5) * Math.PI,
        lon: Math.random() * Math.PI * 2,
        size: Math.random() * 1.8 + 0.4,
      });
    }

    // Connection nodes (major signal hubs)
    const nodes: { lat: number; lon: number }[] = [
      { lat: 0.7, lon: 0.5 }, { lat: -0.3, lon: 1.8 },
      { lat: 0.4, lon: 3.2 }, { lat: -0.6, lon: 4.5 },
      { lat: 0.9, lon: 2.1 }, { lat: 0.1, lon: 5.2 },
      { lat: -0.8, lon: 0.9 }, { lat: 0.5, lon: 3.8 },
    ];

    let t = 0;
    let animId: number;

    function project3D(lat: number, lon: number, rot: number): { x: number; y: number; z: number } {
      const x = Math.cos(lat) * Math.cos(lon + rot);
      const y = Math.sin(lat);
      const z = Math.cos(lat) * Math.sin(lon + rot);
      return { x: cx + x * R, y: cy - y * R, z };
    }

    function draw() {
      ctx!.clearRect(0, 0, W, H);

      const rot = t * 0.15;

      // Background glow
      const bgGrad = ctx!.createRadialGradient(cx, cy, 0, cx, cy, R * 1.1);
      bgGrad.addColorStop(0, "rgba(127,238,100,0.04)");
      bgGrad.addColorStop(1, "rgba(0,0,0,0)");
      ctx!.beginPath();
      ctx!.arc(cx, cy, R * 1.1, 0, Math.PI * 2);
      ctx!.fillStyle = bgGrad;
      ctx!.fill();

      // Dots
      for (const d of dots) {
        const p = project3D(d.lat, d.lon, rot);
        if (p.z < 0) continue; // back face culling
        const alpha = Math.max(0.08, p.z * 0.7);
        ctx!.beginPath();
        ctx!.arc(p.x, p.y, d.size * p.z, 0, Math.PI * 2);
        ctx!.fillStyle = `rgba(127,238,100,${alpha})`;
        ctx!.fill();
      }

      // Node connections
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = project3D(nodes[i].lat, nodes[i].lon, rot);
          const b = project3D(nodes[j].lat, nodes[j].lon, rot);
          if (a.z < 0 || b.z < 0) continue;
          const dist = Math.hypot(a.x - b.x, a.y - b.y);
          if (dist > R * 1.1) continue;

          const alpha = Math.min(a.z, b.z) * 0.5;
          ctx!.beginPath();
          ctx!.moveTo(a.x, a.y);
          ctx!.lineTo(b.x, b.y);
          ctx!.strokeStyle = `rgba(127,238,100,${alpha})`;
          ctx!.lineWidth = 0.8;
          ctx!.stroke();
        }
      }

      // Node dots (glowing hubs)
      for (const n of nodes) {
        const p = project3D(n.lat, n.lon, rot);
        if (p.z < 0) continue;
        const glow = ctx!.createRadialGradient(p.x, p.y, 0, p.x, p.y, 14);
        glow.addColorStop(0, `rgba(127,238,100,${p.z * 0.9})`);
        glow.addColorStop(1, "rgba(127,238,100,0)");
        ctx!.beginPath();
        ctx!.arc(p.x, p.y, 14, 0, Math.PI * 2);
        ctx!.fillStyle = glow;
        ctx!.fill();
        ctx!.beginPath();
        ctx!.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
        ctx!.fillStyle = `rgba(127,238,100,${p.z})`;
        ctx!.fill();
      }

      t += 1;
      animId = requestAnimationFrame(draw);
    }

    draw();
    return () => cancelAnimationFrame(animId);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      width={560}
      height={560}
      style={{ display: "block", maxWidth: "100%" }}
    />
  );
}
