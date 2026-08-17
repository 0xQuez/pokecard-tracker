"use client";

import { useState } from "react";

type Profile = "quez" | "stevie" | "guest";

type Props = {
  onAuth: (profile: Profile, password: string) => void;
};

export default function ProfileGate({ onAuth }: Props) {
  const [selectedProfile, setSelectedProfile] = useState<Profile>("quez");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const isGuest = selectedProfile === "guest";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isGuest) {
      setError("");
      onAuth("guest", "");
      return;
    }
    if (password === process.env.NEXT_PUBLIC_APP_PASSWORD) {
      setError("");
      onAuth(selectedProfile, password);
    } else {
      setError("Wrong password.");
    }
  };

  return (
    <div className="profile-gate">
      <div className="card">
        <div className="logo" style={{ justifyContent: "center", marginBottom: 8 }}>
          <div className="logo-mark">½</div>
          <div className="logo-name">PokeCard Tracker</div>
        </div>
        <h1>Welcome back</h1>
        <p className="subtitle">Who's tracking today?</p>

        <form onSubmit={handleSubmit}>
          <div className="profile-options">
            <div className="profile-option">
              <input
                type="radio"
                id="profile-quez"
                name="profile"
                value="quez"
                checked={selectedProfile === "quez"}
                onChange={() => setSelectedProfile("quez")}
              />
              <label htmlFor="profile-quez">
                <div className="avatar u1">Q</div>
                <div className="name">Quez</div>
              </label>
            </div>
            <div className="profile-option">
              <input
                type="radio"
                id="profile-stevie"
                name="profile"
                value="stevie"
                checked={selectedProfile === "stevie"}
                onChange={() => setSelectedProfile("stevie")}
              />
              <label htmlFor="profile-stevie">
                <div className="avatar u2">S</div>
                <div className="name">Stevie</div>
              </label>
            </div>
            <div className="profile-option guest">
              <input
                type="radio"
                id="profile-guest"
                name="profile"
                value="guest"
                checked={selectedProfile === "guest"}
                onChange={() => setSelectedProfile("guest")}
              />
              <label htmlFor="profile-guest">
                <div className="avatar guest">▶</div>
                <div className="name">Guest</div>
                <div className="role">Try the hunt tool, no sign-in</div>
              </label>
            </div>
          </div>

          {!isGuest && (
            <div className="password-field">
              <label htmlFor="password">Shared password</label>
              <input
                id="password"
                type="password"
                placeholder="Enter password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
                required
              />
            </div>
          )}

          {error && (
            <div style={{ color: "var(--clay)", fontSize: "13px", marginBottom: "12px", textAlign: "center" }}>
              {error}
            </div>
          )}

          <button type="submit" className="cta">
            {isGuest ? "Explore" : "Unlock"}
          </button>
        </form>
      </div>
    </div>
  );
}
