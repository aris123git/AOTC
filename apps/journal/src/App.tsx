import { useEffect, useState, useTransition } from "react";

type DemoResult = {
  correlation_id: string;
  timeline: string[];
  order_id: string;
  trade_id: string | null;
  portfolio: { cash_available: number; holdings_qty: number };
};

type TimelineItem = {
  time: string;
  text: string;
  tone: "neutral" | "success" | "engine" | "audit";
};

function parseLine(line: string): TimelineItem {
  const m = line.match(/^(\d{2}:\d{2}:\d{2})\s+(.*)$/);
  const time = m?.[1] ?? "";
  const text = m?.[2] ?? line;
  let tone: TimelineItem["tone"] = "neutral";
  if (/VALIDÉ|approuvée|Exécuté|mis à jour|créé|créée|validé/i.test(text)) {
    tone = "success";
  } else if (/Engine|Router|Treasury|Settlement|Liquidity|Risk|Trading|SOR/i.test(text)) {
    tone = "engine";
  } else if (/Audit/i.test(text)) {
    tone = "audit";
  }
  return { time, text, tone };
}

export function App() {
  const [result, setResult] = useState<DemoResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(0);
  const [pending, startTransition] = useTransition();
  const [running, setRunning] = useState(false);

  async function runDemo() {
    setRunning(true);
    setError(null);
    setVisibleCount(0);
    try {
      const res = await fetch("/api/demo", { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as DemoResult;
      startTransition(() => setResult(data));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Échec de la démo");
      setResult(null);
    } finally {
      setRunning(false);
    }
  }

  useEffect(() => {
    void runDemo();
  }, []);

  useEffect(() => {
    if (!result) return;
    setVisibleCount(0);
    let i = 0;
    const id = window.setInterval(() => {
      i += 1;
      setVisibleCount(i);
      if (i >= result.timeline.length) window.clearInterval(id);
    }, 180);
    return () => window.clearInterval(id);
  }, [result]);

  const items = (result?.timeline ?? []).map(parseLine);
  const shown = items.slice(0, visibleCount);

  return (
    <div className="page">
      <div className="atmosphere" aria-hidden="true" />

      <header className="hero">
        <p className="brand">AOTC</p>
        <h1>Journal de simulation</h1>
        <p className="lede">
          Chronologie lisible du parcours Lot&nbsp;1 — de l’inscription à
          l’instruction de règlement T+3.
        </p>
        <div className="cta-row">
          <button
            type="button"
            className="cta"
            onClick={() => void runDemo()}
            disabled={running || pending}
          >
            {running ? "Exécution…" : "Rejouer le scénario"}
          </button>
          {result && (
            <p className="meta">
              sandbox · {result.portfolio.holdings_qty} SNTS · cash{" "}
              {(result.portfolio.cash_available / 100).toLocaleString("fr-FR")}{" "}
              XOF
            </p>
          )}
        </div>
      </header>

      <main className="stage">
        {error && <p className="error">{error}</p>}

        <ol className="timeline" aria-live="polite">
          {shown.map((item, idx) => (
            <li
              key={`${item.time}-${idx}`}
              className={`event tone-${item.tone}`}
              style={{ animationDelay: `${Math.min(idx * 40, 400)}ms` }}
            >
              <time dateTime={item.time}>{item.time}</time>
              <span>{item.text}</span>
            </li>
          ))}
        </ol>

        {result && visibleCount >= items.length && (
          <footer className="ids">
            <span>correlation · {result.correlation_id}</span>
            <span>ordre · {result.order_id}</span>
            {result.trade_id && <span>trade · {result.trade_id}</span>}
          </footer>
        )}
      </main>
    </div>
  );
}
