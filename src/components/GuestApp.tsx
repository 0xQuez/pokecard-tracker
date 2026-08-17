"use client";

import HunterTool from "@/components/HunterTool";

type Props = {
  onLogout: () => void;
};

const hunterIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2a10 10 0 0 1 10 10 10 10 0 0 1-10 10 10 10 0 0 1-10-10 10 10 0 0 1 10-10z" />
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v4" />
    <path d="M12 18v4" />
    <path d="M2 12h4" />
    <path d="M18 12h4" />
  </svg>
);

/**
 * Guest session shell. Renders ONLY the card-hunting surface — no Home, Add,
 * Activity, History, Settle, or WeeklyHunt — so a guest can never reach the
 * owners' financial data, even if a tab's render path is forced.
 */
export default function GuestApp({ onLogout }: Props) {
  return (
    <div className="app">
      {/* Sidebar (desktop) */}
      <aside className="sidebar">
        <div className="logo">
          <div className="logo-mark">½</div>
          <div className="logo-name">PokeCard Tracker</div>
        </div>
        <button className="nav-item active">{hunterIcon}Hunter</button>
        <div className="sidebar-foot">
          <p>
            <strong>Just looking</strong>
            <br />
            Search any card, see what it is worth, and whether it is worth grading.
          </p>
          <button className="cta ghost" onClick={onLogout} style={{ marginTop: 12 }}>
            Leave guest mode
          </button>
        </div>
      </aside>

      {/* Main column */}
      <main className="main">
        <section className="screen active" id="screen-hunter">
          <HunterTool guest />
        </section>
      </main>

      {/* Mobile tab bar */}
      <nav className="tabbar">
        <button className="tab active">{hunterIcon}Hunter</button>
      </nav>
    </div>
  );
}
