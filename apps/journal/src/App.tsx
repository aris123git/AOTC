import { useEffect, useState, useTransition } from "react";

type Screen =
  | "welcome"
  | "signup"
  | "kyc"
  | "deposit"
  | "market"
  | "order"
  | "executing"
  | "portfolio"
  | "activity";

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

const INSTRUMENT = {
  symbol: "SNTS",
  name: "Sonatel",
  exchange: "DEMO",
  priceMinor: 15_000,
  qty: 100,
};

function xof(minor: number): string {
  return (minor / 100).toLocaleString("fr-FR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

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
  const [screen, setScreen] = useState<Screen>("welcome");
  const [name, setName] = useState("Aïcha Diallo");
  const [email, setEmail] = useState("aicha@exemple.sn");
  const [kycReady, setKycReady] = useState(false);
  const [depositDone, setDepositDone] = useState(false);
  const [cashMinor, setCashMinor] = useState(0);
  const [holdings, setHoldings] = useState(0);
  const [result, setResult] = useState<DemoResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(0);
  const [pending, startTransition] = useTransition();
  const [running, setRunning] = useState(false);

  const onboarded = depositDone || holdings > 0;
  const orderCost = INSTRUMENT.qty * INSTRUMENT.priceMinor;

  async function executeOrder() {
    setScreen("executing");
    setRunning(true);
    setError(null);
    setVisibleCount(0);
    try {
      const res = await fetch("/api/demo", { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as DemoResult;
      startTransition(() => {
        setResult(data);
        setCashMinor(data.portfolio.cash_available);
        setHoldings(data.portfolio.holdings_qty);
        setDepositDone(true);
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Échec de l’ordre");
      setScreen("order");
    } finally {
      setRunning(false);
    }
  }

  useEffect(() => {
    if (!result || screen !== "executing") return;
    setVisibleCount(0);
    let i = 0;
    const id = window.setInterval(() => {
      i += 1;
      setVisibleCount(i);
      if (i >= result.timeline.length) {
        window.clearInterval(id);
        window.setTimeout(() => setScreen("portfolio"), 450);
      }
    }, 140);
    return () => window.clearInterval(id);
  }, [result, screen]);

  function resetDemo() {
    setScreen("welcome");
    setKycReady(false);
    setDepositDone(false);
    setCashMinor(0);
    setHoldings(0);
    setResult(null);
    setError(null);
    setVisibleCount(0);
  }

  const items = (result?.timeline ?? []).map(parseLine);
  const shown = items.slice(0, visibleCount);

  return (
    <div className="app">
      <div className="atmosphere" aria-hidden="true" />

      {onboarded && screen !== "welcome" && screen !== "signup" && screen !== "kyc" && (
        <nav className="topnav" aria-label="Navigation principale">
          <button type="button" className="nav-brand" onClick={() => setScreen("market")}>
            AOTC
          </button>
          <div className="nav-links">
            <button
              type="button"
              className={screen === "market" || screen === "order" ? "active" : ""}
              onClick={() => setScreen("market")}
            >
              Marché
            </button>
            <button
              type="button"
              className={screen === "portfolio" ? "active" : ""}
              onClick={() => setScreen("portfolio")}
            >
              Portefeuille
            </button>
            <button
              type="button"
              className={screen === "activity" || screen === "executing" ? "active" : ""}
              onClick={() => setScreen("activity")}
            >
              Activité
            </button>
          </div>
        </nav>
      )}

      {screen === "welcome" && (
        <section className="screen welcome">
          <div className="hero-plane" aria-hidden="true" />
          <div className="welcome-copy">
            <p className="brand">AOTC</p>
            <h1>Investissez sur les marchés ouest-africains</h1>
            <p className="lede">
              Compte, KYC, dépôt et premier ordre — en mode sandbox, comme en production.
            </p>
            <div className="cta-row">
              <button type="button" className="cta" onClick={() => setScreen("signup")}>
                Ouvrir mon compte
              </button>
            </div>
          </div>
        </section>
      )}

      {screen === "signup" && (
        <section className="screen form-screen">
          <p className="eyebrow">Étape 1 · Compte</p>
          <h1>Créer votre profil investisseur</h1>
          <p className="lede">Identifiants sandbox — aucune donnée réelle n’est envoyée.</p>
          <form
            className="stack-form"
            onSubmit={(e) => {
              e.preventDefault();
              setScreen("kyc");
            }}
          >
            <label>
              Nom complet
              <input value={name} onChange={(e) => setName(e.target.value)} required />
            </label>
            <label>
              E-mail
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>
            <button type="submit" className="cta">
              Continuer
            </button>
          </form>
        </section>
      )}

      {screen === "kyc" && (
        <section className="screen form-screen">
          <p className="eyebrow">Étape 2 · KYC</p>
          <h1>Vérification d’identité</h1>
          <p className="lede">
            Soumettez vos pièces. La SGI partenaire valide le dossier en sandbox.
          </p>
          <div className="kyc-panel">
            <button
              type="button"
              className={`doc-slot ${kycReady ? "ready" : ""}`}
              onClick={() => setKycReady(true)}
            >
              {kycReady ? "Pièce d’identité · prête" : "Ajouter une pièce d’identité"}
            </button>
            {kycReady && (
              <p className="status-ok fade-in">SGI · KYC validé pour {name}</p>
            )}
          </div>
          <div className="cta-row">
            <button
              type="button"
              className="cta"
              disabled={!kycReady}
              onClick={() => setScreen("deposit")}
            >
              Accéder au dépôt
            </button>
          </div>
        </section>
      )}

      {screen === "deposit" && (
        <section className="screen form-screen">
          <p className="eyebrow">Étape 3 · Liquidités</p>
          <h1>Dépôt simulé</h1>
          <p className="lede">Crédit sandbox Mobile Money — sans mouvement réel de fonds.</p>
          <div className="amount-hero">
            <span className="amount-value">{xof(5_000_000)}</span>
            <span className="amount-unit">XOF</span>
          </div>
          <div className="cta-row">
            <button
              type="button"
              className="cta"
              onClick={() => {
                setCashMinor(5_000_000);
                setDepositDone(true);
                setScreen("market");
              }}
            >
              Déposer {xof(5_000_000)} XOF
            </button>
          </div>
        </section>
      )}

      {screen === "market" && (
        <section className="screen market-screen">
          <header className="section-head">
            <p className="eyebrow">Marché · {INSTRUMENT.exchange}</p>
            <h1>Actions disponibles</h1>
            <p className="lede">Catalogue simulé Lot&nbsp;1 — un titre pour prouver le parcours.</p>
          </header>
          <button type="button" className="instrument-row" onClick={() => setScreen("order")}>
            <div>
              <strong>{INSTRUMENT.symbol}</strong>
              <span>{INSTRUMENT.name}</span>
            </div>
            <div className="instrument-price">
              <strong>{xof(INSTRUMENT.priceMinor)}</strong>
              <span>XOF</span>
            </div>
          </button>
          <p className="cash-hint">
            Cash disponible · <strong>{xof(cashMinor)} XOF</strong>
          </p>
        </section>
      )}

      {screen === "order" && (
        <section className="screen form-screen">
          <p className="eyebrow">Ordre d’achat</p>
          <h1>
            {INSTRUMENT.symbol} · {INSTRUMENT.name}
          </h1>
          <p className="lede">
            Achat limite · {INSTRUMENT.qty} titres @ {xof(INSTRUMENT.priceMinor)} XOF
          </p>
          <dl className="order-summary">
            <div>
              <dt>Quantité</dt>
              <dd>{INSTRUMENT.qty}</dd>
            </div>
            <div>
              <dt>Prix limite</dt>
              <dd>{xof(INSTRUMENT.priceMinor)} XOF</dd>
            </div>
            <div>
              <dt>Montant estimé</dt>
              <dd>{xof(orderCost)} XOF</dd>
            </div>
          </dl>
          {error && <p className="error">{error}</p>}
          <div className="cta-row">
            <button
              type="button"
              className="cta"
              disabled={running || pending}
              onClick={() => void executeOrder()}
            >
              {running ? "Envoi…" : "Passer l’ordre"}
            </button>
            <button type="button" className="cta-ghost" onClick={() => setScreen("market")}>
              Retour
            </button>
          </div>
        </section>
      )}

      {screen === "executing" && (
        <section className="screen executing-screen">
          <p className="eyebrow">Exécution</p>
          <h1>Votre ordre traverse les moteurs</h1>
          <p className="lede">Risk → Treasury → SOR → Trading → Liquidity → Settlement</p>
          <ol className="timeline" aria-live="polite">
            {shown.map((item, idx) => (
              <li
                key={`${item.time}-${idx}`}
                className={`event tone-${item.tone}`}
                style={{ animationDelay: `${Math.min(idx * 30, 300)}ms` }}
              >
                <time dateTime={item.time}>{item.time}</time>
                <span>{item.text}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {screen === "portfolio" && (
        <section className="screen portfolio-screen">
          <header className="section-head">
            <p className="eyebrow">Portefeuille · sandbox</p>
            <h1>Bonjour, {name.split(" ")[0]}</h1>
            <p className="lede">Positions après votre premier ordre Lot&nbsp;1.</p>
          </header>

          <div className="balance-block">
            <p className="balance-label">Cash disponible</p>
            <p className="balance-value">
              {xof(cashMinor)} <span>XOF</span>
            </p>
          </div>

          <div className="holding-block">
            <p className="holding-label">Position</p>
            {holdings > 0 ? (
              <button type="button" className="instrument-row" onClick={() => setScreen("activity")}>
                <div>
                  <strong>{INSTRUMENT.symbol}</strong>
                  <span>
                    {holdings} titres · {INSTRUMENT.name}
                  </span>
                </div>
                <div className="instrument-price">
                  <strong>{xof(holdings * INSTRUMENT.priceMinor)}</strong>
                  <span>valeur</span>
                </div>
              </button>
            ) : (
              <p className="lede">Aucune position — passez un ordre sur le marché.</p>
            )}
          </div>

          <div className="cta-row">
            <button type="button" className="cta" onClick={() => setScreen("market")}>
              Voir le marché
            </button>
            <button type="button" className="cta-ghost" onClick={resetDemo}>
              Recommencer la démo
            </button>
          </div>
        </section>
      )}

      {screen === "activity" && (
        <section className="screen activity-screen">
          <header className="section-head">
            <p className="eyebrow">Activité & audit</p>
            <h1>Journal de simulation</h1>
            <p className="lede">Chronologie complète du parcours — pour vous et vos partenaires.</p>
          </header>
          {result ? (
            <>
              <ol className="timeline">
                {items.map((item, idx) => (
                  <li key={`${item.time}-${idx}`} className={`event tone-${item.tone} visible`}>
                    <time dateTime={item.time}>{item.time}</time>
                    <span>{item.text}</span>
                  </li>
                ))}
              </ol>
              <footer className="ids">
                <span>correlation · {result.correlation_id}</span>
                <span>ordre · {result.order_id}</span>
                {result.trade_id && <span>trade · {result.trade_id}</span>}
              </footer>
            </>
          ) : (
            <p className="lede">Passez un ordre pour remplir le journal.</p>
          )}
        </section>
      )}
    </div>
  );
}
