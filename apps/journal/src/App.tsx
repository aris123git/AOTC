import { useEffect, useState, useTransition } from "react";
import {
  api,
  bpsLabel,
  xof,
  type Activity,
  type Candle,
  type EducationModule,
  type MarketSymbol,
  type OpsSnapshot,
  type Order,
  type OrderBook,
  type PartnerStats,
  type Portfolio,
  type Settlement,
  type Trade,
  type User,
} from "./api";

type Screen =
  | "welcome"
  | "signup"
  | "kyc"
  | "cash"
  | "market"
  | "instrument"
  | "portfolio"
  | "orders"
  | "settlements"
  | "activity"
  | "education"
  | "admin";

const DEPOSIT_PRESETS = [1_000_000, 5_000_000, 10_000_000];

function Sparkline({ candles }: { candles: Candle[] }) {
  if (candles.length < 2) return null;
  const closes = candles.map((c) => c.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const span = Math.max(1, max - min);
  const w = 120;
  const h = 36;
  const pts = closes
    .map((v, i) => {
      const x = (i / (closes.length - 1)) * w;
      const y = h - ((v - min) / span) * (h - 4) - 2;
      return `${x},${y}`;
    })
    .join(" ");
  const up = closes[closes.length - 1]! >= closes[0]!;
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} aria-hidden>
      <polyline
        fill="none"
        stroke={up ? "var(--ok)" : "var(--danger)"}
        strokeWidth="2"
        points={pts}
      />
    </svg>
  );
}

