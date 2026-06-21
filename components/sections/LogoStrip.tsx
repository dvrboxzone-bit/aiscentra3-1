"use client";

const logos = [
  "OpenAI", "Anthropic", "DeepMind", "Mistral", "Cohere",
  "Stability AI", "Runway", "Hugging Face", "Together AI", "Replicate",
  "xAI", "Meta AI", "Google DeepMind", "Perplexity", "ElevenLabs",
];

export default function LogoStrip() {
  return (
    <div style={{
      width: "100%",
      borderTop: "1px solid #3e4a3c",
      borderBottom: "1px solid #3e4a3c",
      background: "#000000",
      overflow: "hidden",
    }}>
      <div style={{ display: "flex", padding: "18px 0" }}>
        {/* Две копии для бесшовного цикла */}
        {[0, 1].map((copy) => (
          <div
            key={copy}
            style={{
              display: "flex",
              gap: "0",
              whiteSpace: "nowrap",
              animation: "scrollLeft 30s linear infinite",
              flexShrink: 0,
            }}
          >
            {logos.map((logo, i) => (
              <span key={i} style={{
                fontFamily: "var(--font-inter-variable)",
                fontSize: "13px",
                fontWeight: 500,
                color: "#7fee64",
                letterSpacing: "0.05em",
                padding: "0 28px",
                borderRight: "1px solid #3e4a3c",
                display: "inline-block",
              }}>
                {logo}
              </span>
            ))}
          </div>
        ))}
      </div>

      <style>{`
        @keyframes scrollLeft {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-100%); }
        }
      `}</style>
    </div>
  );
}
