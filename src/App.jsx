import { useEffect, useState, useCallback } from "react";

// Local-time helpers (so "today" is correct for Bangladesh, not UTC)
const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const todayStr = () => iso(new Date());
const monthOf = (s) => s.slice(0, 7);
const shiftMonth = (m, n) => {
  const [y, mm] = m.split("-").map(Number);
  return iso(new Date(y, mm - 1 + n, 1)).slice(0, 7);
};
const monthLabel = (m) => {
  const [y, mm] = m.split("-").map(Number);
  return new Date(y, mm - 1, 1).toLocaleString("en", { month: "long", year: "numeric" });
};
const taka = (n) => "৳" + Math.round(n || 0).toLocaleString("en-IN");

const API = (import.meta.env.VITE_API_URL || "").replace(/\/+$/, "");

const TOKEN_KEY = "mt_token";
let onUnauthorized = () => {};
const authHeader = () => {
  const t = localStorage.getItem(TOKEN_KEY);
  return t ? { Authorization: `Bearer ${t}` } : {};
};

async function api(path, opts = {}) {
  const r = await fetch(API + "/api" + path, {
    headers: { "Content-Type": "application/json", ...authHeader() },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (r.status === 401) { localStorage.removeItem(TOKEN_KEY); onUnauthorized(); throw new Error("Unauthorized"); }
  if (!r.ok) throw new Error((await r.text()) || r.statusText);
  return r.json();
}

function Login({ onDone }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setMsg("");
    try {
      const r = await fetch(API + "/api/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail || "Login failed");
      localStorage.setItem(TOKEN_KEY, j.token);
      onDone();
    } catch (e2) { setMsg(e2.message === "Failed to fetch" ? "Cannot reach the server." : e2.message); }
    setBusy(false);
  };
  return (
    <div className="app login">
      <h1>Money Tracker</h1>
      <p className="muted">Private. Please sign in.</p>
      {msg && <div className="error">{msg}</div>}
      <form onSubmit={submit} className="form">
        <input type="email" placeholder="Email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input type="password" placeholder="Password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        <button className="primary" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
    </div>
  );
}

export default function Root() {
  const [authed, setAuthed] = useState(!!localStorage.getItem(TOKEN_KEY));
  useEffect(() => { onUnauthorized = () => setAuthed(false); }, []);
  const logout = () => { localStorage.removeItem(TOKEN_KEY); setAuthed(false); };
  return authed ? <App onLogout={logout} /> : <Login onDone={() => setAuthed(true)} />;
}

function App({ onLogout }) {
  const [today, setToday] = useState(todayStr());
  const [month, setMonth] = useState(monthOf(todayStr()));
  const [sum, setSum] = useState(null);
  const [txs, setTxs] = useState([]);
  const [loans, setLoans] = useState([]);
  const [err, setErr] = useState("");

  const [tx, setTx] = useState({ type: "expense", amount: "", category: "", note: "", date: todayStr() });
  const [loan, setLoan] = useState({ person: "", direction: "taken", amount: "", due_date: "", note: "" });

  const load = useCallback(async () => {
    try {
      const [s, t, l] = await Promise.all([
        api(`/summary?month=${month}`), api(`/transactions?month=${month}`), api("/loans"),
      ]);
      setSum(s); setTxs(t); setLoans(l); setErr("");
    } catch (e) {
      if (e.message !== "Unauthorized") setErr("Cannot reach the server. Is the backend running on port 8000?");
    }
  }, [month]);

  useEffect(() => { load(); }, [load]);

  // Date + month roll over automatically when midnight passes
  useEffect(() => {
    const id = setInterval(() => {
      const now = todayStr();
      if (now !== today) {
        if (monthOf(today) === month) setMonth(monthOf(now)); // was viewing current month -> follow
        setTx((t) => (t.date === today ? { ...t, date: now } : t));
        setToday(now);
        load();
      }
    }, 30000);
    return () => clearInterval(id);
  }, [today, month, load]);

  const addTx = async (e) => {
    e.preventDefault();
    if (!+tx.amount) return;
    await api("/transactions", { method: "POST", body: { ...tx, amount: +tx.amount, date: tx.date || today } });
    setTx({ ...tx, amount: "", note: "" });
    load();
  };
  const addLoan = async (e) => {
    e.preventDefault();
    if (!loan.person || !+loan.amount) return;
    await api("/loans", { method: "POST", body: { ...loan, amount: +loan.amount, due_date: loan.due_date || null } });
    setLoan({ person: "", direction: "taken", amount: "", due_date: "", note: "" });
    load();
  };
  const payLoan = async (l) => {
    const v = prompt(`Payment for ${l.person} (outstanding ${taka(l.outstanding)})`);
    if (v && +v > 0) { await api(`/loans/${l.id}/payments`, { method: "POST", body: { amount: +v, date: today } }); load(); }
  };
  const del = async (path) => { if (confirm("Delete this entry?")) { await api(path, { method: "DELETE" }); load(); } };

  const downloadCsv = async () => {
    const r = await fetch(`${API}/api/export?month=${month}`, { headers: authHeader() });
    if (r.status === 401) { localStorage.removeItem(TOKEN_KEY); onUnauthorized(); return; }
    if (!r.ok) return setErr("Export failed");
    const url = URL.createObjectURL(await r.blob());
    const a = document.createElement("a");
    a.href = url; a.download = `transactions-${month}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const f = sum?.fund;
  const isCurrent = month === monthOf(today);

  return (
    <div className="app">
      <header>
        <div>
          <h1>Money Tracker</h1>
          <p className="muted">{new Date(today + "T00:00").toLocaleDateString("en", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
        </div>
        <div className="monthnav">
          <button onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month">‹</button>
          <strong>{monthLabel(month)}</strong>
          <button onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Next month">›</button>
          {!isCurrent && <button className="link" onClick={() => setMonth(monthOf(today))}>This month</button>}
          <button className="link" onClick={onLogout}>Log out</button>
        </div>
      </header>

      {err && <div className="error">{err}</div>}

      {sum && (
        <>
          <section className="need">
            <div>
              <span className="muted">Needed today</span>
              <div className="big">{taka(f.daily_need_today)}</div>
              <span className="muted">avg spend {taka(f.avg_daily_expense)}/day{f.loan_due_today > 0 && ` + loan due ${taka(f.loan_due_today)}`}</span>
            </div>
            <div>
              <span className="muted">Needed for rest of month ({f.days_left} days)</span>
              <div className="big">{taka(f.need_rest_of_month)}</div>
              <span className={f.shortfall > 0 ? "neg" : "pos"}>
                {f.shortfall > 0 ? `Short by ${taka(f.shortfall)}` : `Covered by your balance of ${taka(sum.cash_balance)}`}
              </span>
            </div>
          </section>

          <section className="stats">
            <Stat label="Income" value={taka(sum.income)} cls="pos" />
            <Stat label="Expense" value={taka(sum.expense)} cls="neg" />
            <Stat label="Net this month" value={taka(sum.net)} cls={sum.net >= 0 ? "pos" : "neg"} />
            <Stat label="Cash balance (all time)" value={taka(sum.cash_balance)} />
            <Stat label="I owe" value={taka(f.i_owe_total)} cls="neg" />
            <Stat label="Owed to me" value={taka(f.owed_to_me_total)} cls="pos" />
          </section>
        </>
      )}

      <div className="cols">
        <section>
          <h2>Add income or expense</h2>
          <form onSubmit={addTx} className="form">
            <div className="seg">
              {["expense", "income"].map((t) => (
                <button type="button" key={t} className={tx.type === t ? "on " + t : ""} onClick={() => setTx({ ...tx, type: t })}>
                  {t === "expense" ? "Expense" : "Income"}
                </button>
              ))}
            </div>
            <input type="number" step="any" min="0" placeholder="Amount (৳)" value={tx.amount} onChange={(e) => setTx({ ...tx, amount: e.target.value })} required />
            <input placeholder="Category (food, transport, salary…)" value={tx.category} onChange={(e) => setTx({ ...tx, category: e.target.value })} />
            <input placeholder="Note" value={tx.note} onChange={(e) => setTx({ ...tx, note: e.target.value })} />
            <input type="date" value={tx.date} onChange={(e) => setTx({ ...tx, date: e.target.value })} />
            <button className="primary">Save {tx.type}</button>
          </form>

          <div className="row">
            <h2>Transactions</h2>
            <button className="link" onClick={downloadCsv}>Download CSV</button>
          </div>
          {txs.length === 0 && <p className="muted">Nothing recorded for {monthLabel(month)} yet.</p>}
          <ul className="list">
            {txs.map((t) => (
              <li key={t.id}>
                <div>
                  <b>{t.category}</b> <span className="muted">{t.note}</span>
                  <div className="muted small">{t.date}</div>
                </div>
                <div className="right">
                  <span className={t.type === "income" ? "pos" : "neg"}>{t.type === "income" ? "+" : "−"}{taka(t.amount)}</span>
                  <button className="x" onClick={() => del(`/transactions/${t.id}`)} aria-label="Delete">×</button>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2>Loans</h2>
          <form onSubmit={addLoan} className="form">
            <div className="seg">
              <button type="button" className={loan.direction === "taken" ? "on expense" : ""} onClick={() => setLoan({ ...loan, direction: "taken" })}>I borrowed</button>
              <button type="button" className={loan.direction === "given" ? "on income" : ""} onClick={() => setLoan({ ...loan, direction: "given" })}>I lent</button>
            </div>
            <input placeholder="Person" value={loan.person} onChange={(e) => setLoan({ ...loan, person: e.target.value })} required />
            <input type="number" step="any" min="0" placeholder="Amount (৳)" value={loan.amount} onChange={(e) => setLoan({ ...loan, amount: e.target.value })} required />
            <label className="muted small">Due date (optional)
              <input type="date" value={loan.due_date} onChange={(e) => setLoan({ ...loan, due_date: e.target.value })} />
            </label>
            <input placeholder="Note" value={loan.note} onChange={(e) => setLoan({ ...loan, note: e.target.value })} />
            <button className="primary">Save loan</button>
          </form>

          {loans.length === 0 && <p className="muted">No loans yet.</p>}
          <ul className="list">
            {loans.map((l) => {
              const overdue = l.due_date && l.due_date < today && l.outstanding > 0;
              return (
                <li key={l.id} className={l.outstanding <= 0 ? "done" : ""}>
                  <div>
                    <b>{l.person}</b> <span className="muted">{l.direction === "taken" ? "you owe" : "owes you"}</span>
                    <div className={"small " + (overdue ? "neg" : "muted")}>
                      {l.due_date ? `${overdue ? "Overdue · " : "Due "}${l.due_date}` : "No due date"} · total {taka(l.amount)}
                    </div>
                  </div>
                  <div className="right">
                    <span className={l.direction === "taken" ? "neg" : "pos"}>{l.outstanding <= 0 ? "Settled" : taka(l.outstanding)}</span>
                    {l.outstanding > 0 && <button className="mini" onClick={() => payLoan(l)}>Pay</button>}
                    <button className="x" onClick={() => del(`/loans/${l.id}`)} aria-label="Delete">×</button>
                  </div>
                </li>
              );
            })}
          </ul>

          {sum?.categories.length > 0 && (
            <>
              <h2>Where the money went</h2>
              <ul className="list">
                {sum.categories.map((c) => (
                  <li key={c.category}>
                    <div className="bar"><i style={{ width: `${(c.amount / sum.expense) * 100}%` }} /></div>
                    <div className="row"><span>{c.category}</span><span className="neg">{taka(c.amount)}</span></div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

const Stat = ({ label, value, cls = "" }) => (
  <div className="stat"><span className="muted">{label}</span><b className={cls}>{value}</b></div>
);