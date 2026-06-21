"use client";
import { useEffect, useRef } from "react";

export default function HeroCube() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId: number;
    let t = 0;

    // Cube vertices (unit cube centered at origin)
    const baseVertices: [number, number, number][] = [
      [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
      [-1, -1,  1], [1, -1,  1], [1, 1,  1], [-1, 1,  1],
    ];

    const edges = [
      [0,1],[1,2],[2,3],[3,0], // back
      [4,5],[5,6],[6,7],[7,4], // front
      [0,4],[1,5],[2,6],[3,7], // sides
    ];

    const faces = [
      [0,1,2,3], [4,5,6,7],
      [0,1,5,4], [2,3,7,6],
      [0,3,7,4], [1,2,6,5],
    ];

    function rotateY(v: [number,number,number], a: number): [number,number,number] {
      return [
        v[0]*Math.cos(a) + v[2]*Math.sin(a),
        v[1],
        -v[0]*Math.sin(a) + v[2]*Math.cos(a),
      ];
    }
    function rotateX(v: [number,number,number], a: number): [number,number,number] {
      return [
        v[0],
        v[1]*Math.cos(a) - v[2]*Math.sin(a),
        v[1]*Math.sin(a) + v[2]*Math.cos(a),
      ];
    }

    function project(v: [number,number,number], cx: number, cy: number, scale: number): [number,number] {
      const z = v[2] + 5;
      const fov = 4;
      const px = (v[0] / (z / fov)) * scale + cx;
      const py = (v[1] / (z / fov)) * scale + cy;
      return [px, py];
    }

    function draw() {
      const W = canvas!.width;
      const H = canvas!.height;
      ctx!.clearRect(0, 0, W, H);

      const scale = Math.min(W, H) * 0.28;
      const cx = W / 2;
      const cy = H / 2;

      const ay = t * 0.4;
      const ax = t * 0.22;

      const verts = baseVertices.map(v => rotateX(rotateY(v, ay), ax));
      const proj = verts.map(v => project(v, cx, cy, scale));

      // Draw faces (glass effect)
      for (const face of faces) {
        const pts = face.map(i => proj[i]);
        // Compute z-depth of face center
        const zAvg = face.reduce((s, i) => s + verts[i][2], 0) / 4;
        const alpha = Math.max(0, Math.min(0.07, 0.07 + zAvg * 0.015));

        ctx!.beginPath();
        ctx!.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) ctx!.lineTo(pts[i][0], pts[i][1]);
        ctx!.closePath();
        ctx!.fillStyle = `rgba(127, 238, 100, ${alpha})`;
        ctx!.fill();
      }

      // Draw edges
      for (const [a, b] of edges) {
        const za = verts[a][2];
        const zb = verts[b][2];
        const zMid = (za + zb) / 2;
        const brightness = Math.max(0.25, Math.min(1, 0.6 + zMid * 0.18));

        ctx!.beginPath();
        ctx!.moveTo(proj[a][0], proj[a][1]);
        ctx!.lineTo(proj[b][0], proj[b][1]);
        ctx!.strokeStyle = `rgba(127, 238, 100, ${brightness})`;
        ctx!.lineWidth = 1.5;
        ctx!.stroke();
      }

      // Draw vertices (glowing dots)
      for (const [px, py] of proj) {
        const grad = ctx!.createRadialGradient(px, py, 0, px, py, 8);
        grad.addColorStop(0, "rgba(127,238,100,0.9)");
        grad.addColorStop(1, "rgba(127,238,100,0)");
        ctx!.beginPath();
        ctx!.arc(px, py, 8, 0, Math.PI * 2);
        ctx!.fillStyle = grad;
        ctx!.fill();

        ctx!.beginPath();
        ctx!.arc(px, py, 2.5, 0, Math.PI * 2);
        ctx!.fillStyle = "#7fee64";
        ctx!.fill();
      }

      // Glow under cube
      const glowGrad = ctx!.createRadialGradient(cx, cy + scale * 0.6, 0, cx, cy + scale * 0.6, scale * 0.9);
      glowGrad.addColorStop(0, "rgba(127,238,100,0.18)");
      glowGrad.addColorStop(0.5, "rgba(127,238,100,0.06)");
      glowGrad.addColorStop(1, "rgba(0,0,0,0)");
      ctx!.beginPath();
      ctx!.ellipse(cx, cy + scale * 0.6, scale * 0.9, scale * 0.3, 0, 0, Math.PI * 2);
      ctx!.fillStyle = glowGrad;
      ctx!.fill();

      t += 0.008;
      animId = requestAnimationFrame(draw);
    }

    draw();
    return () => cancelAnimationFrame(animId);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      width={520}
      height={520}
      style={{
        display: "block",
        maxWidth: "100%",
        filter: "drop-shadow(0 0 40px rgba(127,238,100,0.25))",
      }}
    />
  );
}
