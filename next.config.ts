import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The VPS shares its HTTPS IP address with other apps. Keep VAG Oil under
  // its own path so it cannot take over the existing root site.
  basePath: "/vag-oil",
};

export default nextConfig;
