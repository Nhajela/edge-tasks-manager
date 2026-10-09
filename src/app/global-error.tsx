"use client";

import { useEffect } from "react";
import "./globals.css";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
          background: "#ffffff",
          color: "#141b34",
          padding: "24px",
        }}
      >
        <div style={{ maxWidth: 480 }}>
          <h1 style={{ fontSize: 32, lineHeight: 1.1, margin: "0 0 12px", letterSpacing: "-0.02em" }}>
            Something went properly sideways.
          </h1>
          <p style={{ fontSize: 16, lineHeight: 1.6, color: "#4e5469", margin: "0 0 20px" }}>
            The whole page fell over. We&rsquo;ve logged it. Try again, or come back in a minute.
          </p>
          {error.digest && (
            <p style={{ fontSize: 12, color: "#858b9e", margin: "0 0 20px" }}>Reference {error.digest}</p>
          )}
          <button
            onClick={() => reset()}
            style={{
              background: "#141b34",
              color: "#fff",
              border: 0,
              borderRadius: 999,
              padding: "12px 22px",
              fontSize: 15,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
