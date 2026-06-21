export default function Home() {
  return (
    <main className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <p
          className="text-xs uppercase tracking-widest mb-4"
          style={{ color: "var(--color-lichen)", letterSpacing: "0.1em" }}
        >
          Intelligence Observatory
        </p>
        <h1
          className="text-6xl font-medium mb-6"
          style={{
            fontFamily: "var(--font-goga)",
            color: "var(--color-phosphor-mint)",
            letterSpacing: "-0.96px",
            lineHeight: 1.05,
          }}
        >
          AIscentra
        </h1>
        <p
          className="text-base max-w-md mx-auto"
          style={{ color: "var(--color-phosphor-mint)", opacity: 0.7 }}
        >
          Observe. Analyze. Accelerate the Future.
        </p>
      </div>
    </main>
  );
}
