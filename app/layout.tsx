import "./globals.css";

export const metadata = { title: "Second Brain", description: "Say it once. It files itself, connects it, and brings it back when it matters." };

export default function Root({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,600&family=Geist:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
        <meta name="theme-color" content="#0E8C7E" />
        {/* Theme on <html> before first paint (login included): saved choice, else dark. */}
        <script dangerouslySetInnerHTML={{ __html: `try{var t=localStorage.getItem("theme");document.documentElement.dataset.theme=(t==="light"||t==="dark")?t:"dark"}catch(e){document.documentElement.dataset.theme="dark"}` }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
