import assert from "node:assert/strict";
import { test } from "node:test";

import { bumpVersion } from "../scripts/bump-version.mjs";

test("bumpVersion increments each segment correctly", () => {
  assert.equal(bumpVersion("0.5.0", "patch"), "0.5.1");
  assert.equal(bumpVersion("0.5.1", "minor"), "0.6.0");
  assert.equal(bumpVersion("0.6.0", "major"), "1.0.0");
});

test("bumpVersion rejects bad input", () => {
  assert.throws(() => bumpVersion("1.2", "patch"), /semver/i);
  assert.throws(() => bumpVersion("1.2.3", "huge"), /bump kind/i);
});
