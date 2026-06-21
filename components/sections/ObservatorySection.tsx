"use client";
import { useState } from "react";
import GlobeAnimation from "@/components/animations/GlobeAnimation";

const items = [
  {
    title: "Real-time ecosystem tracking",
    content: "Every major AI release, model update, funding round, and research paper — captured and indexed within seconds of publication across 200+ monitored sources worldwide.",
  },
  {
    title: "Multi-source signal aggregation",
    content: "Data from GitHub, arXiv, HuggingFace, company blogs, social media, and specialized AI publications — unified into a single normalized intelligence feed.",
  },
  {
    title: "Automated trend detection",
    content: "Pattern recognition across the entire AI landscape identifies emerging trends before they become mainstream news, giving you a strategic edge.",
  },
  {
    title: "Scales with the industry",
    content: "As the AI ecosystem grows, AIscentra scales automatically — more sources, more signals, more intelligence without any manual intervention.",
  },
];

export default function ObservatorySection() {
  const [open, setOpen] = useState(0);

  return (
    <section
      id="observatory"
      style={{
        background: "#000000",
        padding: "80px 24px",
      }}
    >
      <div
        style={{
          maxWidth: "1200px",
          margin: "0 auto",
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "64px",
          alignItems: "center",
        }}
      >
        {/* Left — Globe */}
        <div style={{ display: "flex", justifyContent: "center" }}>
          <GlobeAnimation />
        </div>

        {/* Right — Accordion */}
        <div>
          <p style={{
            fontFamily: "var(--font-inter-variable)",
            fontSize: "11px",
            fontWeight: 500,
            color: "#677d64",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            marginBottom: "12px",
          }}>
            Observatory
          </p>
          <h2 style={{
            fontFamily: "var(--font-goga)",
            fontSize: "clamp(28px, 3vw, 40px)",
            fontWeight: 400,
            color: "#ddffdc",
            lineHeight: 1.2,
            letterSpacing: "-0.6px",
            marginBottom: "40px",
          }}>
            Global{" "}
            <span style={{ color: "#7fee64" }}>AI</span>{" "}
            intelligence infrastructure
          </h2>

          {items.map((item, i) => (
            <div
              key={i}
              style={{
                borderTop: "1px solid #3e4a3c",
                paddingTop: "20px",
                paddingBottom: "20px",
              }}
            >
              <button
                onClick={() => setOpen(open === i ? -1 : i)}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  width: "100%",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: 0,
                  textAlign: "left",
                }}
              >
                <span style={{
                  fontFamily: "var(--font-goga)",
                  fontSize: "18px",
                  fontWeight: 400,
                  color: open === i ? "#ddffdc" : "#677d64",
                  letterSpacing: "-0.2px",
                  transition: "color 0.15s",
                }}>
                  {item.title}
                </span>
                <span style={{
                  color: open === i ? "#7fee64" : "#485346",
                  fontSize: "20px",
                  lineHeight: 1,
                  flexShrink: 0,
                  marginLeft: "16px",
                  transition: "color 0.15s",
                }}>
                  {open === i ? "−" : "+"}
                </span>
              </button>

              {open === i && (
                <p style={{
                  fontFamily: "var(--font-inter-variable)",
                  fontSize: "14px",
                  color: "#677d64",
                  lineHeight: 1.7,
                  marginTop: "12px",
                  marginBottom: 0,
                }}>
                  {item.content}
                </p>
              )}
            </div>
          ))}

          <div style={{ borderTop: "1px solid #3e4a3c" }} />
        </div>
      </div>
    </section>
  );
}
