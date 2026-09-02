import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A self-contained server bundle, so the container image needs Node and a
  // minimal node_modules rather than the whole repository.
  output: "standalone",
};

export default nextConfig;
