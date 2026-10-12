import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    // one env var to fill in; exposed to the client for the "message @bot" hint
    NEXT_PUBLIC_TELEGRAM_BOT_USERNAME: process.env.TELEGRAM_BOT_USERNAME ?? "",
  },
  async headers() {
    // /connect carries the pending sign-in and an Allow button: never framed (clickjacking), and its URL never sent to
    // other sites as a referrer. same-origin, not no-referrer: no-referrer makes the Allow post's Origin "null", which
    // the consent POST's same-site check then refuses.
    return [
      {
        source: "/connect",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "Referrer-Policy", value: "same-origin" },
        ],
      },
    ];
  },
  async rewrites() {
    // the app router doesn't route dot-directories, so the OAuth discovery documents (RFC 8414, RFC 9728) are rewritten
    // to API routes before the filesystem check; the /:path* forms are the path-suffixed lookups clients also try
    return {
      beforeFiles: [
        { source: "/.well-known/oauth-authorization-server", destination: "/api/oauth-metadata" },
        { source: "/.well-known/oauth-authorization-server/:path*", destination: "/api/oauth-metadata" },
        { source: "/.well-known/oauth-protected-resource", destination: "/api/oauth-resource-metadata" },
        { source: "/.well-known/oauth-protected-resource/:path*", destination: "/api/oauth-resource-metadata" },
      ],
    };
  },
};

export default nextConfig;
