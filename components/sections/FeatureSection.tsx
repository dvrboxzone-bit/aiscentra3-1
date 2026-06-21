"use client";
import { useState } from "react";

const signals = [
  { label: "GPT-5 Release", delta: "+94%", time: "2h ago", type: "MODEL" },
  { label: "Gemini Ultra 2.0", delta: "+67%", time: "5h ago", type: "MODEL" },
  { label: "Claude 4 Opus", delta: "+81%", time: "8h ago", type: "MODEL" },
  { label: "Mistral Large 3", delta: "+45%", time: "12h ago", type: "UPDATE" },
];

const metrics = [
  { label: "AIscentra Signal", value: "0.8s", highlight: true },
  { label: "Standard Feed", value: "4.2s", highlight: false },
  { label: "Manual Research", value: "48h", highlight: false },
  { label: "News Aggregator", value: "6h", highlight: false },
];

export default function FeatureSection() {
  const [activeSignal, setActiveSignal] = useState(0);

  return (
    <section
      id="signals"
      style={{
        background: "#000000",
        padding: "80px 24px",
      }}
    >
      <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
        {/* Section heading */}
        <h2
          style={{
            fontFamily: "var(--font-goga)",
            fontSize: "clamp(32px, 4vw, 54px)",
            fontWeight: 400,
            color: "#ddffdc",
            lineHeight: 1.1,
            letterSpacing: "-0.81px",
            marginBottom: "64px",
          }}
        >
          The signal layer for<br />the AI ecosystem.
        </h2>

        {/* Two column */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "24px",
          }}
        >
          {/* Left — Live Signals terminal */}
          <div
            style={{
              background: "#0a0a0a",
              border: "1px solid #3e4a3c",
              borderRadius: "16px",
              padding: "20px",
              position: "relative",
              overflow: "hidden",
            }}
          >
            {/* Green glow bg */}
            <div style={{
              position: "absolute", inset: 0,
              background: "radial-gradient(ellipse at 60% 80%, rgba(127,238,100,0.07) 0%, transparent 70%)",
              pointerEvents: "none",
            }} />

            {/* Terminal chrome */}
            <div style={{ display: "flex", gap: "6px", marginBottom: "20px" }}>
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#3e4a3c" }} />
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#3e4a3c" }} />
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#3e4a3c" }} />
            </div>

            {/* Signal stream */}
            <div style={{ fontFamily: "monospace" }}>
              {signals.map((s, i) => (
                <div
                  key={i}
                  onClick={() => setActiveSignal(i)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                    padding: "10px 12px",
                    borderRadius: "6px",
                    marginBottom: "6px",
                    cursor: "pointer",
                    background: activeSignal === i ? "rgba(127,238,100,0.06)" : "transparent",
                    border: activeSignal === i ? "1px solid rgba(127,238,100,0.2)" : "1px solid transparent",
                    transition: "all 0.15s",
                  }}
                >
                  <span style={{
                    fontSize: "10px",
                    color: "#677d64",
                    letterSpacing: "0.08em",
                    minWidth: "52px",
                  }}>
                    {s.type}
                  </span>
                  <span style={{
                    fontSize: "14px",
                    color: activeSignal === i ? "#ddffdc" : "#677d64",
                    flex: 1,
                  }}>
                    {s.label}
                  </span>
                  <span style={{
                    fontSize: "13px",
                    color: "#7fee64",
                    fontWeight: 600,
                  }}>
                    {s.delta}
                  </span>
                  <span style={{ fontSize: "11px", color: "#485346" }}>{s.time}</span>
                </div>
              ))}
            </div>

            {/* Live pulse */}
            <div style={{ marginTop: "20px", display: "flex", alignItems: "center", gap: "8px" }}>
              <div style={{
                width: 7, height: 7, borderRadius: "50%",
                background: "#7fee64",
                boxShadow: "0 0 8px rgba(127,238,100,0.8)",
                animation: "pulse 1.4s ease infinite",
              }} />
              <span style={{ fontSize: "12px", color: "#677d64", fontFamily: "var(--font-inter-variable)" }}>
                Live — 847 signals tracked today
              </span>
            </div>
          </div>

          {/* Right — Detection speed */}
          <div
            style={{
              background: "#0a0a0a",
              border: "1px solid #3e4a3c",
              borderRadius: "16px",
              padding: "20px",
              position: "relative",
              overflow: "hidden",
            }}
          >
            <div style={{
              position: "absolute", inset: 0,
              background: "radial-gradient(ellipse at 40% 80%, rgba(127,238,100,0.07) 0%, transparent 70%)",
              pointerEvents: "none",
            }} />

            <div style={{ display: "flex", gap: "6px", marginBottom: "20px" }}>
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#3e4a3c" }} />
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#3e4a3c" }} />
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#3e4a3c" }} />
              <span style={{
                marginLeft: "auto",
                fontSize: "12px",
                color: "#677d64",
                fontFamily: "monospace",
              }}>
                Signal Detection Speed
              </span>
            </div>

            {metrics.map((m, i) => (
              <div key={i} style={{ marginBottom: "20px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
                  <span style={{
                    fontSize: "13px",
                    color: m.highlight ? "#7fee64" : "#677d64",
                    fontFamily: "monospace",
                  }}>
                    {m.highlight && <span style={{ color: "#7fee64", marginRight: "8px" }}>●</span>}
                    {m.label}
                  </span>
                  <span style={{
                    fontSize: "13px",
                    color: m.highlight ? "#7fee64" : "#485346",
                    fontFamily: "monospace",
                  }}>
                    {m.highlight && "✓ "}{m.value}
                  </span>
                </div>
                <div style={{ background: "#212525", borderRadius: "2px", height: "4px", overflow: "hidden" }}>
                  <div style={{
                    height: "100%",
                    borderRadius: "2px",
                    background: m.highlight ? "#7fee64" : "#3e4a3c",
                    width: m.highlight ? "5%" : i === 1 ? "52%" : i === 2 ? "90%" : "72%",
                    transition: "width 0.6s ease",
                  }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Section labels below */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px", marginTop: "16px" }}>
          {[
            { tag: "DATA COLLECTOR", title: "Your signal feed, automated.", desc: "Continuous monitoring of 200+ AI sources. New models, papers, funding, and market events — captured in seconds." },
            { tag: "RANKING ENGINE", title: "Built for signal clarity, at any scale.", desc: "Engineered from the ground up for real-time AI intelligence, with instant ranking and zero noise in your feed." },
          ].map((item, i) => (
            <div key={i}>
              <p style={{
                fontFamily: "var(--font-inter-variable)",
                fontSize: "11px",
                fontWeight: 500,
                color: "#7fee64",
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                marginBottom: "8px",
              }}>
                {item.tag}
              </p>
              <h3 style={{
                fontFamily: "var(--font-goga)",
                fontSize: "20px",
                fontWeight: 400,
                color: "#ddffdc",
                letterSpacing: "-0.12px",
                marginBottom: "8px",
              }}>
                {item.title}
              </h3>
              <p style={{
                fontFamily: "var(--font-inter-variable)",
                fontSize: "14px",
                color: "#677d64",
                lineHeight: 1.6,
              }}>
                {item.desc}
              </p>
            </div>
          ))}
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(0.85); }
        }
      `}</style>
    </section>
  );
}
