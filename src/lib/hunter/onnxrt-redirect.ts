/**
 * onnxrt-redirect.ts — T25.3
 *
 * Point onnxruntime-node at the vendored linux/x64 native binding that ships
 * with the deployment, via the ONNXRUNTIME_BINDING_PATH env var that our
 * patch-package patch (patches/onnxruntime-node+1.24.3.patch) makes binding.js
 * honor.
 *
 * WHY THIS EXISTS
 * ---------------
 * onnxruntime-node (a transitive dep of @huggingface/transformers) loads its
 * native binding with a DYNAMIC require — see dist/binding.js:
 *   require(`../bin/napi-v6/${process.platform}/${process.arch}/onnxruntime_binding.node`)
 * That template-literal path is invisible to Vercel's static file tracer, so the
 * native binary is omitted from the serverless bundle and cold start throws
 * "libonnxruntime.so.1: cannot open shared object file", forcing the identify
 * pipeline to fall back to text matching. We vendor the linux/x64 binding
 * (onnxruntime_binding.node + libonnxruntime.so.1) under
 * src/lib/hunter/models/onnxrt/linux-x64/, ship it via outputFileTracingIncludes,
 * and — when that file exists in the running function — set the env var so the
 * patched binding.js loads it instead of a missing node_modules binary.
 *
 * Runs as a MODULE-LEVEL side effect so it is not tree-shaken, and it does NOT
 * `require()` the .node itself (that would make Turbopack try to statically
 * resolve it and fail the build); it only sets an env var guarded by an fs check.
 * Local non-linux dev has no vendored binding, so the env var is left unset and
 * binding.js falls back to node_modules' own platform binary.
 */
import nodePath from "node:path";
import { existsSync } from "node:fs";

/** Repo-relative dir of the vendored linux/x64 binding (matches the model cache). */
const VENDORED_BINDING_DIR = "src/lib/hunter/models/onnxrt/linux-x64";
const BINDING_FILE = "onnxruntime_binding.node";

const bundledPath = nodePath.resolve(process.cwd(), VENDORED_BINDING_DIR, BINDING_FILE);
// Only on Linux (the deployment target) is the vendored linux/x64 binding usable.
// On local dev (macOS) the same repo file exists but is the wrong platform, so we
// must NOT point onnxruntime at it — node_modules' own darwin binding is correct.
if (process.platform === "linux" && existsSync(bundledPath)) {
  // The vendored linux/x64 binding is present in this function bundle — use it.
  process.env.ONNXRUNTIME_BINDING_PATH = bundledPath;
}
// Else: local dev / non-linux — leave the env var unset so binding.js falls back
// to node_modules' own platform binding.
