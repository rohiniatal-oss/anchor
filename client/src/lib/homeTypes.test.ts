import test from "node:test";
import assert from "node:assert/strict";

import {
  HOME_ROUTE_PATHS,
  pathForTab,
  routeBase,
  tabFromPath,
  type Tab,
} from "./homeTypes";

const EXPECTED_TABS: Tab[] = ["today", "strategy", "braindump", "jobs", "network", "learn", "wins", "profile"];

test("home route paths cover every shell tab exactly once", () => {
  assert.deepEqual(HOME_ROUTE_PATHS, ["/", "/strategy", "/braindump", "/jobs", "/network", "/learn", "/wins", "/profile"]);
  assert.equal(new Set(HOME_ROUTE_PATHS).size, HOME_ROUTE_PATHS.length);
});

test("pathForTab round-trips every supported tab through tabFromPath", () => {
  for (const tab of EXPECTED_TABS) {
    const path = pathForTab(tab);
    assert.equal(tabFromPath(path), tab);
  }
});

test("tabFromPath ignores query strings on deep-linked hash routes", () => {
  assert.equal(tabFromPath("/network?contactDraft=%7B%7D"), "network");
  assert.equal(tabFromPath("/learn?learnDraft=%7B%7D"), "learn");
  assert.equal(tabFromPath("/strategy?foo=bar"), "strategy");
  assert.equal(tabFromPath("/profile?from=jobs"), "profile");
});

test("routeBase strips query strings without losing the base route", () => {
  assert.equal(routeBase("/jobs?lane=ai"), "/jobs");
  assert.equal(routeBase("/?foo=bar"), "/");
  assert.equal(routeBase(""), "");
});
