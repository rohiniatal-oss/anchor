import { test } from "node:test";
import assert from "node:assert/strict";
import { extractFirstJsonObject } from "./llm";

test("extractFirstJsonObject pulls a bare object", () => {
  assert.equal(extractFirstJsonObject('{"a":1}'), '{"a":1}');
});

test("extractFirstJsonObject strips ```json fences", () => {
  const raw = '```json\n{"items":[1,2]}\n```';
  assert.equal(extractFirstJsonObject(raw), '{"items":[1,2]}');
  assert.deepEqual(JSON.parse(extractFirstJsonObject(raw)!), { items: [1, 2] });
});

test("extractFirstJsonObject ignores leading and trailing prose", () => {
  const raw = 'Sure, here is the plan:\n{"ok":true}\nLet me know if you need changes.';
  assert.equal(extractFirstJsonObject(raw), '{"ok":true}');
});

test("extractFirstJsonObject spans from first { to last } for nested objects", () => {
  const raw = 'noise {"a":{"b":2}} trailing }';
  // last "}" is the trailing one, but JSON.parse of the span still yields the object body
  const slice = extractFirstJsonObject(raw)!;
  assert.ok(slice.startsWith('{"a"'));
});

test("extractFirstJsonObject returns null when there is no object", () => {
  assert.equal(extractFirstJsonObject("no json here"), null);
  assert.equal(extractFirstJsonObject("}{"), null);
  assert.equal(extractFirstJsonObject(""), null);
});
