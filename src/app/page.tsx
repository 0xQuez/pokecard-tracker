"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabaseClient";
import { getTimeGreeting, userCapitalize } from "@/lib/helpers";
import Home from "@/components/Home";
import Activity from "@/components/Activity";
import Add from "@/components/Add";
import Settle from "@/components/Settle";
import History from "@/components/History";
import HunterTool from "@/components/HunterTool";
import ProfileGate from "@/components/ProfileGate";
import EditModal from "@/components/EditModal";

type Screen = "home" | "activity" | "add" | "settle" | "history" | "hunter";
type Profile = "quez" | "stevie";

type Card = {
  id: number;
  created_at: string;
  card_name: string;
  card_id?: string;
  purchase_price: number;
  grading_fee: number;
  shipping_to_grader: number;
  shipping_from_grader: number;
  insurance: number;
  other_costs: number;
  notes?: string;
  paid_by: string;
  split_percent: number;
  date_acquired?: string;
  grade_received?: string;
  sale_price?: number;
  date_sold?: string;
  type?: "expense" | "profit" | "transfer";
  settled_at?: string;
  transfer_from?: string;
  transfer_to?: string;
  transfer_amount?: number;
};

export default function Page() {
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAuthed, setIsAuthed] = useState(false);
  const [currentProfile, setCurrentProfile] = useState<Profile>("quez");
  const [activeScreen, setActiveScreen] = useState<Screen>("home");
  const [toastMessage, setToastMessage] = useState("");
  const [toastVisible, setToastVisible] = useState(false);
  const [editingCard, setEditingCard] = useState<Card | null>(null);

  // Only show active (unsettled) cards
  const activeCards = cards.filter((c) => !c.settled_at);

  const fetchCards = useCallback(async () => {
    const { data, error } = await supabase
      .from("cards")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      console.error("fetch error:", error.message);
      return;
    }
    setCards(data || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    const authed = sessionStorage.getItem("pokecards_auth");
    const profile = sessionStorage.getItem("pokecards_profile") as Profile | null;
    if (authed && profile) {
      setIsAuthed(true);
      setCurrentProfile(profile);
    }
  }, []);

  useEffect(() => {
    if (!isAuthed) return;
    fetchCards();
  }, [isAuthed, fetchCards]);

  const handleAuth = (profile: Profile, password: string) => {
    if (password === process.env.NEXT_PUBLIC_APP_PASSWORD) {
      setIsAuthed(true);
      setCurrentProfile(profile);
      sessionStorage.setItem("pokecards_auth", "true");
      sessionStorage.setItem("pokecards_profile", profile);
    } else {
      alert("Wrong password.");
    }
  };

  const handleLogout = () => {
    setIsAuthed(false);
    setCurrentProfile("quez");
    sessionStorage.removeItem("pokecards_auth");
    sessionStorage.removeItem("pokecards_profile");
  };

  const handleAddCard = () => {
    fetchCards();
    showToast("✓ Added — split 50/50");
    goToScreen("home");
  };

  const handleEditCard = (card: Card) => {
    setEditingCard(card);
  };

  const handleEditSave = () => {
    fetchCards();
    setEditingCard(null);
    showToast("✓ Changes saved");
  };

  const handleEditClose = () => {
    setEditingCard(null);
  };

  const handleEditDelete = () => {
    fetchCards();
    setEditingCard(null);
    showToast("✓ Entry deleted");
  };

  const handleSettle = () => {
    showToast("✓ Settled — starting fresh");
  };

  const handleRefresh = () => {
    fetchCards();
  };

  const showToast = (message: string) => {
    setToastMessage(message);
    setToastVisible(true);
    setTimeout(() => setToastVisible(false), 2400);
  };

  const goToScreen = (screen: Screen) => {
    setActiveScreen(screen);
    window.scrollTo({ top: 0 });
  };

  if (!isAuthed) return <ProfileGate onAuth={handleAuth} />;

  const otherUser = currentProfile === "quez" ? "stevie" : "quez";
  const currentUserCapitalized = userCapitalize(currentProfile);
  const otherUserCapitalized = userCapitalize(otherUser);

  const settledCyclesCount = (() => {
    const settledCards = cards.filter((c) => c.settled_at);
    const cycles = new Set<string>();
    for (const c of settledCards) {
      if (!c.settled_at) continue;
      const date = new Date(c.settled_at);
      const dayKey = date.toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      });
      cycles.add(dayKey);
    }
    return cycles.size;
  })();

  return (
    <div className="app">
      {/* Sidebar (desktop) */}
      <aside className="sidebar">
        <div className="logo">
          <div className="logo-mark">½</div>
          <div className="logo-name">PokeCard Tracker</div>
        </div>
        <button
          className={`nav-item ${activeScreen === "home" ? "active" : ""}`}
          onClick={() => goToScreen("home")}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 10.5 12 3l9 7.5" />
            <path d="M5 9.5V21h14V9.5" />
          </svg>
          Home
        </button>
        <button
          className={`nav-item ${activeScreen === "activity" ? "active" : ""}`}
          onClick={() => goToScreen("activity")}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 12h4l3-8 4 16 3-8h4" />
          </svg>
          Activity
        </button>
        <button
          className={`nav-item ${activeScreen === "add" ? "active" : ""}`}
          onClick={() => goToScreen("add")}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Add entry
        </button>
        <button
          className={`nav-item ${activeScreen === "settle" ? "active" : ""}`}
          onClick={() => goToScreen("settle")}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 16l-4-4 4-4" />
            <path d="M3 12h13" />
            <path d="M17 8l4 4-4 4" />
          </svg>
          Settle up
        </button>
        <button
          className={`nav-item ${activeScreen === "history" ? "active" : ""}`}
          onClick={() => goToScreen("history")}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 8v4l3 3" />
            <circle cx="12" cy="12" r="10" />
          </svg>
          History
        </button>
        <button
          className={`nav-item ${activeScreen === "hunter" ? "active" : ""}`}
          onClick={() => goToScreen("hunter")}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2a10 10 0 0 1 10 10 10 10 0 0 1-10 10 10 10 0 0 1-10-10 10 10 0 0 1 10-10z" />
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2v4" />
            <path d="M12 18v4" />
            <path d="M2 12h4" />
            <path d="M18 12h4" />
          </svg>
          Hunter
        </button>
        <div className="sidebar-foot">
          <p>
            <strong>{currentUserCapitalized} &amp; {otherUserCapitalized}</strong>
            <br />
            Paired since June 2026.
            <br />
            Everything split down the middle.
          </p>
        </div>
      </aside>

      {/* Main column */}
      <main className="main">
        {/* Home screen */}
        <section className={`screen ${activeScreen === "home" ? "active" : ""}`} id="screen-home">
          <div className="topbar">
            <div className="hello">
              {getTimeGreeting()}<b>{currentUserCapitalized} &amp; {otherUserCapitalized}</b>
            </div>
            <div className="pair">
              <div className="avatar u1">{currentUserCapitalized[0]}</div>
              <div className="avatar u2">{otherUserCapitalized[0]}</div>
            </div>
          </div>
          {!loading ? (
            <Home cards={activeCards} currentUser={currentProfile} onEdit={handleEditCard} />
          ) : (
            <div className="page" style={{ textAlign: "center", paddingTop: 100 }}>
              <p className="text-gray-500">Loading...</p>
            </div>
          )}
        </section>

        {/* Activity screen */}
        <section className={`screen ${activeScreen === "activity" ? "active" : ""}`} id="screen-activity">
          <div className="topbar">
            <div className="hello">All activity<b>{new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })}</b></div>
            <div className="pair">
              <div className="avatar u1">{currentUserCapitalized[0]}</div>
              <div className="avatar u2">{otherUserCapitalized[0]}</div>
            </div>
          </div>
          {!loading ? (
            <Activity cards={activeCards} currentUser={currentProfile} onEdit={handleEditCard} />
          ) : (
            <div className="page page-narrow" style={{ textAlign: "center", paddingTop: 100 }}>
              <p className="text-gray-500">Loading...</p>
            </div>
          )}
        </section>

        {/* Add screen */}
        <section className={`screen ${activeScreen === "add" ? "active" : ""}`} id="screen-add">
          <div className="topbar">
            <div className="hello">New entry<b>Split it down the middle</b></div>
            <div className="pair">
              <div className="avatar u1">{currentUserCapitalized[0]}</div>
              <div className="avatar u2">{otherUserCapitalized[0]}</div>
            </div>
          </div>
          <Add onAdd={handleAddCard} currentUser={currentProfile} />
        </section>

        {/* Settle screen */}
        <section className={`screen ${activeScreen === "settle" ? "active" : ""}`} id="screen-settle">
          <div className="topbar">
            <div className="hello">Settle up<b>{new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })}</b></div>
            <div className="pair">
              <div className="avatar u1">{currentUserCapitalized[0]}</div>
              <div className="avatar u2">{otherUserCapitalized[0]}</div>
            </div>
          </div>
          {!loading ? (
            <Settle
              cards={cards}
              currentUser={currentProfile}
              onSettle={handleSettle}
              onRefresh={handleRefresh}
            />
          ) : (
            <div className="page page-narrow" style={{ textAlign: "center", paddingTop: 100 }}>
              <p className="text-gray-500">Loading...</p>
            </div>
          )}
        </section>

        {/* History screen */}
        <section className={`screen ${activeScreen === "history" ? "active" : ""}`} id="screen-history">
          <div className="topbar">
            <div className="hello">
              Settlement history<b>{settledCyclesCount} cycles</b>
            </div>
            <div className="pair">
              <div className="avatar u1">{currentUserCapitalized[0]}</div>
              <div className="avatar u2">{otherUserCapitalized[0]}</div>
            </div>
          </div>
          {!loading ? (
            <History cards={cards} currentUser={currentProfile} />
          ) : (
            <div className="page page-narrow" style={{ textAlign: "center", paddingTop: 100 }}>
              <p className="text-gray-500">Loading...</p>
            </div>
          )}
        </section>

        {/* Hunter tool screen */}
        <section className={`screen ${activeScreen === "hunter" ? "active" : ""}`} id="screen-hunter">
          {!loading ? (
            <HunterTool />
          ) : (
            <div className="page page-narrow" style={{ textAlign: "center", paddingTop: 100 }}>
              <p className="text-gray-500">Loading...</p>
            </div>
          )}
        </section>
      </main>

      {/* Mobile tab bar */}
      <nav className="tabbar">
        <button
          className={`tab ${activeScreen === "home" ? "active" : ""}`}
          onClick={() => goToScreen("home")}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 10.5 12 3l9 7.5" />
            <path d="M5 9.5V21h14V9.5" />
          </svg>
          Home
        </button>
        <button
          className={`tab ${activeScreen === "activity" ? "active" : ""}`}
          onClick={() => goToScreen("activity")}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 12h4l3-8 4 16 3-8h4" />
          </svg>
          Activity
        </button>
        <button
          className="tab-add"
          onClick={() => goToScreen("add")}
          aria-label="Add entry"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
        <button
          className={`tab ${activeScreen === "settle" ? "active" : ""}`}
          onClick={() => goToScreen("settle")}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 16l-4-4 4-4" />
            <path d="M3 12h13" />
            <path d="M17 8l4 4-4 4" />
          </svg>
          Settle
        </button>
        <button
          className={`tab ${activeScreen === "history" ? "active" : ""}`}
          onClick={() => goToScreen("history")}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 8v4l3 3" />
            <circle cx="12" cy="12" r="10" />
          </svg>
          History
        </button>
        <button
          className={`tab ${activeScreen === "hunter" ? "active" : ""}`}
          onClick={() => goToScreen("hunter")}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2a10 10 0 0 1 10 10 10 10 0 0 1-10 10 10 10 0 0 1-10-10 10 10 0 0 1 10-10z" />
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2v4" />
            <path d="M12 18v4" />
            <path d="M2 12h4" />
            <path d="M18 12h4" />
          </svg>
          Hunter
        </button>
      </nav>

      {/* Toast */}
      <div className={`settled-toast ${toastVisible ? "show" : ""}`} id="toast">
        {toastMessage}
      </div>

      {/* Edit Modal */}
      {editingCard && (
        <EditModal
          card={editingCard}
          currentUser={currentProfile}
          onClose={handleEditClose}
          onSave={handleEditSave}
          onDelete={handleEditDelete}
        />
      )}
    </div>
  );
}