function BookDepth({ book }: { book: OrderBook | null }) {
  if (!book) return <p className="muted">Carnet en chargement…</p>;
  const asks = [...book.asks].reverse().slice(0, 5);
  const bids = book.bids.slice(0, 5);
  return (
    <div className="book">
      <div className="book-col asks">
        <p className="book-label">Asks</p>
        {asks.length === 0 && <p className="muted">—</p>}
        {asks.map((l) => (
          <div key={`a-${l.price}`} className="book-row">
            <span>{xof(l.price)}</span>
            <span>{l.qty}</span>
          </div>
        ))}
      </div>
      <div className="book-col bids">
        <p className="book-label">Bids</p>
        {bids.length === 0 && <p className="muted">—</p>}
        {bids.map((l) => (
          <div key={`b-${l.price}`} className="book-row">
            <span>{xof(l.price)}</span>
            <span>{l.qty}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function App() {
  const [screen, setScreen] = useState<Screen>("welcome");
  const [name, setName] = useState("Aïcha Diallo");
  const [email, setEmail] = useState("aicha@exemple.sn");
  const [user, setUser] = useState<User | null>(null);
  const [kycDoc, setKycDoc] = useState(false);
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [market, setMarket] = useState<MarketSymbol[]>([]);
  const [symbol, setSymbol] = useState<string | null>(null);
  const [book, setBook] = useState<OrderBook | null>(null);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [orderType, setOrderType] = useState<"market" | "limit">("market");
  const [qty, setQty] = useState(10);
  const [limitPrice, setLimitPrice] = useState(0);
  const [orders, setOrders] = useState<Order[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [activity, setActivity] = useState<Activity | null>(null);
  const [education, setEducation] = useState<EducationModule[]>([]);
  const [eduOpen, setEduOpen] = useState<string | null>(null);
  const [ops, setOps] = useState<OpsSnapshot | null>(null);
  const [partner, setPartner] = useState<PartnerStats | null>(null);
  const [depositAmt, setDepositAmt] = useState(5_000_000);
  const [withdrawAmt, setWithdrawAmt] = useState(500_000);
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  const onboarded = user?.kyc_status === "approved" && (portfolio?.cash_available ?? 0) > 0;
  const selected = market.find((m) => m.symbol === symbol) ?? null;

  async function refreshPortfolio() {
    try {
      setPortfolio(await api.portfolio());
    } catch {
      /* pas encore authentifié */
    }
  }

  async function refreshMarket() {
    setMarket(await api.market());
  }

  async function openInstrument(sym: string) {
    setSymbol(sym);
    setScreen("instrument");
    setError(null);
    const [b, c, inst] = await Promise.all([
      api.book(sym),
      api.candles(sym),
      api.instrument(sym),
    ]);
    setBook(b);
    setCandles(c);
    setLimitPrice(inst.reference_price);
    setSide("buy");
    setOrderType("market");
    setQty(10);
  }

  async function refreshTradingViews() {
    const [o, t] = await Promise.all([api.orders(), api.trades()]);
    setOrders(o);
    setTrades(t);
  }

  useEffect(() => {
    void (async () => {
      try {
        const s = await api.session();
        if (s.user) {
          setUser(s.user);
          await refreshPortfolio();
          await refreshMarket();
        }
      } catch {
        /* cold start */
      }
    })();
  }, []);

  async function handleSignup() {
    setBusy(true);
    setError(null);
    try {
      const u = await api.signup(name.trim(), email.trim());
      setUser(u);
      setScreen("kyc");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inscription");
    } finally {
      setBusy(false);
    }
  }

  async function handleKyc() {
    setBusy(true);
    setError(null);
    try {
      const u = await api.submitKyc();
      setUser(u);
      setFlash("KYC validé par la SGI partenaire (sandbox)");
      setScreen("cash");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur KYC");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeposit() {
    setBusy(true);
    setError(null);
    try {
      const p = await api.deposit(depositAmt);
      setPortfolio(p);
      await refreshMarket();
      setFlash(`Dépôt simulé : ${xof(depositAmt)} XOF`);
      setScreen("market");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Dépôt refusé");
    } finally {
      setBusy(false);
    }
  }

  async function handleWithdraw() {
    setBusy(true);
    setError(null);
    try {
      const p = await api.withdraw(withdrawAmt);
      setPortfolio(p);
      setFlash(`Retrait simulé : ${xof(withdrawAmt)} XOF`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Retrait refusé");
    } finally {
      setBusy(false);
    }
  }

  async function handleOrder() {
    if (!symbol) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.placeOrder({
        symbol,
        side,
        order_type: orderType,
        qty,
        price_limit: orderType === "limit" ? limitPrice : undefined,
      });
      await Promise.all([refreshPortfolio(), refreshTradingViews()]);
      const b = await api.book(symbol);
      setBook(b);
      if (result.rejected) {
        setError(
          `Risk : ${(result.order.rejection_reasons ?? []).join(", ") || "rejeté"}`,
        );
      } else {
        const liq = result.fills.some((f) => f.aotc_as_principal);
        setFlash(
          result.order.status === "resting"
            ? `Ordre au carnet · ${result.order.qty_remaining} restants`
            : liq
              ? `Exécuté avec liquidité AOTC (${result.fills.length} fill)`
              : `Exécuté · ${result.order.qty_filled} @ book interne`,
        );
        startTransition(() => setScreen("portfolio"));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ordre échoué");
    } finally {
      setBusy(false);
    }
  }

  async function go(screenName: Screen) {
    setError(null);
    setScreen(screenName);
    try {
      if (screenName === "market") await refreshMarket();
      if (screenName === "portfolio") {
        await refreshPortfolio();
        await refreshTradingViews();
      }
      if (screenName === "orders") await refreshTradingViews();
      if (screenName === "settlements") setSettlements(await api.settlements());
      if (screenName === "activity") setActivity(await api.activity());
      if (screenName === "education") setEducation(await api.education());
      if (screenName === "admin") {
        const [o, p] = await Promise.all([api.ops(), api.partner()]);
        setOps(o);
        setPartner(p);
      }
      if (screenName === "cash") await refreshPortfolio();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chargement impossible");
    }
  }

  async function resetAll() {
    setBusy(true);
    try {
      await api.reset();
      setUser(null);
      setPortfolio(null);
      setMarket([]);
      setOrders([]);
      setTrades([]);
      setSettlements([]);
      setActivity(null);
      setFlash(null);
      setError(null);
      setKycDoc(false);
      setScreen("welcome");
    } finally {
      setBusy(false);
    }
  }

  const showNav = Boolean(user);

  return (
    <div className="app">
      <div className="atmosphere" aria-hidden />
      <header className="topnav">
        <button type="button" className="nav-brand" onClick={() => go(onboarded ? "market" : "welcome")}>
          AOTC
        </button>
        {showNav && (
          <nav className="nav-links" aria-label="Principal">
            {onboarded && (
              <>
                <button type="button" className={screen === "market" || screen === "instrument" ? "active" : ""} onClick={() => go("market")}>
                  Marché
                </button>
                <button type="button" className={screen === "portfolio" ? "active" : ""} onClick={() => go("portfolio")}>
                  Portefeuille
                </button>
                <button type="button" className={screen === "orders" ? "active" : ""} onClick={() => go("orders")}>
                  Ordres
                </button>
                <button type="button" className={screen === "settlements" ? "active" : ""} onClick={() => go("settlements")}>
                  RL
                </button>
                <button type="button" className={screen === "activity" ? "active" : ""} onClick={() => go("activity")}>
                  Activité
                </button>
                <button type="button" className={screen === "education" ? "active" : ""} onClick={() => go("education")}>
                  Éducation
                </button>
                <button type="button" className={screen === "admin" ? "active" : ""} onClick={() => go("admin")}>
                  NOC
                </button>
                <button type="button" className={screen === "cash" ? "active" : ""} onClick={() => go("cash")}>
                  Cash
                </button>
              </>
            )}
            <button type="button" onClick={() => void resetAll()} disabled={busy}>
              Reset
            </button>
          </nav>
        )}
      </header>

      {flash && (
        <p className="flash" role="status">
          {flash}
          <button type="button" onClick={() => setFlash(null)} aria-label="Fermer">
            ×
          </button>
        </p>
      )}
      {error && <p className="error banner">{error}</p>}

      {screen === "welcome" && (
        <section className="screen welcome">
          <div className="hero-plane" aria-hidden />
          <div className="welcome-copy">
            <p className="brand">AOTC</p>
            <h1>La liquidité des marchés africains, enfin accessible.</h1>
            <p className="lede">
              Ouvrez un compte sandbox, déposez en Mobile Money simulé, et tradez
              sur le carnet DEMO — Risk, SOR, Matching, Liquidité et Settlement
              enchaînés.
            </p>
            <div className="cta-row">
              <button type="button" className="cta" onClick={() => setScreen("signup")}>
                Ouvrir mon compte
              </button>
              <button type="button" className="cta-ghost light" onClick={() => go("education")}>
                Comprendre la bourse
              </button>
            </div>
          </div>
        </section>
      )}

      {screen === "signup" && (
        <section className="screen form-screen">
          <p className="eyebrow">Sandbox · inscription</p>
          <h1>Créer mon compte investisseur</h1>
          <p className="lede">Identifiants sandbox — aucune donnée réelle n’est envoyée.</p>
          <div className="stack-form">
            <label>
              Nom complet
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label>
              E-mail
              <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" />
            </label>
            <button type="button" className="cta" disabled={busy || !name || !email} onClick={() => void handleSignup()}>
              Continuer
            </button>
          </div>
        </section>
      )}

      {screen === "kyc" && (
        <section className="screen form-screen">
          <p className="eyebrow">KYC · SGI partenaire</p>
          <h1>Vérification d’identité</h1>
          <p className="lede">Soumettez vos pièces. La SGI valide le dossier en sandbox.</p>
          <div className="kyc-panel">
            <button
              type="button"
              className={`doc-slot ${kycDoc ? "ready" : ""}`}
              onClick={() => setKycDoc(true)}
            >
              {kycDoc ? "Pièce d’identité · prête" : "Ajouter une pièce d’identité (simulé)"}
            </button>
            {kycDoc && <p className="status-ok">Document reçu — prêt pour validation SGI</p>}
            <button type="button" className="cta" disabled={!kycDoc || busy} onClick={() => void handleKyc()}>
              Soumettre le KYC
            </button>
          </div>
        </section>
      )}

      {screen === "cash" && (
        <section className="screen form-screen">
          <p className="eyebrow">Paiements · sandbox</p>
          <h1>Dépôt & retrait simulés</h1>
          <p className="lede">
            Mobile Money fictif (Orange / Moov / Wave) — aucun mouvement réel de fonds.
          </p>
          {portfolio && (
            <p className="cash-hint">
              Disponible : <strong>{xof(portfolio.cash_available)} XOF</strong>
              {portfolio.cash_locked > 0 && <> · Verrouillé : {xof(portfolio.cash_locked)} XOF</>}
            </p>
          )}
          <div className="cash-grid">
            <div>
              <h2>Dépôt</h2>
              <div className="preset-row">
                {DEPOSIT_PRESETS.map((a) => (
                  <button
                    key={a}
                    type="button"
                    className={depositAmt === a ? "chip active" : "chip"}
                    onClick={() => setDepositAmt(a)}
                  >
                    {xof(a)}
                  </button>
                ))}
              </div>
              <div className="amount-hero">
                <span className="amount-value">{xof(depositAmt)}</span>
                <span className="amount-unit">XOF</span>
              </div>
              <button type="button" className="cta" disabled={busy} onClick={() => void handleDeposit()}>
                Créditer (simulé)
              </button>
            </div>
            <div>
              <h2>Retrait</h2>
              <label className="inline-field">
                Montant (minor)
                <input
                  type="number"
                  value={withdrawAmt}
                  onChange={(e) => setWithdrawAmt(Number(e.target.value))}
                />
              </label>
              <button type="button" className="cta-ghost" disabled={busy || !portfolio} onClick={() => void handleWithdraw()}>
                Retirer {xof(withdrawAmt)} XOF
              </button>
            </div>
          </div>
        </section>
      )}

      {screen === "market" && (
        <section className="screen market-screen">
          <div className="section-head">
            <p className="eyebrow">Marché DEMO · actions</p>
            <h1>Catalogue coté</h1>
            <p className="lede">Cinq titres simulés — book interne + liquidité SGI_PARTNER.</p>
          </div>
          <ul className="market-list">
            {market.map((m) => (
              <li key={m.symbol}>
                <button type="button" className="instrument-row" onClick={() => void openInstrument(m.symbol)}>
                  <span>
                    <strong>{m.symbol}</strong>
                    <span>
                      {m.name} · {m.sector}
                      {m.status !== "tradable" ? " · suspendu" : ""}
                    </span>
                  </span>
                  <span className="instrument-price">
                    <strong>{xof(m.last)}</strong>
                    <span className={m.change_bps >= 0 ? "up" : "down"}>{bpsLabel(m.change_bps)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {screen === "instrument" && selected && (
        <section className="screen instrument-screen">
          <button type="button" className="link-back" onClick={() => go("market")}>
            ← Marché
          </button>
          <div className="instrument-hero">
            <div>
              <p className="eyebrow">{selected.sector}</p>
              <h1>
                {selected.symbol} <span className="soft">{selected.name}</span>
              </h1>
              <p className="price-lg">
                {xof(selected.last)} <span>XOF</span>
                <span className={selected.change_bps >= 0 ? "up" : "down"}>{bpsLabel(selected.change_bps)}</span>
              </p>
            </div>
            <Sparkline candles={candles} />
          </div>

          <div className="split-panels">
            <div>
              <h2>Carnet d’ordres</h2>
              <BookDepth book={book} />
            </div>
            <div className="ticket">
              <h2>Ticket d’ordre</h2>
              <div className="side-toggle">
                <button type="button" className={side === "buy" ? "active buy" : ""} onClick={() => setSide("buy")}>
                  Acheter
                </button>
                <button type="button" className={side === "sell" ? "active sell" : ""} onClick={() => setSide("sell")}>
                  Vendre
                </button>
              </div>
              <div className="side-toggle compact">
                <button type="button" className={orderType === "market" ? "active" : ""} onClick={() => setOrderType("market")}>
                  Marché
                </button>
                <button type="button" className={orderType === "limit" ? "active" : ""} onClick={() => setOrderType("limit")}>
                  Limite
                </button>
              </div>
              <label className="inline-field">
                Quantité
                <input type="number" min={1} value={qty} onChange={(e) => setQty(Number(e.target.value))} />
              </label>
              {orderType === "limit" && (
                <label className="inline-field">
                  Prix limite (minor)
                  <input
                    type="number"
                    value={limitPrice}
                    onChange={(e) => setLimitPrice(Number(e.target.value))}
                  />
                </label>
              )}
              <p className="muted tiny">
                Vente sans acheteur → Liquidity Engine (SGI_PARTNER). Risk contrôle cash / titres.
              </p>
              <button type="button" className="cta" disabled={busy || selected.status !== "tradable"} onClick={() => void handleOrder()}>
                {side === "buy" ? "Acheter" : "Vendre"} {qty} {selected.symbol}
              </button>
            </div>
          </div>
        </section>
      )}

      {screen === "portfolio" && portfolio && (
        <section className="screen portfolio-screen">
          <p className="eyebrow">Portefeuille · sandbox</p>
          <h1>Positions & cash</h1>
          <div className="balance-block">
            <p className="balance-label">Cash disponible</p>
            <p className="balance-value">
              {xof(portfolio.cash_available)}
              <span>XOF</span>
            </p>
            {portfolio.cash_locked > 0 && (
              <p className="muted">Verrouillé sur ordres : {xof(portfolio.cash_locked)} XOF</p>
            )}
          </div>
          <h2>Titres</h2>
          {portfolio.holdings.length === 0 && <p className="muted">Aucune position — passez un ordre sur le marché.</p>}
          <ul className="holdings">
            {portfolio.holdings.map((h) => (
              <li key={h.symbol}>
                <strong>{h.symbol}</strong>
                <span>
                  {h.qty} titres{h.locked ? ` · ${h.locked} verrouillés` : ""}
                </span>
                <button type="button" className="chip" onClick={() => void openInstrument(h.symbol)}>
                  Trader
                </button>
              </li>
            ))}
          </ul>
          {trades.length > 0 && (
            <>
              <h2>Derniers trades</h2>
              <ul className="data-list">
                {trades.slice(0, 8).map((t) => (
                  <li key={t.trade_id}>
                    <strong>
                      {t.side === "buy" ? "Achat" : "Vente"} {t.qty} {t.symbol}
                    </strong>
                    <span>
                      @ {xof(t.price)}
                      {t.aotc_as_principal ? " · liquidité AOTC" : ` · ${t.liquidity_source}`}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      {screen === "orders" && (
        <section className="screen portfolio-screen">
          <p className="eyebrow">Carnet personnel</p>
          <h1>Ordres</h1>
          {orders.length === 0 && <p className="muted">Aucun ordre pour cette session.</p>}
          <ul className="data-list">
            {orders.map((o) => (
              <li key={o.order_id}>
                <div>
                  <strong>
                    {o.side.toUpperCase()} {o.qty} {o.symbol}
                  </strong>
                  <span>
                    {o.order_type} · {o.status} · filled {o.qty_filled}
                    {o.avg_price ? ` · avg ${xof(o.avg_price)}` : ""}
                    {o.rejection_reasons?.length ? ` · ${o.rejection_reasons.join(", ")}` : ""}
                  </span>
                </div>
                {o.status === "resting" && (
                  <button
                    type="button"
                    className="chip"
                    onClick={() =>
                      void api.cancelOrder(o.order_id).then(refreshTradingViews).then(refreshPortfolio)
                    }
                  >
                    Annuler
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {screen === "settlements" && (
        <section className="screen portfolio-screen">
          <p className="eyebrow">Settlement Engine · T+3</p>
          <h1>Règlement-livraison</h1>
          <p className="lede">Instructions miroir vers SGI / DC-BR (sandbox).</p>
          {settlements.length === 0 && <p className="muted">Aucune instruction — exécutez un trade.</p>}
          <ul className="data-list">
            {settlements.map((s) => (
              <li key={s.settlement_id}>
                <div>
                  <strong>
                    {s.symbol ?? "—"} · {s.qty} @ {xof(s.amount / Math.max(1, s.qty))}
                  </strong>
                  <span>
                    {s.status} · date {s.settlement_date}
                    {s.confirmed_at ? ` · confirmé ${s.confirmed_at.slice(11, 19)}` : ""}
                  </span>
                </div>
                {s.status === "instructed" && (
                  <button
                    type="button"
                    className="chip"
                    onClick={() =>
                      void api.confirmSettlement(s.settlement_id).then(async () => {
                        setSettlements(await api.settlements());
                        setFlash("Settlement confirmé");
                      })
                    }
                  >
                    Confirmer RL
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {screen === "activity" && (
        <section className="screen activity-screen">
          <p className="eyebrow">Simulation Journal</p>
          <h1>Chronologie des moteurs</h1>
          <p className="lede">Chaque décision Risk → SOR → Trading → Liquidity → Settlement.</p>
          <ul className="timeline">
            {(activity?.timeline ?? []).map((line, i) => {
              const m = line.match(/^(\d{2}:\d{2}:\d{2})\s+(.*)$/);
              const time = m?.[1] ?? "";
              const text = m?.[2] ?? line;
              let tone = "neutral";
              if (/VALIDÉ|approuv|Exécut|mis à jour|créé|confirm/i.test(text)) tone = "success";
              else if (/Engine|Router|Treasury|Settlement|Liquidity|Risk|Trading|SOR|Kill/i.test(text))
                tone = "engine";
              else if (/Audit|journal/i.test(text)) tone = "audit";
              else if (/REJET|refus|insuffisant/i.test(text)) tone = "danger";
              return (
                <li key={`${i}-${line}`} className={`event visible tone-${tone}`} style={{ animationDelay: `${Math.min(i, 12) * 40}ms` }}>
                  <time>{time}</time>
                  <span>{text}</span>
                </li>
              );
            })}
          </ul>
          {activity && (
            <div className="ids">
              <span>session · {activity.session_correlation_id}</span>
            </div>
          )}
        </section>
      )}

      {screen === "education" && (
        <section className="screen portfolio-screen">
          <p className="eyebrow">Démocratisation</p>
          <h1>Comprendre avant de trader</h1>
          <p className="lede">Modules courts — vision AOTC hors MVP strict, activés en sandbox.</p>
          <ul className="edu-list">
            {education.map((mod) => (
              <li key={mod.id}>
                <button type="button" className="edu-item" onClick={() => setEduOpen(eduOpen === mod.id ? null : mod.id)}>
                  <strong>{mod.title}</strong>
                  <span>{mod.summary}</span>
                </button>
                {eduOpen === mod.id && (
                  <div className="edu-body fade-in">
                    {mod.body.map((p) => (
                      <p key={p}>{p}</p>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
          {!user && (
            <div className="cta-row">
              <button type="button" className="cta" onClick={() => setScreen("signup")}>
                Ouvrir un compte sandbox
              </button>
            </div>
          )}
        </section>
      )}

      {screen === "admin" && (
        <section className="screen admin-screen">
          <p className="eyebrow">NOC · supervision</p>
          <h1>Opérations & partenaires</h1>
          <p className="lede">Vue temps réel des moteurs + stats SGI (sandbox).</p>
          {ops && (
            <div className="ops-grid">
              <div>
                <p className="stat-label">Ordres (session)</p>
                <p className="stat-value">{ops.orders_per_min}</p>
              </div>
              <div>
                <p className="stat-label">Rejets Risk</p>
                <p className="stat-value">{ops.failures.rejected_orders}</p>
              </div>
              <div>
                <p className="stat-label">RL en attente</p>
                <p className="stat-value">{ops.pending.settlements}</p>
              </div>
              <div>
                <p className="stat-label">Alertes</p>
                <p className="stat-value">{ops.risk_alerts_open}</p>
              </div>
            </div>
          )}
          {ops && (
            <>
              <h2>Santé des moteurs</h2>
              <ul className="health-list">
                {Object.entries(ops.engines_health).map(([name, status]) => (
                  <li key={name}>
                    <strong>{name}</strong>
                    <span className={`pill ${status}`}>{status}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {partner && (
            <>
              <h2>Partner · {partner.sgi_id}</h2>
              <ul className="data-list">
                <li>
                  <strong>Volume apporté</strong>
                  <span>{xof(partner.volume_brought)} XOF</span>
                </li>
                <li>
                  <strong>Commissions</strong>
                  <span>{xof(partner.commissions)} XOF</span>
                </li>
                <li>
                  <strong>CA généré</strong>
                  <span>{xof(partner.revenue_generated)} XOF</span>
                </li>
                <li>
                  <strong>Fill rate</strong>
                  <span>{(partner.performance.fill_rate * 100).toFixed(0)} %</span>
                </li>
              </ul>
            </>
          )}
          <div className="cta-row">
            <button
              type="button"
              className="cta-ghost danger"
              onClick={() =>
                void api.killSwitch("SNTS").then(async () => {
                  setFlash("Kill-switch : SNTS suspendu");
                  setOps(await api.ops());
                  await refreshMarket();
                })
              }
            >
              Suspendre SNTS
            </button>
            <button
              type="button"
              className="cta-ghost danger"
              onClick={() =>
                void api.killSwitch().then(async () => {
                  setFlash("Kill-switch marché entier");
                  setOps(await api.ops());
                  await refreshMarket();
                })
              }
            >
              Halt marché
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
