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
};

export default nextConfig;
