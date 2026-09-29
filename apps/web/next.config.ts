import type { NextConfig } from 'next';

const config: NextConfig = {
  /*
   * `highs` is the optimizer's solver, compiled to WebAssembly. Bundling it
   * breaks the path it uses to find its own .wasm file, so it is loaded with
   * Node's require at runtime instead. The pincode dataset is ~3 MB of JSON
   * that only the server reads; keeping it external keeps dev compiles fast.
   */
  serverExternalPackages: ['highs', 'india-pincode-search'],
};

export default config;
