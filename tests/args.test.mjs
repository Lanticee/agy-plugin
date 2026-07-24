import assert from "node:assert/strict";
import { test } from "node:test";

import { parseArgs, splitRawArgumentString } from "../scripts/lib/args.mjs";

test("splitRawArgumentString keeps quoted model names together", () => {
  const tokens = splitRawArgumentString('--model "Gemini 3.1 Pro (Low)" --base main');
  assert.deepEqual(tokens, ["--model", "Gemini 3.1 Pro (Low)", "--base", "main"]);
});

test("splitRawArgumentString handles empty and null input", () => {
  assert.deepEqual(splitRawArgumentString(""), []);
  assert.deepEqual(splitRawArgumentString(null), []);
  assert.deepEqual(splitRawArgumentString(undefined), []);
});

test("parseArgs separates flags from focus text", () => {
  const parsed = parseArgs(["--base", "main", "--background", "look", "for", "race", "conditions"]);
  assert.equal(parsed.flags.base, "main");
  assert.equal(parsed.flags.background, true);
  assert.equal(parsed.text, "look for race conditions");
});

test("parseArgs takes value flags with spaces from tokenizer output", () => {
  const parsed = parseArgs(splitRawArgumentString('--model "Gemini 3.6 Flash (Medium)"'));
  assert.equal(parsed.flags.model, "Gemini 3.6 Flash (Medium)");
  assert.equal(parsed.text, "");
});

test("parseArgs throws on a value flag with no value", () => {
  assert.throws(() => parseArgs(["--base"]), /Missing value/);
});

test("parseArgs passes unknown flags through as text", () => {
  const parsed = parseArgs(["--frobnicate", "focus", "here"]);
  assert.equal(parsed.text, "--frobnicate focus here");
});
