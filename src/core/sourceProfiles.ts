import { LAMBDA } from "./decay.js";
import type { SourceProfile, SourceProfileId } from "./types.js";

function halfLifeHours(lambda: number): number {
  return Number((Math.log(2) / lambda).toFixed(2));
}

function profile(input: Omit<SourceProfile, "half_life_hours">): SourceProfile {
  return {
    ...input,
    half_life_hours: halfLifeHours(input.default_decay_lambda),
  };
}

function copyProfile(profile: SourceProfile): SourceProfile {
  return {
    ...profile,
    source_types: [...profile.source_types],
    recommended_surfaces: [...profile.recommended_surfaces],
  };
}

export const BUILT_IN_SOURCE_PROFILES: Readonly<Record<SourceProfileId, SourceProfile>> = Object.freeze({
  official_docs: profile({
    profile_id: "official_docs",
    source_types: ["official_docs", "changelog", "packagetrends"],
    purpose: "Official product docs, API docs, standards, changelogs, and canonical source material.",
    default_decay_lambda: LAMBDA.github,
    authority_hint: "high",
    date_policy: "balanced",
    failure_policy: "warn",
    recommended_surfaces: ["rest", "sdk", "cli", "operator"],
  }),
  code_activity: profile({
    profile_id: "code_activity",
    source_types: ["github", "reposearch", "changelog", "packagetrends"],
    purpose: "Repository activity, release cadence, dependency health, and implementation evidence.",
    default_decay_lambda: LAMBDA.github,
    authority_hint: "medium",
    date_policy: "balanced",
    failure_policy: "downgrade",
    recommended_surfaces: ["mcp", "rest", "sdk", "cli", "operator"],
  }),
  social_pulse: profile({
    profile_id: "social_pulse",
    source_types: ["hackernews", "reddit", "producthunt"],
    purpose: "Community awareness, social proof, launch momentum, and early-market signal.",
    default_decay_lambda: LAMBDA.hackernews,
    authority_hint: "medium",
    date_policy: "strict",
    failure_policy: "downgrade",
    recommended_surfaces: ["mcp", "rest", "sdk", "operator"],
  }),
  academic_research: profile({
    profile_id: "academic_research",
    source_types: ["google_scholar", "arxiv"],
    purpose: "Scholarly material, papers, research abstracts, and citation-oriented context.",
    default_decay_lambda: LAMBDA.arxiv,
    authority_hint: "high",
    date_policy: "lenient",
    failure_policy: "warn",
    recommended_surfaces: ["mcp", "rest", "sdk", "cli", "operator"],
  }),
  market_finance: profile({
    profile_id: "market_finance",
    source_types: ["finance", "finance_landscape"],
    purpose: "Market prices, quotes, financial movement, and finance-specific situational awareness.",
    default_decay_lambda: LAMBDA.finance,
    authority_hint: "medium",
    date_policy: "strict",
    failure_policy: "exclude",
    recommended_surfaces: ["mcp", "rest", "sdk", "operator"],
  }),
  jobs_opportunities: profile({
    profile_id: "jobs_opportunities",
    source_types: ["jobs"],
    purpose: "Job listings, openings, hiring signals, and opportunity windows.",
    default_decay_lambda: LAMBDA.jobs,
    authority_hint: "medium",
    date_policy: "strict",
    failure_policy: "downgrade",
    recommended_surfaces: ["mcp", "rest", "sdk", "cli", "operator"],
  }),
  government_regulatory: profile({
    profile_id: "government_regulatory",
    source_types: ["govcontracts", "sec_filings", "gebiz", "gdelt", "gov_landscape"],
    purpose: "Public-sector contracts, official filings, tenders, regulatory disclosures, and global news intelligence.",
    default_decay_lambda: LAMBDA.govcontracts,
    authority_hint: "high",
    date_policy: "strict",
    failure_policy: "warn",
    recommended_surfaces: ["mcp", "rest", "sdk", "operator"],
  }),
  company_intel: profile({
    profile_id: "company_intel",
    source_types: ["yc", "company_landscape"],
    purpose: "Company research, product velocity, ecosystem activity, and competitive context.",
    default_decay_lambda: LAMBDA.company_landscape,
    authority_hint: "medium",
    date_policy: "balanced",
    failure_policy: "downgrade",
    recommended_surfaces: ["mcp", "rest", "sdk", "operator"],
  }),
  product_research: profile({
    profile_id: "product_research",
    source_types: ["product_page", "pricing_page", "launch_page", "vendor_docs", "changelog", "producthunt"],
    purpose: "Product pages, launch material, pricing pages, vendor documentation, changelogs, and adoption evidence.",
    default_decay_lambda: LAMBDA.producthunt,
    authority_hint: "medium",
    date_policy: "balanced",
    failure_policy: "downgrade",
    recommended_surfaces: ["mcp", "rest", "sdk", "cli", "operator"],
  }),
  composite_landscape: profile({
    profile_id: "composite_landscape",
    source_types: ["landscape", "idea_landscape", "gov_landscape", "finance_landscape", "company_landscape"],
    purpose: "Multi-source validation and idea, company, market, government, or finance landscape checks.",
    default_decay_lambda: LAMBDA.landscape,
    authority_hint: "medium",
    date_policy: "balanced",
    failure_policy: "warn",
    recommended_surfaces: ["mcp", "rest", "sdk", "operator"],
  }),
  multi_agent_handoff: profile({
    profile_id: "multi_agent_handoff",
    source_types: ["agent_handoff", "agent_context", "workflow_context", "user_provided"],
    purpose: "Caller-provided context passed between agents or workflow steps, with warnings and provenance preserved.",
    default_decay_lambda: LAMBDA.default,
    authority_hint: "medium",
    date_policy: "balanced",
    failure_policy: "warn",
    recommended_surfaces: ["mcp", "rest", "sdk", "cli", "operator"],
  }),
  local_custom: profile({
    profile_id: "local_custom",
    source_types: ["local_custom", "user_provided", "custom"],
    purpose: "User-provided content and custom signals supplied explicitly by a host or caller.",
    default_decay_lambda: LAMBDA.default,
    authority_hint: "medium",
    date_policy: "balanced",
    failure_policy: "warn",
    recommended_surfaces: ["rest", "sdk", "cli", "operator"],
  }),
});

export function listSourceProfiles(): SourceProfile[] {
  return Object.values(BUILT_IN_SOURCE_PROFILES).map(copyProfile);
}

export function getSourceProfile(profileId: string): SourceProfile | undefined {
  const profile = BUILT_IN_SOURCE_PROFILES[profileId as SourceProfileId];
  return profile ? copyProfile(profile) : undefined;
}
