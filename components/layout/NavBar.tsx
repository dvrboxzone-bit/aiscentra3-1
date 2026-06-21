"use client";
import { useState, useEffect } from "react";
import Link from "next/link";

const navItems = [
  { label: "Observatory", href: "#observatory" },
  { label: "Signals", href: "#signals" },
  { label: "Agents", href: "#agents" },
  { label: "Discussion", href: "#discussion" },
  { label: "About", href: "#about" },
];

export default function NavBar() {
  const [scrolled, setScrolled] = useState(false);
  const [active, setActive] = useState("Observatory");

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 100,
        padding: "0 24px",
        height: "60px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        background: scrolled ? "rgba(33,37,37,0.95)" : "#212525",
        backdropFilter: scrolled ? "blur(12px)" : "none",
        borderBottom: "1px solid #3e4a3c",
        boxShadow: scrolled ? "rgba(0,0,0,0.2) 0px 4px 24px" : "none",
        transition: "all 0.2s ease",
      }}
    >
      {/* Logo */}
      <Link
        href="/"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          textDecoration: "none",
          flexShrink: 0,
        }}
      >
        {/* Logo mark — animated cube */}
        <div style={{ position: "relative", width: 28, height: 28 }}>
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
            <rect
              x="2" y="8" width="16" height="16"
              rx="2"
              stroke="#7fee64"
              strokeWidth="1.5"
              fill="none"
            />
            <rect
              x="10" y="2" width="16" height="16"
              rx="2"
              stroke="#7fee64"
              strokeWidth="1.5"
              fill="rgba(127,238,100,0.08)"
            />
            <line x1="2" y1="8" x2="10" y2="2" stroke="#7fee64" strokeWidth="1.5" />
            <line x1="18" y1="8" x2="26" y2="2" stroke="#7fee64" strokeWidth="1.5" />
            <line x1="18" y1="24" x2="26" y2="18" stroke="#7fee64" strokeWidth="1.5" />
          </svg>
        </div>
        <span
          style={{
            fontFamily: "var(--font-goga)",
            fontSize: "18px",
            fontWeight: 500,
            color: "#ddffdc",
            letterSpacing: "-0.3px",
          }}
        >
          AIscentra
        </span>
      </Link>

      {/* Nav items */}
      <nav style={{ display: "flex", alignItems: "center", gap: "4px" }}>
        {navItems.map((item) => (
          <Link
            key={item.label}
            href={item.href}
            onClick={() => setActive(item.label)}
            style={{
              fontFamily: "var(--font-inter-variable)",
              fontSize: "14px",
              fontWeight: 500,
              color: active === item.label ? "#ddffdc" : "#677d64",
              textDecoration: "none",
              padding: "6px 14px",
              borderRadius: "4px",
              borderBottom: active === item.label ? "2px solid #7fee64" : "2px solid transparent",
              transition: "color 0.15s, border-color 0.15s",
            }}
            onMouseEnter={(e) => {
              if (active !== item.label)
                (e.currentTarget as HTMLElement).style.color = "#ddffdc";
            }}
            onMouseLeave={(e) => {
              if (active !== item.label)
                (e.currentTarget as HTMLElement).style.color = "#677d64";
            }}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      {/* Actions */}
      <div style={{ display: "flex", alignItems: "center", gap: "12px", flexShrink: 0 }}>
        <Link
          href="/login"
          style={{
            fontFamily: "var(--font-inter-variable)",
            fontSize: "14px",
            fontWeight: 500,
            color: "#ddffdc",
            textDecoration: "none",
          }}
        >
          Log In
        </Link>
        <Link
          href="/signup"
          style={{
            fontFamily: "var(--font-inter-variable)",
            fontSize: "14px",
            fontWeight: 500,
            color: "#000000",
            background: "#7fee64",
            padding: "8px 18px",
            borderRadius: "4px",
            textDecoration: "none",
            letterSpacing: "-0.022em",
            display: "flex",
            alignItems: "center",
            gap: "6px",
          }}
        >
          Get Access
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2 10L10 2M10 2H4M10 2V8" stroke="#000" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </Link>
      </div>
    </header>
  );
}
