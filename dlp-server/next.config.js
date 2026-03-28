/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        // הגדרת כותרות CORS לכל נתיבי ה-API
        source: "/api/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin",  value: "*" },
          { key: "Access-Control-Allow-Methods", value: "GET, POST, OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "Content-Type" }
        ]
      }
    ];
  }
};

export default nextConfig;
