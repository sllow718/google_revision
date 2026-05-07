import type { NextConfig } from "next";

// On TP network the corporate SSL proxy intercepts HTTPS; disable cert checks
// so outbound fetch calls (e.g. to Apps Script) don't fail with cert errors.
// DISABLE_SSL_VERIFICATION must never be "true" in production / on Vercel.
if (process.env.DISABLE_SSL_VERIFICATION === "true") {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

const nextConfig: NextConfig = {
  serverExternalPackages: ["googleapis", "google-auth-library"],
};

export default nextConfig;
