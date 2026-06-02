import type { SourceProfileId } from "../core/index.js";

export type AdapterRisk = "low" | "medium" | "high";
export type AdapterOutputMode = "single" | "batch" | "composite";
export type AdapterRuntimeKind = "api" | "browser" | "composite" | "mixed" | "local";

export interface FreshContextAdapterDescriptor {
  adapter_id: string;
  tool_name: string;
  source_profile: SourceProfileId;
  secondary_source_profiles?: SourceProfileId[];
  output_mode: AdapterOutputMode;
  runtime_kind: AdapterRuntimeKind;
  risk: AdapterRisk;
  notes?: string;
}

function descriptor(input: FreshContextAdapterDescriptor): FreshContextAdapterDescriptor {
  return Object.freeze({
    ...input,
    secondary_source_profiles: input.secondary_source_profiles
      ? Object.freeze([...input.secondary_source_profiles])
      : undefined,
  }) as FreshContextAdapterDescriptor;
}

function copyDescriptor(descriptor: FreshContextAdapterDescriptor): FreshContextAdapterDescriptor {
  return {
    ...descriptor,
    secondary_source_profiles: descriptor.secondary_source_profiles
      ? [...descriptor.secondary_source_profiles]
      : undefined,
  };
}

export const BUILT_IN_ADAPTER_REGISTRY: readonly FreshContextAdapterDescriptor[] = Object.freeze([
  descriptor({
    adapter_id: "github",
    tool_name: "extract_github",
    source_profile: "code_activity",
    output_mode: "single",
    runtime_kind: "browser",
    risk: "medium",
    notes: "Repository page extraction uses browser automation; keep behavior compatibility pinned before signal extraction.",
  }),
  descriptor({
    adapter_id: "google_scholar",
    tool_name: "extract_scholar",
    source_profile: "academic_research",
    output_mode: "batch",
    runtime_kind: "browser",
    risk: "medium",
    notes: "Scholar extraction is browser-backed and date precision is usually year-level.",
  }),
  descriptor({
    adapter_id: "hackernews",
    tool_name: "extract_hackernews",
    source_profile: "social_pulse",
    output_mode: "batch",
    runtime_kind: "mixed",
    risk: "medium",
    notes: "Plain query path uses Algolia API; URL extraction can use browser automation.",
  }),
  descriptor({
    adapter_id: "yc",
    tool_name: "extract_yc",
    source_profile: "company_intel",
    output_mode: "batch",
    runtime_kind: "browser",
    risk: "medium",
    notes: "YC company listing extraction is browser-backed.",
  }),
  descriptor({
    adapter_id: "reposearch",
    tool_name: "search_repos",
    source_profile: "code_activity",
    output_mode: "batch",
    runtime_kind: "api",
    risk: "low",
    notes: "GitHub repository search API result set; good early signal-output candidate.",
  }),
  descriptor({
    adapter_id: "packagetrends",
    tool_name: "package_trends",
    source_profile: "code_activity",
    secondary_source_profiles: ["official_docs"],
    output_mode: "batch",
    runtime_kind: "api",
    risk: "low",
    notes: "Registry metadata for npm and PyPI packages.",
  }),
  descriptor({
    adapter_id: "arxiv",
    tool_name: "extract_arxiv",
    source_profile: "academic_research",
    output_mode: "batch",
    runtime_kind: "api",
    risk: "low",
    notes: "Official API with clear paper timestamps; recommended first extraction target.",
  }),
  descriptor({
    adapter_id: "finance",
    tool_name: "extract_finance",
    source_profile: "market_finance",
    output_mode: "batch",
    runtime_kind: "api",
    risk: "medium",
    notes: "Quote freshness and partial-failure semantics need careful compatibility coverage.",
  }),
  descriptor({
    adapter_id: "reddit",
    tool_name: "extract_reddit",
    source_profile: "social_pulse",
    output_mode: "batch",
    runtime_kind: "api",
    risk: "medium",
    notes: "Public JSON API with community-content volatility.",
  }),
  descriptor({
    adapter_id: "producthunt",
    tool_name: "extract_producthunt",
    source_profile: "social_pulse",
    output_mode: "batch",
    runtime_kind: "mixed",
    risk: "medium",
    notes: "Uses optional API path with browser fallback.",
  }),
  descriptor({
    adapter_id: "landscape",
    tool_name: "extract_landscape",
    source_profile: "composite_landscape",
    secondary_source_profiles: ["company_intel", "code_activity", "social_pulse"],
    output_mode: "composite",
    runtime_kind: "composite",
    risk: "high",
    notes: "Composite report should preserve section-level source profiles before extraction.",
  }),
  descriptor({
    adapter_id: "jobs",
    tool_name: "search_jobs",
    source_profile: "jobs_opportunities",
    output_mode: "batch",
    runtime_kind: "api",
    risk: "medium",
    notes: "Multi-source job aggregation with filters and strict recency expectations.",
  }),
  descriptor({
    adapter_id: "changelog",
    tool_name: "extract_changelog",
    source_profile: "official_docs",
    secondary_source_profiles: ["code_activity"],
    output_mode: "batch",
    runtime_kind: "mixed",
    risk: "medium",
    notes: "GitHub releases and registry paths are API-backed; website discovery can use browser automation.",
  }),
  descriptor({
    adapter_id: "govcontracts",
    tool_name: "extract_govcontracts",
    source_profile: "government_regulatory",
    output_mode: "batch",
    runtime_kind: "api",
    risk: "medium",
    notes: "Official API; direct API URL compatibility and award-date semantics need coverage.",
  }),
  descriptor({
    adapter_id: "gov_landscape",
    tool_name: "extract_gov_landscape",
    source_profile: "composite_landscape",
    secondary_source_profiles: ["government_regulatory", "code_activity", "social_pulse", "official_docs"],
    output_mode: "composite",
    runtime_kind: "composite",
    risk: "high",
    notes: "Composite government report stitches multiple source profiles.",
  }),
  descriptor({
    adapter_id: "finance_landscape",
    tool_name: "extract_finance_landscape",
    source_profile: "composite_landscape",
    secondary_source_profiles: ["market_finance", "social_pulse", "code_activity", "official_docs"],
    output_mode: "composite",
    runtime_kind: "composite",
    risk: "high",
    notes: "Composite finance report must not collapse market and social freshness into one policy.",
  }),
  descriptor({
    adapter_id: "sec_filings",
    tool_name: "extract_sec_filings",
    source_profile: "government_regulatory",
    output_mode: "batch",
    runtime_kind: "api",
    risk: "low",
    notes: "Official SEC API with clear filing dates.",
  }),
  descriptor({
    adapter_id: "gdelt",
    tool_name: "extract_gdelt",
    source_profile: "government_regulatory",
    secondary_source_profiles: ["company_intel"],
    output_mode: "batch",
    runtime_kind: "api",
    risk: "medium",
    notes: "Global news intelligence has fast-moving timestamps and broad source variance.",
  }),
  descriptor({
    adapter_id: "company_landscape",
    tool_name: "extract_company_landscape",
    source_profile: "composite_landscape",
    secondary_source_profiles: ["company_intel", "government_regulatory", "market_finance", "official_docs"],
    output_mode: "composite",
    runtime_kind: "composite",
    risk: "high",
    notes: "Composite company report combines official, market, news, and product velocity signals.",
  }),
  descriptor({
    adapter_id: "gebiz",
    tool_name: "extract_gebiz",
    source_profile: "government_regulatory",
    output_mode: "batch",
    runtime_kind: "api",
    risk: "low",
    notes: "Official data.gov.sg procurement dataset.",
  }),
  descriptor({
    adapter_id: "idea_landscape",
    tool_name: "extract_idea_landscape",
    source_profile: "composite_landscape",
    secondary_source_profiles: ["social_pulse", "company_intel", "code_activity", "jobs_opportunities"],
    output_mode: "composite",
    runtime_kind: "composite",
    risk: "high",
    notes: "Composite idea validation report stitches social, funding, code, jobs, package, and launch signals.",
  }),
]);

export function listAdapterDescriptors(): FreshContextAdapterDescriptor[] {
  return BUILT_IN_ADAPTER_REGISTRY.map(copyDescriptor);
}

export function getAdapterDescriptor(adapterIdOrToolName: string): FreshContextAdapterDescriptor | undefined {
  const descriptor = BUILT_IN_ADAPTER_REGISTRY.find(
    (item) => item.adapter_id === adapterIdOrToolName || item.tool_name === adapterIdOrToolName
  );
  return descriptor ? copyDescriptor(descriptor) : undefined;
}

export function listAdaptersBySourceProfile(profileId: SourceProfileId): FreshContextAdapterDescriptor[] {
  return BUILT_IN_ADAPTER_REGISTRY
    .filter((item) =>
      item.source_profile === profileId || item.secondary_source_profiles?.includes(profileId)
    )
    .map(copyDescriptor);
}

export function listAdaptersByRisk(risk: AdapterRisk): FreshContextAdapterDescriptor[] {
  return BUILT_IN_ADAPTER_REGISTRY
    .filter((item) => item.risk === risk)
    .map(copyDescriptor);
}
