import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Google Docs Revision Analyser",
  description: "Analyse revision history and contributions in Google Docs",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
