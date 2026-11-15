/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // `next build` and `next dev` share .next by default, so building while the
  // dev server runs corrupts its chunks ("Cannot find module './897.js'").
  // Set NEXT_DIST_DIR to build into a separate folder instead.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // three.js ships untranspiled ESM in its examples folder.
  transpilePackages: ['three'],
};
export default nextConfig;
