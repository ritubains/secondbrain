/** @type {import('next').NextConfig} */
// Security headers on every page: no framing (clickjacking), no MIME sniffing,
// origin-only referrers, and only this site may use the mic (voice notes).
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "microphone=(self), camera=(), geolocation=()" },
];
const nextConfig = {
  output: "standalone", // self-contained server bundle for the Docker image
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};
module.exports = nextConfig;
