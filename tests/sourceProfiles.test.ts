import test from "node:test";
import assert from "node:assert/strict";
import {
  BUILT_IN_SOURCE_PROFILES,
  getSourceProfile,
  listSourceProfiles,
} from "../src/core/index.js";
import type {
  SourceAuthorityHint,
  SourceDatePolicy,
  SourceFailurePolicy,
  SourceProfile,
  SourceProfileId,
  SourceSurface,
} from "../src/core/index.js";

test("built-in source profiles have unique profile ids", () => {
  const profiles = listSourceProfiles();
  const ids = profiles.map((profile) => profile.profile_id);

  assert.equal(new Set(ids).size, ids.length);
});

test("listSourceProfiles returns all built-in profiles", () => {
  const profiles = listSourceProfiles();

  assert.equal(profiles.length, Object.keys(BUILT_IN_SOURCE_PROFILES).length);
  assert.ok(profiles.some((profile) => profile.profile_id === "official_docs"));
  assert.ok(profiles.some((profile) => profile.profile_id === "product_research"));
  assert.ok(profiles.some((profile) => profile.profile_id === "multi_agent_handoff"));
  assert.ok(profiles.some((profile) => profile.profile_id === "local_custom"));
});

test("getSourceProfile returns known profiles and undefined for unknown ids", () => {
  const social = getSourceProfile("social_pulse");

  assert.ok(social);
  assert.equal(social.profile_id, "social_pulse");
  assert.equal(getSourceProfile("unknown_profile"), undefined);
});

test("every built-in source profile has usable source types and positive decay metadata", () => {
  for (const profile of listSourceProfiles()) {
    assert.ok(profile.source_types.length > 0, `${profile.profile_id} should have source types`);
    assert.ok(profile.default_decay_lambda > 0, `${profile.profile_id} should have positive lambda`);
    assert.ok(profile.half_life_hours > 0, `${profile.profile_id} should have positive half-life`);
  }
});

test("official docs carry higher authority and slower decay than social pulse", () => {
  const official = getSourceProfile("official_docs");
  const social = getSourceProfile("social_pulse");

  assert.ok(official);
  assert.ok(social);
  assert.equal(official.authority_hint, "high");
  assert.ok(official.half_life_hours > social.half_life_hours);
  assert.ok(official.default_decay_lambda < social.default_decay_lambda);
});

test("market finance decays faster than academic research", () => {
  const finance = getSourceProfile("market_finance");
  const academic = getSourceProfile("academic_research");

  assert.ok(finance);
  assert.ok(academic);
  assert.ok(finance.half_life_hours < academic.half_life_hours);
  assert.ok(finance.default_decay_lambda > academic.default_decay_lambda);
});

test("local custom exists as explicit caller-provided context, not filesystem access", () => {
  const local = getSourceProfile("local_custom");

  assert.ok(local);
  assert.equal(local.profile_id, "local_custom");
  assert.ok(local.source_types.includes("local_custom"));
  assert.match(local.purpose, /User-provided/);
  assert.doesNotMatch(local.purpose, /file search|filesystem|crawler/i);
});

test("product research exists as product judgment policy, not standalone retrieval", () => {
  const product = getSourceProfile("product_research");

  assert.ok(product);
  assert.equal(product.profile_id, "product_research");
  assert.ok(product.source_types.includes("product_page"));
  assert.ok(product.source_types.includes("vendor_docs"));
  assert.equal(product.authority_hint, "medium");
  assert.equal(product.date_policy, "balanced");
  assert.equal(product.failure_policy, "downgrade");
  assert.match(product.purpose, /Product pages/);
  assert.doesNotMatch(product.purpose, /fetch|crawler|scrape|browser/i);
});

test("multi-agent handoff exists as caller-provided context policy, not orchestration", () => {
  const handoff = getSourceProfile("multi_agent_handoff");

  assert.ok(handoff);
  assert.equal(handoff.profile_id, "multi_agent_handoff");
  assert.ok(handoff.source_types.includes("agent_handoff"));
  assert.ok(handoff.source_types.includes("user_provided"));
  assert.equal(handoff.date_policy, "balanced");
  assert.equal(handoff.failure_policy, "warn");
  assert.match(handoff.purpose, /Caller-provided context/);
  assert.doesNotMatch(handoff.purpose, /retrieve|Operator mode|file search|filesystem|crawler/i);
});

test("source profile accessors return copies rather than shared mutable arrays", () => {
  const first = getSourceProfile("official_docs");
  const second = getSourceProfile("official_docs");

  assert.ok(first);
  assert.ok(second);
  first.source_types.push("mutated");
  first.recommended_surfaces.push("mcp");

  assert.equal(second.source_types.includes("mutated"), false);
  assert.equal(getSourceProfile("official_docs")?.source_types.includes("mutated"), false);
});

test("source profile public types are consumable from src/core/index.ts", () => {
  const profileId: SourceProfileId = "official_docs";
  const productProfileId: SourceProfileId = "product_research";
  const handoffProfileId: SourceProfileId = "multi_agent_handoff";
  const authority: SourceAuthorityHint = "high";
  const datePolicy: SourceDatePolicy = "balanced";
  const failurePolicy: SourceFailurePolicy = "warn";
  const surface: SourceSurface = "sdk";
  const profile: SourceProfile | undefined = getSourceProfile(profileId);

  assert.ok(profile);
  assert.equal(profile.authority_hint, authority);
  assert.equal(profile.date_policy, datePolicy);
  assert.equal(profile.failure_policy, failurePolicy);
  assert.ok(profile.recommended_surfaces.includes(surface));
  assert.equal(getSourceProfile(productProfileId)?.profile_id, "product_research");
  assert.equal(getSourceProfile(handoffProfileId)?.profile_id, "multi_agent_handoff");
});
