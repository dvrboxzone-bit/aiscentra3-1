import Link from "next/link";

function MiniCube({ size, x, y, opacity }: { size: number; x: number; y: number; opacity: number }) {
  const s = size;
  return (
    <svg
      width={s * 2}
      height={s * 2}
      viewBox={`0 0 ${s * 2} ${s * 2}`}
      style={{ position: "absolute", left: x, top: y, opacity }}
      fill="none"
    >
      {/* Front face */}
      <rect x={s * 0.3} y={s * 0.6} width={s} height={s} rx="3" stroke="#7fee64" strokeWidth="1.5" fill="rgba(127,238,100,0.08)" />
      {/* Top face */}
      <polygon
        points={`${s * 0.3},${s * 0.6} ${s * 0.8},${s * 0.1} ${s * 1.8},${s * 0.1} ${s * 1.3},${s * 0.6}`}
        stroke="#7fee64" strokeWidth="1.5" fill="rgba(127,238,100,0.12)"
      />
      {/* Right face */}
      <polygon
        points={`${s * 1.3},${s * 0.6} ${s * 1.8},${s * 0.1} ${s * 1.8},${s * 1.1} ${s * 1.3},${s * 1.6}`}
        stroke="#7fee64" strokeWidth="1.5" fill="rgba(127,238,100,0.05)"
      />
      {/* Glow */}
      <ellipse cx={s * 0.8} cy={s * 1.8} rx={s * 0.7} ry={s * 0.2} fill="rgba(127,238,100,0.15)" />
    </svg>
  );
}

export default function CtaSection() {
  return (
    <>
      {/* CTA Section */}
      <section
        style={{
          background: "#000000",
          padding: "80px 24px 100px",
          borderTop: "1px solid #3e4a3c",
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
          {/* Left — cubes cluster */}
          <div style={{ position: "relative", height: "320px" }}>
            <MiniCube size={70} x={60} y={30} opacity={0.9} />
            <MiniCube size={50} x={20} y={120} opacity={0.6} />
            <MiniCube size={90} x={160} y={100} opacity={1} />
            <MiniCube size={40} x={280} y={40} opacity={0.5} />
            <MiniCube size={55} x={300} y={160} opacity={0.7} />
            {/* ground glow */}
            <div style={{
              position: "absolute",
              bottom: 0,
              left: "50%",
              transform: "translateX(-50%)",
              width: "400px",
              height: "80px",
              background: "radial-gradient(ellipse, rgba(127,238,100,0.12) 0%, transparent 70%)",
            }} />
          </div>

          {/* Right — text */}
          <div>
            <h2 style={{
              fontFamily: "var(--font-goga)",
              fontSize: "clamp(36px, 4vw, 54px)",
              fontWeight: 400,
              color: "#ddffdc",
              lineHeight: 1.1,
              letterSpacing: "-0.81px",
              marginBottom: "32px",
              maxWidth: "480px",
            }}>
              Start observing the AI ecosystem in minutes.
            </h2>
            <Link
              href="/signup"
              style={{
                display: "inline-block",
                fontFamily: "var(--font-inter-variable)",
                fontSize: "15px",
                fontWeight: 500,
                color: "#000000",
                background: "#7fee64",
                padding: "12px 28px",
                borderRadius: "4px",
                textDecoration: "none",
                letterSpacing: "-0.022em",
              }}
            >
              Get Early Access
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer
        style={{
          background: "#000000",
          borderTop: "1px solid #3e4a3c",
          padding: "64px 24px 40px",
        }}
      >
        <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr", gap: "40px", marginBottom: "48px" }}>
            {/* Brand */}
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "16px" }}>
                <svg width="24" height="24" viewBox="0 0 28 28" fill="none">
                  <rect x="2" y="8" width="16" height="16" rx="2" stroke="#7fee64" strokeWidth="1.5" fill="none" />
                  <rect x="10" y="2" width="16" height="16" rx="2" stroke="#7fee64" strokeWidth="1.5" fill="rgba(127,238,100,0.08)" />
                  <line x1="2" y1="8" x2="10" y2="2" stroke="#7fee64" strokeWidth="1.5" />
                  <line x1="18" y1="8" x2="26" y2="2" stroke="#7fee64" strokeWidth="1.5" />
                  <line x1="18" y1="24" x2="26" y2="18" stroke="#7fee64" strokeWidth="1.5" />
                </svg>
                <span style={{ fontFamily: "var(--font-goga)", fontSize: "16px", fontWeight: 500, color: "#ddffdc" }}>
                  AIscentra
                </span>
              </div>
              <p style={{
                fontFamily: "var(--font-inter-variable)",
                fontSize: "14px",
                color: "#7fee64",
                lineHeight: 1.5,
                marginBottom: "20px",
              }}>
                Intelligence Observatory<br />
                <span style={{ color: "#677d64" }}>for the global AI ecosystem</span>
              </p>
              {/* Social icons */}
              <div style={{ display: "flex", gap: "10px" }}>
                {["𝕏", "in", "●", "▶"].map((icon, i) => (
                  <a key={i} href="#" style={{
                    width: "34px", height: "34px",
                    border: "1px solid #3e4a3c",
                    borderRadius: "50%",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: "#677d64",
                    fontSize: "12px",
                    textDecoration: "none",
                  }}>
                    {icon}
                  </a>
                ))}
              </div>
            </div>

            {/* Links columns */}
            {[
              { title: "Platform", links: ["Observatory", "Signals", "AI Agents", "Discussion", "Assistant"] },
              { title: "Intelligence", links: ["Models Tracker", "Trend Reports", "Event Feed", "Rankings", "API"] },
              { title: "Company", links: ["About", "Blog", "Careers", "Privacy", "Terms"] },
              { title: "Resources", links: ["Documentation", "Community", "Changelog", "Status", "Contact"] },
            ].map((col) => (
              <div key={col.title}>
                <p style={{
                  fontFamily: "var(--font-inter-variable)",
                  fontSize: "13px",
                  fontWeight: 600,
                  color: "#ddffdc",
                  marginBottom: "16px",
                }}>
                  {col.title}
                </p>
                {col.links.map((link) => (
                  <a key={link} href="#" style={{
                    display: "block",
                    fontFamily: "var(--font-inter-variable)",
                    fontSize: "13px",
                    color: "#677d64",
                    textDecoration: "none",
                    marginBottom: "10px",
                    transition: "color 0.15s",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = "#ddffdc")}
                  onMouseLeave={(e) => (e.currentTarget.style.color = "#677d64")}
                  >
                    {link}
                  </a>
                ))}
              </div>
            ))}
          </div>

          <div style={{
            borderTop: "1px solid #3e4a3c",
            paddingTop: "24px",
            fontFamily: "var(--font-inter-variable)",
            fontSize: "13px",
            color: "#485346",
          }}>
            © AIscentra 2026
          </div>
        </div>
      </footer>
    </>
  );
}
