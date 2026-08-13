// Unit tests for src/lib/card-image-upload.ts (pure, offline). Runs under:
//   - node --test src/lib/card-image-upload.test.ts  (Node 22+ type stripping)
//   - npm test                                       (node --test + vitest)
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCardImagePath,
  imageContentType,
  imageExtension,
  mapStorageError,
  publicCardImageUrl,
  uploadCardImage,
  MAX_CARD_IMAGE_BYTES,
  CARD_IMAGE_BUCKET,
  CardImageUploadError,
  type CardImageUploadClient,
  type CardImageUploadResult,
} from "./card-image-upload.ts";

// ── imageExtension ───────────────────────────────────────────────────────────

test("imageExtension: extracts a lowercased safe extension", () => {
  assert.equal(imageExtension("IMG_123.JPG"), "jpg");
  assert.equal(imageExtension("photo.png"), "png");
  assert.equal(imageExtension("scan.webp"), "webp");
});

test("imageExtension: rejects empty / missing / unsafe names", () => {
  assert.equal(imageExtension(""), null);
  assert.equal(imageExtension("scan"), null);
  assert.equal(imageExtension("a.b/c"), null);
  assert.equal(imageExtension("file."), null);
});

// ── imageContentType ─────────────────────────────────────────────────────────

test("imageContentType: prefers the blob's own type", () => {
  const file = new File(["x"], "a.jpg", { type: "image/webp" });
  assert.equal(imageContentType(file), "image/webp");
});

test("imageContentType: falls back to the filename extension mapping", () => {
  const blob = new Blob(["x"]); // no type
  assert.equal(imageContentType(blob, "photo.png"), "image/png");
  assert.equal(imageContentType(blob, "scan.jpg"), "image/jpeg");
});

test("imageContentType: defaults to image/jpeg when nothing is known", () => {
  const blob = new Blob(["x"]);
  assert.equal(imageContentType(blob), "image/jpeg");
  assert.equal(imageContentType(blob, "odd.bin"), "image/jpeg");
});

// ── buildCardImagePath ───────────────────────────────────────────────────────

test("buildCardImagePath: scans/ prefix with uuid filename when anon", () => {
  const p = buildCardImagePath({});
  assert.match(p, /^scans\/[0-9a-f-]{36}\.jpg$/);
});

test("buildCardImagePath: user-scoped path when a userId is given", () => {
  const p = buildCardImagePath({ userId: "user-123" });
  assert.match(p, /^users\/user-123\/[0-9a-f-]{36}\.jpg$/);
});

test("buildCardImagePath: honours a safe extension and is unique", () => {
  const p1 = buildCardImagePath({ ext: "png" });
  const p2 = buildCardImagePath({ ext: "png" });
  assert.match(p1, /\.png$/);
  assert.notEqual(p1, p2);
});

test("buildCardImagePath: falls back to jpg for unsafe extensions", () => {
  const p = buildCardImagePath({ ext: "pNg" });
  assert.match(p, /\.jpg$/);
});

// ── publicCardImageUrl ───────────────────────────────────────────────────────

test("publicCardImageUrl: builds a public bucket URL from a path", () => {
  const url = publicCardImageUrl("scans/abc.jpg");
  assert.match(url, /\/storage\/v1\/object\/public\/card-images\/scans\/abc\.jpg$/);
});

test("publicCardImageUrl: passes through absolute URLs and handles empty", () => {
  assert.equal(publicCardImageUrl("https://cdn/x.jpg"), "https://cdn/x.jpg");
  assert.equal(publicCardImageUrl(""), "");
});

// ── uploadCardImage: success ────────────────────────────────────────────────

function makeClient(opts: {
  error?: { message: string; statusCode?: string | number } | null;
  throwErr?: boolean;
  log?: Array<Record<string, any>>;
}): CardImageUploadClient {
  const { error = null, throwErr = false, log = [] } = opts;
  return {
    storage: {
      from(bucket: string) {
        log.push({ op: "from", bucket });
        return {
          upload(path: string, file: Blob, uploadOpts?: any) {
            log.push({ op: "upload", path, type: file.type, uploadOpts });
            if (throwErr) return Promise.reject(new Error("network down"));
            return Promise.resolve(
              error
                ? { data: null, error }
                : { data: { path }, error: null }
            );
          },
        };
      },
    },
  } as unknown as CardImageUploadClient;
}

