import Link from "next/link";

const agents = [
  {
    icon: (
      <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
        <rect x="16" y="32" width="24" height="24" rx="2" stroke="#485346" strokeWidth="1.5" fill="none" />
        <rect x="24" y="24" width="24" height="24" rx="2" stroke="#677d64" strokeWidth="1.5" fill="rgba(127,238,100,0.05)" />
        <line x1="16" y1="32" x2="24" y2="24" stroke="#485346" strokeWidth="1.5" />
        <line x1="40" y1="32" x2="48" y2="24" stroke="#485346" strokeWidth="1.5" />
        <line x1="40" y1="56" x2="48" y2="48" stroke="#485346" strokeWidth="1.5" />
        <circle cx="32" cy="18" r="3" fill="#7fee64" />
        <circle cx="32" cy="18" r="6" fill="rgba(127,238,100,0.15)" />
      </svg>
    ),
    tag: "DATA COLLECTOR",
    title: "Signal Collection",
    desc: "Autonomous monitoring of 200+ global AI sources. Models, papers, funding events, and market changes — captured continuously.",
  },
  {
    icon: (
      <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
        <rect x="10" y="16" width="14" height="14" rx="2" stroke="#485346" strokeWidth="1.5" fill="rgba(127,238,100,0.05)" />
        <rect x="40" y="16" width="14" height="14" rx="2" stroke="#485346" strokeWidth="1.5" fill="rgba(127,238,100,0.05)" />
        <rect x="25" y="36" width="14" height="14" rx="2" stroke="#7fee64" strokeWidth="1.5" fill="rgba(127,238,100,0.1)" />
        <line x1="17" y1="30" x2="32" y2="36" stroke="#485346" strokeWidth="1.5" />
        <line x1="47" y1="30" x2="32" y2="36" stroke="#485346" strokeWidth="1.5" />
        <circle cx="32" cy="43" r="2" fill="#7fee64" />
      </svg>
    ),
    tag: "RANKING ENGINE",
    title: "Trend Analysis",
    desc: "Identifies the most significant market signals from noise. Real-time scoring and weighted significance ranking.",
  },
  {
    icon: (
      <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
        <rect x="12" y="20" width="40" height="6" rx="2" fill="rgba(127,238,100,0.08)" stroke="#485346" strokeWidth="1.5" />
        <rect x="12" y="30" width="40" height="6" rx="2" fill="rgba(127,238,100,0.08)" stroke="#485346" strokeWidth="1.5" />
        <rect x="12" y="40" width="40" height="6" rx="2" fill="rgba(127,238,100,0.08)" stroke="#485346" strokeWidth="1.5" />
        <circle cx="20" cy="23" r="2" fill="#7fee64" />
        <circle cx="20" cy="33" r="2" fill="#677d64" />
        <circle cx="20" cy="43" r="2" fill="#677d64" />
      </svg>
    ),
    tag: "CONTENT AGENT",
    title: "AI-Generated Analysis",
    desc: "Converts raw signals into structured analytical articles, summaries, and actionable intelligence reports.",
  },
];

export default function AgentsSection() {
  return (
    <section
      id="agents"
      style={{
        background: "#def0dd",
        padding: "80px 24px",
      }}
    >
      <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
        {/* Eyebrow */}
        <p style={{
          fontFamily: "var(--font-inter-variable)",
          fontSize: "11px",
          fontWeight: 500,
          color: "#677d64",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          marginBottom: "16px",
        }}>
          AI Agents
        </p>

        {/* Heading */}
        <h2 style={{
          fontFamily: "var(--font-goga)",
          fontSize: "clamp(32px, 4vw, 48px)",
          fontWeight: 400,
          color: "#000000",
          lineHeight: 1.1,
          letterSpacing: "-0.6px",
          marginBottom: "48px",
        }}>
          Build the complete AI<br />intelligence system.
        </h2>

        {/* Cards grid */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: "16px",
        }}>
          {agents.map((agent, i) => (
            <div
              key={i}
              style={{
                background: "#3e4a3c",
                borderRadius: "16px",
                overflow: "hidden",
              }}
            >
              {/* Icon area */}
              <div style={{
                background: i === 0 ? "#000000" : "#2a3328",
                height: "200px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                position: "relative",
              }}>
                {i === 0 && (
                  <div style={{
                    position: "absolute",
                    inset: 0,
                    background: "radial-gradient(ellipse at center, rgba(127,238,100,0.15) 0%, transparent 70%)",
                  }} />
                )}
                <div style={{ position: "relative", zIndex: 1 }}>
                  {agent.icon}
                </div>
              </div>

              {/* Content */}
              <div style={{ padding: "20px" }}>
                <p style={{
                  fontFamily: "var(--font-inter-variable)",
                  fontSize: "11px",
                  fontWeight: 500,
                  color: "#7fee64",
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  marginBottom: "8px",
                }}>
                  {agent.tag}
                </p>
                <h3 style={{
                  fontFamily: "var(--font-goga)",
                  fontSize: "22px",
                  fontWeight: 400,
                  color: "#ddffdc",
                  letterSpacing: "-0.3px",
                  marginBottom: "8px",
                }}>
                  {agent.title}
                </h3>
                <p style={{
                  fontFamily: "var(--font-inter-variable)",
                  fontSize: "14px",
                  color: "#aed2a4",
                  lineHeight: 1.6,
                }}>
                  {agent.desc}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
