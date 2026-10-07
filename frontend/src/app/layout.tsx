import "./globals.css";
import type { Metadata, Viewport } from "next";
import ServiceWorkerRegistrar from "./ServiceWorkerRegistrar";

export const metadata: Metadata = {
  title: "PassPulse — Turnstile Entry System",
  description:
    "Cryptographically verified, single-use QR check-in engine for events and hackathons.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "PassPulse",
  },
  icons: {
    icon: "/icons/icon-192.png",
    apple: "/icons/icon-192.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#007AFF",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        {children}
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}