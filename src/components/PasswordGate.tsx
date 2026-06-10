"use client";

import { useState } from "react";

type Props = { onAuth: (pw: string) => void };

export default function PasswordGate({ onAuth }: Props) {
  const [pw, setPw] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    onAuth(pw);
  };

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <form
        onSubmit={submit}
        className="bg-white border rounded-xl shadow-sm p-6 w-full max-w-sm"
      >
        <h2 className="text-xl font-semibold mb-1">PokeCard Tracker</h2>
        <p className="text-sm text-gray-500 mb-4">
          Enter the shared password to continue.
        </p>
        <input
          type="password"
          className="w-full border rounded-lg px-3 py-2 text-sm mb-3"
          placeholder="Password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          autoFocus
        />
        <button
          type="submit"
          className="w-full bg-blue-600 text-white rounded-lg py-2 font-medium hover:bg-blue-700"
        >
          Unlock
        </button>
      </form>
    </main>
  );
}
