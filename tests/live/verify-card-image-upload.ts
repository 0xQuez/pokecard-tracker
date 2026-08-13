// Live verification (T22.2 acceptance): upload a real image to the real
// `card-images` bucket via the new helper and confirm the returned public URL
// is fetchable. Requires NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY.
// Run: node --test scripts/live/verify-card-image-upload.ts
import test from "node:test";
import assert from "node:assert/strict";

import {
  uploadCardImageToBucket,
  uploadCardImage,
} from "../../src/lib/card-image-upload.ts";

function tinyPng(): ArrayBuffer {
  // 1x1 transparent PNG
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
    0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
    0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]).buffer as ArrayBuffer;
}

test("LIVE: uploadCardImageToBucket stores a real image and returns a fetchable URL", async () => {
  const file = new File([tinyPng()], "verify.png", { type: "image/png" });
  const res = await uploadCardImageToBucket(file, { fileName: "verify.png" });

  assert.equal(res.ok, true, `expected ok, got: ${JSON.stringify(res)}`);
  if (!res.ok) return;

  // The returned URL must be a real public object URL.
  assert.match(res.path, /^scans\//);
  assert.match(res.publicUrl, /\/storage\/v1\/object\/public\/card-images\//);

  // Fetch it back — must return the PNG bytes.
  const fetched = await fetch(res.publicUrl);
  assert.equal(fetched.status, 200, `publicUrl returned ${fetched.status}`);
  const buf = new Uint8Array(await fetched.arrayBuffer());
  assert.equal(buf[0], 0x89); // PNG signature
  assert.equal(buf[1], 0x50);
  console.log("  -> uploaded:", res.path);
  console.log("  -> publicUrl:", res.publicUrl);
});

test("LIVE: uploadCardImage with explicit userId uses a user-scoped path", async () => {
  const client = (await import("@supabase/supabase-js")).createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const file = new File([tinyPng()], "verify.png", { type: "image/png" });
  const res = await uploadCardImage(client, file, { userId: "live-verify-user" });
  assert.equal(res.ok, true, `expected ok, got: ${JSON.stringify(res)}`);
  if (!res.ok) return;
  assert.match(res.path, /^users\/live-verify-user\//);
  const fetched = await fetch(res.publicUrl);
  assert.equal(fetched.status, 200);
  console.log("  -> user-scoped path:", res.path);
});
