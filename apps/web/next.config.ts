import type { NextConfig } from 'next';

const config: NextConfig = {
  /*
   * `highs` is the optimizer's solver, compiled to WebAssembly. Bundling it
   * breaks the path it uses to find its own .wasm file, so it is loaded with
   * Node's require at runtime instead. The pincode dataset is ~3 MB of JSON
   * that only the server reads; keeping it external keeps dev compiles fast.
   * `impit` (Blinkit's Chrome-fingerprint HTTP client) is a native module, and
   * Playwright is loaded only on hosts with a browser; both run from
   * node_modules for the searches this server makes itself (@gc/fetcher/inline).
   */
  serverExternalPackages: ['highs', 'india-pincode-search', 'impit', 'playwright', 'playwright-core'],
};

export default config;
