import Dashboard from "@/components/Dashboard";

export default function Page() {
  return (
    <div className="min-h-screen grid-bg">
      <header className="border-b border-ink-rail bg-ink-soft/40 backdrop-blur">
        <div className="mx-auto max-w-[1700px] px-6 py-4 flex items-baseline justify-between">
          <div className="flex items-baseline gap-4">
            <h1 className="font-mono text-base font-semibold text-text">
              PartFlow
            </h1>
            <span className="font-sans text-xs uppercase tracking-widest text-text-faint">
              Multi-Agent Quote Automation · Auto Parts B2B
            </span>
          </div>
          <div className="flex items-baseline gap-6 text-xs font-mono text-text-faint">
            <span>POWERED BY ANTHROPIC CLAUDE</span>
            <span>v0.1</span>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1700px] px-6 py-6">
        <Dashboard />
      </main>
    </div>
  );
}
