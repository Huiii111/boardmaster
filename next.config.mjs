/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // `next build` and `next dev` share .next by default, so building while the
  // dev server runs corrupts its chunks ("Cannot find module './897.js'").
  // Set NEXT_DIST_DIR to build into a separate folder instead.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // three.js ships untranspiled ESM in its examples folder.
  transpilePackages: ['three'],
  /*
   * STATIC_EXPORT=1 builds the GitHub Pages demo.
   *
   * Pages serves static files only, so the route handlers cannot run there.
   * That is survivable precisely because the lab was built not to depend on
   * them: the circuit engine, the Arduino interpreter and the PCB checks are
   * all deterministic and local, and the tutor already has a visibly labelled
   * offline mode for exactly this case. The api/ folder is moved aside during
   * the export build, since `output: export` refuses to build route handlers.
   */
  ...(process.env.STATIC_EXPORT === '1'
    ? {
        output: 'export',
        basePath: '/boardmaster',
        assetPrefix: '/boardmaster',
        images: { unoptimized: true },
        // The normal `next build` and `tsc --noEmit` still typecheck everything.
        // This only stops the export tripping over generated route types left
        // behind in .next by the dev server for the api/ folder we moved aside.
        typescript: { ignoreBuildErrors: true },
      }
    : {}),
};
export default nextConfig;
