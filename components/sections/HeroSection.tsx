import Link from "next/link";

const partnerLogos = [
  "OpenAI", "Anthropic", "DeepMind", "Mistral", "Cohere",
  "Stability AI", "Runway", "Hugging Face", "Together AI", "Replicate",
];

export default function HeroSection() {
  return (
    <section
      style={{
        background: "#000000",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        paddingTop: "60px",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Subtle background glow */}
      <div style={{
        position: "absolute",
        top: "30%",
        left: "50%",
        transform: "translateX(-50%)",
        width: "800px",
        height: "400px",
        background: "radial-gradient(ellipse at center, rgba(127,238,100,0.06) 0%, transparent 70%)",
        pointerEvents: "none",
        zIndex: 0,
      }} />

      {/* Text block — full width centered */}
      <div
        style={{
          width: "100%",
          maxWidth: "1200px",
          padding: "120px 24px 0",
          position: "relative",
          zIndex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
        }}
      >
        {/* Eyebrow */}
        <p style={{
          fontFamily: "var(--font-inter-variable)",
          fontSize: "12px",
          fontWeight: 500,
          color: "#677d64",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          marginBottom: "28px",
        }}>
          Intelligence Observatory
        </p>

        {/* Headline — wide */}
        <h1 style={{
          fontFamily: "var(--font-goga)",
          fontSize: "clamp(48px, 6.5vw, 80px)",
          fontWeight: 500,
          color: "#ddffdc",
          lineHeight: 1.0,
          letterSpacing: "-0.96px",
          marginBottom: "28px",
          maxWidth: "900px",
        }}>
          AI ecosystem intelligence{" "}
          <span style={{ color: "#7fee64" }}>that accelerates</span>{" "}
          the future
        </h1>

        {/* Subhead */}
        <p style={{
          fontFamily: "var(--font-inter-variable)",
          fontSize: "18px",
          fontWeight: 400,
          color: "#ddffdc",
          opacity: 0.6,
          lineHeight: 1.6,
          marginBottom: "48px",
          maxWidth: "600px",
        }}>
          Monitor models, track signals, analyze trends, and interact with AI agents —
          a single observatory for the global AI ecosystem.
        </p>

        {/* CTA row */}
        <div style={{ display: "flex", gap: "12px", justifyContent: "center", flexWrap: "wrap" }}>
          <Link href="/signup" style={{
            fontFamily: "var(--font-inter-variable)",
            fontSize: "15px",
            fontWeight: 500,
            color: "#000000",
            background: "#7fee64",
            padding: "12px 32px",
            borderRadius: "4px",
            textDecoration: "none",
          }}>
            Start Observing
          </Link>
          <Link href="#about" style={{
            fontFamily: "var(--font-inter-variable)",
            fontSize: "15px",
            fontWeight: 500,
            color: "#ddffdc",
            background: "transparent",
            border: "1px solid #485346",
            padding: "12px 32px",
            borderRadius: "4px",
            textDecoration: "none",
          }}>
            Learn More
          </Link>
        </div>
      </div>

      {/* Spacer before logo strip */}
      <div style={{ flex: 1, minHeight: "80px" }} />

      {/* Logo strip */}
      <div style={{
        width: "100%",
        borderTop: "1px solid #3e4a3c",
        borderBottom: "1px solid #3e4a3c",
        background: "#000000",
        overflow: "hidden",
        position: "relative",
        zIndex: 1,
      }}>
        <div style={{ display: "flex", padding: "20px 0" }}>
          <div className="logo-scroll" style={{ display: "flex", gap: "0", whiteSpace: "nowrap" }}>
            {[...partnerLogos, ...partnerLogos].map((logo, i) => (
              <span key={i} style={{
                fontFamily: "var(--font-inter-variable)",
                fontSize: "14px",
                fontWeight: 500,
                color: "#485346",
                letterSpacing: "-0.022em",
                padding: "0 32px",
                borderRight: "1px solid #3e4a3c",
                display: "inline-block",
              }}>
                {logo}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
