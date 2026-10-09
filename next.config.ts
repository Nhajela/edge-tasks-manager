import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    // one env var to fill in; exposed to the client for the "message @bot" hint
    NEXT_PUBLIC_TELEGRAM_BOT_USERNAME: process.env.TELEGRAM_BOT_USERNAME ?? "",
  },
};

export default nextConfig;
