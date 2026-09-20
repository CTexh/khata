import type { Metadata, Viewport } from "next";
import { Nunito } from "next/font/google";
import Script from "next/script";
import "./globals.css";

// Nunito has a variable font, which covers every weight in one file. Asking
// for four fixed weights downloaded four files - 137 KB before the app had
// drawn anything - and three of them were only discovered after the CSS had
// parsed, so the text visibly reflowed a second in.
const nunito = Nunito({
  variable: "--font-app",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Khata — Loan Ledger",
  description: "Track money people owe you — lend, receive, settle.",
  icons: {
    icon: [
      { url: "/favicon.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-256.png", sizes: "256x256", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
  manifest: "/manifest.json",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#eef1f9" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0b12" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${nunito.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <Script id="theme-init" strategy="beforeInteractive">
          {"try{var t=localStorage.getItem('khata-theme');if(t==='dark'||t==='light')document.documentElement.dataset.theme=t}catch(e){}"}
        </Script>
        {children}
      </body>
    </html>
  );
}
