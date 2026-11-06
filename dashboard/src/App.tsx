import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { hasSession, login, logout, onSessionChange, ApiError } from './lib/api';
import { AppProvider, useApp, useGet, useTheme } from './lib/hooks';
import type { Me } from './lib/types';
import { Icon, Logo, Wordmark, ErrorBox, Skel } from './components/ui';
import Overview from './pages/Overview';
import Money from './pages/Money';
import Health from './pages/Health';
import Worship from './pages/Worship';
import SleepWork from './pages/SleepWork';
import Habits from './pages/Habits';

const NAV = [
  { to: '/', label: 'نظرة عامة', short: 'نظرة عامة', icon: 'home' as const },
  { to: '/money', label: 'فلوسي', short: 'فلوسي', icon: 'wallet' as const },
  { to: '/health', label: 'صحتي', short: 'صحتي', icon: 'heart' as const },
  { to: '/worship', label: 'عباداتي', short: 'عباداتي', icon: 'moon' as const },
  { to: '/sleep-work', label: 'نومي وشغلي', short: 'نومي وشغلي', icon: 'clock' as const },
  { to: '/habits', label: 'عاداتي', short: 'عاداتي', icon: 'repeat' as const },
];

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try { await login(email.trim(), password); } catch (x) {
      const code = x instanceof ApiError ? x.code : '';
      setErr(code === 'INVALID_CREDENTIALS' ? 'الإيميل أو كلمة السر مش صح.' : code === 'RATE_LIMITED' ? 'محاولات كتير. استنى شوية وجرّب تاني.' : x instanceof ApiError ? 'تأكد من البيانات وجرّب تاني.' : 'مش قادرين نوصل للسيرفر. اتأكد من النت.');
    } finally { setBusy(false); }
  };
  return (
    <main className="login">
      <form className="card" onSubmit={submit}>
        <div className="brand"><Logo size={72} /><Wordmark /><p className="tag">يومك كله في مكان واحد</p></div>
        <label>الإيميل<input className="field" type="email" dir="ltr" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" /></label>
        <label>كلمة السر<input className="field" type="password" dir="ltr" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        {err && <p className="formerr" role="alert">{err}</p>}
        <button className="btn" disabled={busy}>{busy ? 'ثانية واحدة…' : 'دخول'}</button>
      </form>
    </main>
  );
}

function Shell() {
  const { hideMoney, toggleHide, me } = useApp();
  const [theme, toggleTheme] = useTheme();
  const loc = useLocation();
  const current = NAV.find((n) => (n.to === '/' ? loc.pathname === '/' : loc.pathname.startsWith(n.to))) ?? NAV[0];
  useEffect(() => { window.scrollTo(0, 0); }, [loc.pathname]);
  return (
    <div className="shell">
      <aside className="side">
        <div className="logo"><Logo size={38} /><Wordmark /></div>
        <nav className="nav" aria-label="التنقل">
          {NAV.map((n) => <NavLink key={n.to} to={n.to} end={n.to === '/'}><Icon name={n.icon} />{n.label}</NavLink>)}
        </nav>
        <div className="grow" />
        <div style={{ padding: '0 8px 8px', color: 'var(--ink-muted)', fontSize: 13 }}>{me.name}</div>
        <button className="btn ghost" onClick={logout} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}><Icon name="logout" size={18} />تسجيل الخروج</button>
      </aside>
      <div className="main">
        <header className="topbar">
          <span className="mlogo"><Logo size={32} /></span>
          <h1>{current.label}</h1>
          <button className="iconbtn" aria-pressed={hideMoney} aria-label={hideMoney ? 'إظهار المبالغ' : 'إخفاء المبالغ'} title={hideMoney ? 'إظهار المبالغ' : 'إخفاء المبالغ'} onClick={toggleHide}><Icon name={hideMoney ? 'eyeOff' : 'eye'} /></button>
          <button className="iconbtn" aria-label={theme === 'dark' ? 'الوضع الفاتح' : 'الوضع الداكن'} title={theme === 'dark' ? 'الوضع الفاتح' : 'الوضع الداكن'} onClick={toggleTheme}><Icon name={theme === 'dark' ? 'sun' : 'dark'} /></button>
          <button className="iconbtn mob-logout" aria-label="تسجيل الخروج" title="تسجيل الخروج" onClick={logout}><Icon name="logout" size={20} /></button>
        </header>
        <main className="content">
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/money" element={<Money />} />
            <Route path="/health" element={<Health />} />
            <Route path="/worship" element={<Worship />} />
            <Route path="/sleep-work" element={<SleepWork />} />
            <Route path="/habits" element={<Habits />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
      <nav className="bottomnav" aria-label="التنقل">
        {NAV.map((n) => <NavLink key={n.to} to={n.to} end={n.to === '/'}><Icon name={n.icon} size={22} /><span>{n.short}</span></NavLink>)}
      </nav>
    </div>
  );
}

function Authed() {
  const q = useGet<Me>('/me');
  if (q.error && !q.data) return <div className="login"><div className="card"><ErrorBox error={q.error} retry={q.reload} /></div></div>;
  if (!q.data) return <div className="login"><div className="card" style={{ width: 320 }}><Skel h={40} /><Skel h={16} style={{ marginTop: 12 }} /></div></div>;
  return <AppProvider me={q.data}><Shell /></AppProvider>;
}

export default function App() {
  const [authed, setAuthed] = useState(hasSession());
  useEffect(() => onSessionChange(() => setAuthed(hasSession())), []);
  useTheme();
  return authed ? <Authed /> : <Login />;
}
