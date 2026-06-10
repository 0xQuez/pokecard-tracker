import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PokeCard Tracker",
  description: "Shared Pokémon card cost tracker for Quez & Stevie",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}