import type { Metadata } from "next";
import { Inter, Noto_Sans_Mono } from "next/font/google";
import "./globals.css";
import "generative-loaders/styles.css";

const inter = Inter({
  subsets: ["latin", "cyrillic"],
  variable: "--font-inter",
  display: "swap",
});

const notoSansMono = Noto_Sans_Mono({
  subsets: ["latin", "cyrillic"],
  variable: "--font-noto-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Pi Work",
  description: "Pi Coding Agent Web Interface",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${notoSansMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("pi-theme")||"light";document.documentElement.classList.add("theme-"+t)}catch(e){}})();`,
          }}
        />
      </head>
      <body style={{ height: "100dvh", display: "flex", flexDirection: "column" }}>
        {/* Drag region for the Electron shell's native window controls; zero
            height outside the shell (see globals.css). */}
        <div className="pi-shell-titlebar" aria-hidden />
        {children}
      </body>
    </html>
  );
}
