// Unit tests for src/lib/card-scan.ts (pure, offline). Runs under:
//   - node --test src/lib/card-scan.ts.test.ts   (Node 22+ native type stripping)
//   - npm test                                    (node --test + vitest)
import test from "node:test";
import assert from "node:assert/strict";

import {
  canvasToFile,
  scanImagePath,
  uploadCardScan,
  SCAN_FILENAME,
  SCAN_MIME_TYPE,
  type CardImageClient,
} from "./card-scan.ts";

// ── scanImagePath ────────────────────────────────────────────────────────────

test("scanImagePath: unique scan-prefixed path with a safe extension", () => {
  const p1 = scanImagePath({ name: "IMG_123.JPG" });
  const p2 = scanImagePath({ name: "photo.png" });
  assert.match(p1, /^scan-\d+-[a-z0-9]{6}\.jpg$/);
  assert.match(p2, /\.png$/);
  assert.ok(!p1.includes("IMG_123"));
  assert.notEqual(p1, p2);
});

test("scanImagePath: falls back to jpg when the name has no extension", () => {
  const p = scanImagePath({ name: "scan" });
  assert.match(p, /\.jpg$/);
});

// ── uploadCardScan ───────────────────────────────────────────────────────────

function makeClient(opts: {
  error?: { message: string } | null;
  log?: string[];
}): CardImageClient {
  const { error = null, log = [] } = opts;
  return {
    storage: {
      from(bucket: string) {
        log.push(`from:${bucket}`);
        return {
          upload(path: string) {
            log.push(`upload:${path}`);
            return Promise.resolve(
              error ? { data: null, error } : { data: { path }, error: null }
            );
          },
        };
      },
    },
  } as unknown as CardImageClient;
}

test("uploadCardScan: uploads to the card-images bucket and returns the public URL", async () => {
  const log: string[] = [];
  const client = makeClient({ log });
  const file = new File(["x"], "card.jpg", { type: "image/jpeg" });
  const res = await uploadCardScan(client, file);
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.ok(log.includes("from:card-images"));
  assert.ok(log.some((l) => l.startsWith("upload:scan-")));
  assert.equal(res.url.includes(res.path), true);
  assert.match(res.url, /\/storage\/v1\/object\/public\/card-images\//);
});

test("uploadCardScan: surfaces a storage error instead of throwing", async () => {
  const client = makeClient({ error: { message: "bucket not found" } });
  const file = new File(["x"], "card.jpg");
  const res = await uploadCardScan(client, file);
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.equal(res.error, "bucket not found");
});

// ── canvasToFile ─────────────────────────────────────────────────────────────

test("canvasToFile: encodes the canvas into a File with the expected name/type", async () => {
  const fakeCanvas = {
    toBlob(cb: (b: Blob | null) => void) {
      cb(new Blob(["img"], { type: "image/jpeg" }));
    },
  } as unknown as HTMLCanvasElement;
  const file = await canvasToFile(fakeCanvas);
  assert.ok(file);
  assert.equal(file!.name, SCAN_FILENAME);
  assert.equal(file!.type, SCAN_MIME_TYPE);
});

test("canvasToFile: returns null when the browser can't encode the frame", async () => {
  const fakeCanvas = {
    toBlob(cb: (b: Blob | null) => void) {
      cb(null);
    },
  } as unknown as HTMLCanvasElement;
  const file = await canvasToFile(fakeCanvas);
  assert.equal(file, null);
});