test("uploadCardImage: uploads a small image to card-images and returns path+url", async () => {
  const log: Array<Record<string, any>> = [];
  const client = makeClient({ log });
  const file = new File(["tiny-jpeg-bytes"], "card.jpg", { type: "image/jpeg" });
  const res = await uploadCardImage(client, file);

  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.ok(log[0].op === "from" && log[0].bucket === CARD_IMAGE_BUCKET);
  assert.match(log[1].path, /^scans\/[0-9a-f-]{36}\.jpg$/);
  assert.equal(log[1].type, "image/jpeg");
  assert.equal(log[1].uploadOpts.contentType, "image/jpeg");
  assert.equal(log[1].uploadOpts.upsert, false);
  assert.ok(res.publicUrl.endsWith(`/card-images/${res.path}`));
});

test("uploadCardImage: uploads under a user-scoped path when userId is set", async () => {
  const log: Array<Record<string, any>> = [];
  const client = makeClient({ log });
  const blob = new Blob(["x"], { type: "image/png" });
  const res = await uploadCardImage(client, blob, { userId: "u-1", fileName: "photo.png" });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.match(log[1].path, /^users\/u-1\/[0-9a-f-]{36}\.png$/);
  assert.equal(log[1].type, "image/png");
});

// ── uploadCardImage: oversize ───────────────────────────────────────────────

test("uploadCardImage: rejects images over 10 MB with a typed oversize error", async () => {
  const log: Array<Record<string, any>> = [];
  const client = makeClient({ log });
  const big = new Blob([new Uint8Array(MAX_CARD_IMAGE_BYTES + 1)]);
  const res = await uploadCardImage(client, big);
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.equal(res.error.code, "oversize");
  assert.match(res.error.message, /10 MB/);
  // No network call should happen for oversize input.
  assert.equal(log.length, 0);
});

test("uploadCardImage: accepts a file exactly at the 10 MB boundary", async () => {
  const log: Array<Record<string, any>> = [];
  const client = makeClient({ log });
  const edge = new Blob([new Uint8Array(MAX_CARD_IMAGE_BYTES)]);
  const res = await uploadCardImage(client, edge);
  assert.equal(res.ok, true);
});

// ── uploadCardImage: errors ─────────────────────────────────────────────────

test("uploadCardImage: maps a storage error to a typed storage error", async () => {
  const client = makeClient({ error: { message: "something went wrong" } });
  const res = await uploadCardImage(client, new File(["x"], "a.jpg", { type: "image/jpeg" }));
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.equal(res.error.code, "storage");
  assert.equal(res.error.causeMessage, "something went wrong");
});

test("uploadCardImage: maps a policy/RLS rejection to a typed policy error", async () => {
  const client = makeClient({ error: { message: "new row violates row-level security policy", statusCode: "403" } });
  const res = await uploadCardImage(client, new File(["x"], "a.jpg", { type: "image/jpeg" }));
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.equal(res.error.code, "policy");
});

test("uploadCardImage: maps a network exception to a typed network error", async () => {
  const client = makeClient({ throwErr: true });
  const res = await uploadCardImage(client, new File(["x"], "a.jpg", { type: "image/jpeg" }));
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.equal(res.error.code, "network");
});

test("uploadCardImage: rejects invalid input without calling the client", async () => {
  const log: Array<Record<string, any>> = [];
  const client = makeClient({ log });
  const res = await uploadCardImage(client, null as unknown as Blob);
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.equal(res.error.code, "invalid-input");
  assert.equal(log.length, 0);
});

// ── mapStorageError ─────────────────────────────────────────────────────────

test("mapStorageError: classifies by status and message", () => {
  assert.equal(mapStorageError("nope", "400").code, "policy");
  assert.equal(mapStorageError("nope", "403").code, "policy");
  assert.equal(mapStorageError("row-level security policy", null).code, "policy");
  assert.equal(mapStorageError("bucket not found", null).code, "storage");
});

test("CardImageUploadError: is an Error with code + causeMessage", () => {
  const e = new CardImageUploadError("oversize", "too big", "cause");
  assert.ok(e instanceof Error);
  assert.equal(e.name, "CardImageUploadError");
  assert.equal(e.code, "oversize");
  assert.equal(e.causeMessage, "cause");
});
