import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // T23.2: @huggingface/transformers (and its native deps onnxruntime-node +
  // sharp) must NOT be webpack-bundled into the server bundle — they resolve
  // from node_modules at runtime. The embedding lookup (src/lib/hunter/
  // embedding-lookup.ts) dynamic-imports the package; serverExternalPackages
  // ensures the build leaves it external so the ONNX runtime / native binding
  // load correctly in the nodejs runtime.
  serverExternalPackages: [
    "@huggingface/transformers",
    "onnxruntime-node",
    "onnxruntime-web",
    "sharp",
  ],
  // T25.1: Ship the vendored quantized CLIP weights with the deployment. The
  // embedding lookup (src/lib/hunter/embedding-lookup.ts) loads them from
  // src/lib/hunter/models/ via transformers.js env.cacheDir; without this
  // trace include, Vercel would omit the 89MB ONNX file from the serverless
  // function bundle and the cold start would fall back to (or fail on) a
  // HuggingFace Hub download. outputFileTracingIncludes copies the whole
  // model dir into the function's filesystem, where process.cwd() resolves it.
  outputFileTracingIncludes: {
    "/api/hunter/identify": ["./src/lib/hunter/models/**/*"],
  },
};

export default nextConfig;
