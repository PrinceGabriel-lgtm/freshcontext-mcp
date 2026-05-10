---
title: "Temporal Failures in Retrieval-Augmented AI Systems: A Survey of Stale-Data Risks and the Emerging Market for Freshness-Aware Retrieval Infrastructure"
author: "Immanuel Gabriel"
affiliation: "Independent Researcher, Grootfontein, Namibia"
date: "2026-05-10"
version: "1.0"
license: "CC-BY-4.0"
identifier: "freshcontext-research-2026-05"
keywords: ["retrieval-augmented generation", "RAG", "temporal information retrieval", "freshness", "decay functions", "vector databases", "AI infrastructure"]
---

# Temporal Failures in Retrieval-Augmented AI Systems: A Survey of Stale-Data Risks and the Emerging Market for Freshness-Aware Retrieval Infrastructure

**Author:** Immanuel Gabriel, Grootfontein, Namibia
**Date:** May 10, 2026
**Version:** 1.0
**License:** CC-BY-4.0

---

## Executive Summary

Retrieval-augmented generation (RAG) was supposed to fix one of the most embarrassing problems in deployed AI: confidently produced output that turns out to be wrong. By grounding a language model in retrieved documents, RAG promised current, traceable, defensible answers. In production, a different problem has emerged. The retrieved documents themselves go stale, the retriever has no built-in concept of time, and the generator presents stale information with the same fluency and the same confidence as fresh information. The user, and often the operator, has no way to tell the difference.

This whitepaper surveys what is publicly known about temporal failures in RAG systems as of May 2026. It pulls together legal rulings, peer-reviewed studies, vendor documentation, and a growing volume of practitioner field reports to argue that the temporal dimension of retrieval has shifted from a niche academic concern in temporal information retrieval (TIR) to a frontline reliability problem in commercial AI.

**Headline findings:**

- **The mechanism is simple and well-understood, but largely uncorrected in production stacks.** Cosine similarity over dense embeddings is time-blind. A pricing page from eighteen months ago will retrieve just as readily as today's, and the embedding has no idea which is current. Standard RAG frameworks (LangChain, LlamaIndex, Haystack) leave the temporal logic entirely to the developer.
- **Real-world consequences are now legally documented.** In *Moffatt v. Air Canada* (2024 BCCRT 149), the British Columbia Civil Resolution Tribunal held the airline liable for negligent misrepresentation when its chatbot told a grieving passenger he could claim a bereavement fare retroactively, contradicting the live policy on a different page of the same website. Damages were modest (CA$812.02), but the precedent—companies are responsible for what their AI says, including when it says something out of date—is significant.
- **Even well-funded "RAG-grounded" systems hallucinate at meaningful rates.** Stanford RegLab and HAI's 2024 study of LexisNexis's Lexis+ AI and Thomson Reuters's Westlaw AI-Assisted Research found hallucination rates of 17% and 34% respectively on legal queries, despite both vendors marketing their tools as RAG-based and "hallucination-free."
- **The infrastructure gap is real.** Most major vector databases now support metadata filtering on dates, but only Qdrant ships first-class decay functions (exponential, Gaussian, linear) integrated into the query API. Weaviate added object-level TTL in version 1.35–1.36 (mid-2025). Pinecone and Cloudflare Vectorize support metadata filtering but not native scoring decay.
- **Decay calibration is empirically grounded but standardization is absent.** Wu and Huberman (2007) showed news novelty decays as a stretched exponential. Graffius's annual studies put social-media engagement half-lives at hours to days. Recommender-system research has found ~150-day half-lives effective for movie ratings. Document half-lives plausibly range from minutes (news, social) to years (scientific papers, regulations), but no widely adopted standard envelope format exists for carrying this metadata through a retrieval pipeline.

> **TL;DR for engineers**
>
> Cosine similarity does not know what year it is. Your vector index will happily return a deprecated API doc, a revoked policy, a closed job listing, or a superseded clinical guideline as the top match if its embedding is closest to the query. The model will then write a confident answer. Three things to do this quarter: (1) add `published_at`, `retrieved_at`, and `source_uri` to every chunk's metadata before ingestion; (2) apply an exponential decay multiplier R_t = R_0·exp(−λt) at rerank time, with λ tuned per content class; (3) treat document staleness as a first-class metric in your evals, not a vibe-check. Vendors are catching up unevenly. Qdrant has decay functions. Weaviate has TTL. Pinecone and Cloudflare have metadata filters but no native decay. There is no widely adopted envelope standard yet, which is why ad-hoc implementations dominate.

The body of this paper develops these findings in detail, surveys the temporal IR literature from Li and Croft (2003) to TempRetriever (2025), and catalogs the current generation of partial fixes—including FreshContext, an open-source Model Context Protocol server that the author maintains as one reference implementation among several.

---

## Abstract

Retrieval-augmented generation has become the dominant grounding pattern for production large language models, but the dominant retrieval primitive—dense vector similarity—has no native concept of time. This paper surveys the resulting class of failures, which we group under the term *temporal failure*: any case where a retrieval system surfaces a document whose semantic content is relevant but whose validity has lapsed. We catalog (i) the mechanism by which standard cosine-similarity retrieval becomes time-blind; (ii) documented incidents and case studies, including the Air Canada chatbot ruling, Stanford's hallucination benchmarks for legal AI, slopsquatting attacks driven by training-cutoff hallucinations, and practitioner reports of stale enterprise RAG; (iii) the lineage of temporal information retrieval research from Li and Croft (2003) through TempRALM (2024), TempRetriever (2025), and MRAG (2024); (iv) the current state of vendor support for freshness in vector databases and RAG frameworks; (v) empirical work on decay-rate calibration; and (vi) reference implementations of temporal correction layers, including FreshContext (Gabriel, 2025–2026). We argue that freshness-aware retrieval is shifting from a research topic to required production infrastructure, that the field has not yet converged on a standard envelope format for retrieval-time freshness metadata, and that this gap represents both a near-term reliability problem and an emerging market.

---

## 1. Introduction

The retrieval-augmented generation pattern, popularized by Lewis et al. (2020), proposed a clean separation between an LLM's parametric memory and an external, queryable knowledge store. The promise was that updates to the world would be reflected by updates to the store, not by retraining the model. In the three years since RAG became a default architecture for enterprise AI, that promise has held in one direction and broken in another. RAG does help when the underlying knowledge store is current. It does not help, and arguably makes things worse, when the store contains stale data that the retriever cannot distinguish from fresh data.

This is not a hypothetical concern. It is the failure mode behind the *Moffatt v. Air Canada* tribunal ruling. It is the failure mode that produced 17% to 34% hallucination rates in two leading legal AI products despite RAG grounding. It is the failure mode that practitioners now describe under the heading "data freshness rot" in production blog posts and Hacker News threads. It is the mechanism that makes coding assistants suggest deprecated APIs, that makes customer-support bots quote revoked refund policies, and that makes recruitment AI surface jobs that closed two years ago.

The author first encountered this problem as an end user. In late 2025, while job-seeking from Grootfontein, Namibia, the author asked Claude (Anthropic's assistant) for help finding remote roles. The assistant returned several listings. The author applied. Two of them did not exist anymore. One had closed two years prior. The assistant had retrieved snippets that *described* an open role and presented them with no temporal qualification. That single experience triggered what became FreshContext, an open-source Model Context Protocol server that wraps every retrieved signal in a structured freshness envelope. The work in this paper is partly an attempt to put that personal trigger into the wider context of what the retrieval and IR communities have been studying for two decades.

The paper is structured as a survey, not a product pitch. FreshContext appears in Section 7 alongside other reference implementations that address the same gap. The intent is that an engineering team at a RAG consultancy, an agent infrastructure builder, or a vector database vendor can use this document as a citable starting point for their own design decisions. Where the literature is genuinely thin—particularly around standardization and decay-rate calibration across content classes—the paper says so explicitly rather than pretending otherwise.

---

## 2. Background

### 2.1 The retrieval primitive and its blind spot

Modern RAG pipelines almost universally rely on dense vector retrieval. A document is split into chunks; each chunk is embedded into a high-dimensional vector by a model such as OpenAI's `text-embedding-3-large`, Cohere's `embed-multilingual-v3`, or an open-weights model such as `bge-large-en`. Queries are embedded by the same model, and the top-k chunks are returned by cosine similarity, dot product, or a related metric. Optional rerankers (cross-encoders, ColBERT-style late interaction) reorder the candidates, and a generator composes an answer over the surviving context.

The function being optimized at every step is *semantic relevance*. None of the standard primitives consider when a document was created, when it was last verified, or whether the world it describes still exists. As Glen Rhodes put it in a widely shared 2025 essay, "Semantic similarity does not care about time. A document written eighteen months ago about your company's pricing model will retrieve just fine when a user asks about current pricing. The embeddings don't know the document is outdated. The vector index doesn't know. The LLM doesn't know" (Rhodes, 2025).

### 2.2 Temporal information retrieval has a long history

The information retrieval community has known about this gap since well before the LLM era. Li and Croft (2003), in *Time-based language models* at CIKM, identified a class of "recency queries" for which TREC relevance judgments cluster heavily on recent documents, and proposed a query-likelihood model with an exponential time prior that improved retrieval over recency-blind baselines. This paper has been cited in essentially every subsequent temporal IR contribution.

Subsequent work by Berberich, Bedathur, Alonso, and Weikum (2010), Kanhabua and Nørvåg (2008, 2009), and others extended the framework to handle implicit temporal intent, document dating, and temporally evolving collections. A comprehensive recent survey by Piryani et al. (2025), "It's High Time: A Survey of Temporal Information Retrieval and Question Answering" (arXiv:2505.20243), traces the lineage from rule-based temporal expression normalization (HeidelTime; Strötgen and Gertz, 2010) through neural temporal QA benchmarks (TimeQA, ChroniclingAmericaQA, ArchivalQA) to LLM-era methods.

### 2.3 The LLM-era pivot

Lazaridou et al. (2021), "Mind the Gap: Assessing Temporal Generalization in Neural Language Models" (NeurIPS 2021), showed that Transformer-XL and related models degrade systematically when asked to predict text from beyond their training period, and that this degradation worsens monotonically with time. The paper argued explicitly that "now is the right time to rethink the static way in which language models are trained and evaluated, and develop adaptive language models that can remain up-to-date with respect to the ever-changing and non-stationary world."

Vu et al. (2023), "FreshLLMs: Refreshing Large Language Models with Search Engine Augmentation" (arXiv:2310.03214), introduced both FreshQA—a benchmark partitioned into never-changing, slow-changing, fast-changing, and false-premise questions—and FreshPrompt, a search-augmented prompting method. FreshLLMs/FreshPrompt is the most directly relevant prior art for any retrieval-time freshness layer; it found that even GPT-4-class models score poorly on fast-changing questions absent retrieval augmentation, and that the order in which retrieved evidence is presented to the model materially affects accuracy.

Gade and Jetcheva (2024), "It's About Time: Incorporating Temporality in Retrieval Augmented Language Models" (arXiv:2401.13222), introduced TempRALM, a temporally-aware extension to the Atlas RALM. The paper reports up to 74% improvement in QA performance over the baseline Atlas-large on TPQ-2020, and a 165% improvement in Recall@1, achieved without retraining the index, by adding a temporal-relevance term to the retriever's scoring function.

Abdallah et al. (2025), "TempRetriever: Fusion-based Temporal Dense Passage Retrieval for Time-Sensitive Questions" (arXiv:2502.21024, accepted at WSDM 2026), extends Dense Passage Retrieval by embedding query date and document timestamp directly into the retrieval representation. They report 9.56% improvement in Top-1 retrieval accuracy and 4.68% NDCG@10 on ChroniclingAmericaQA over baseline DPR.

Siyue et al. (2024), "MRAG: A Modular Retrieval Framework for Time-Sensitive Question Answering" (arXiv:2412.15540), introduces TempRAGEval as a diagnostic benchmark and proposes a modular retrieval architecture that scores semantic and temporal relevance separately and combines them multiplicatively. MRAG outperforms baseline retrievers on TempRAGEval and yields 4.5% improvements in downstream exact-match and F1 on QA accuracy.

### 2.4 Why the production stack lags

The academic literature on temporal IR is mature. The production stack is not. The reasons appear to be threefold.

First, the dominant abstractions in popular RAG frameworks—LangChain's `Document` object, LlamaIndex's `Node`, Haystack's `Document`—do carry metadata, but the frameworks treat date filtering as a developer-supplied concern rather than a first-class concept in the retrieval primitive. Time decay is implementable but not idiomatic.

Second, vector database vendors initially competed on latency, scale, and cost; freshness was not a flag in any major benchmark. The first-mover among the major vendors to ship integrated decay functions was Qdrant in version 1.14 (2025), which added exponential, Gaussian, and linear decay expressions as part of its score-boosting reranker (Qdrant, 2025). Weaviate followed with object TTL in 1.35 and 1.36 (Weaviate, 2025). Pinecone and Cloudflare Vectorize as of May 2026 support metadata filtering on date fields but have not shipped integrated decay scoring.

Third, the people building production RAG systems often discover the failure mode only after deploying. The recurring pattern—described in the practitioner essays surveyed in Section 5—is that demos work, the eval suite stays green, and the system silently degrades over weeks or months as the underlying knowledge base drifts away from reality.

---

## 3. Methods

This survey was conducted between February and May 2026 by a single author. The method was a structured web and literature search using the following sources:

- **Peer-reviewed and preprint literature**: arXiv (cs.CL, cs.IR, cs.LG), ACL Anthology, NeurIPS, ACM Digital Library, Springer, IEEE Xplore, and Semantic Scholar. Search terms included "temporal retrieval", "time-aware RAG", "temporal RAG", "RAG freshness", "knowledge decay", "stale retrieval", and combinations with "language model", "vector database", and "LLM hallucination".
- **Legal and case material**: Direct retrieval of *Moffatt v. Air Canada*, 2024 BCCRT 149 via the British Columbia Civil Resolution Tribunal, with cross-validation against CBC News, the American Bar Association, and McCarthy Tétrault commentary.
- **Vendor documentation**: Pinecone, Weaviate, Qdrant, Milvus, Chroma, Cloudflare Vectorize, Databricks Mosaic AI Vector Search, AWS Bedrock Knowledge Bases. Documentation was accessed directly from vendor sites between March and May 2026.
- **Practitioner literature**: Hacker News threads with 50+ comments, named-author engineering blog posts (Glen Rhodes, Ozgur Guler / Microsoft Azure), and Reddit discussions on r/LocalLLaMA and r/MachineLearning, treated as evidence of community sentiment rather than primary fact.
- **Industry reports and journalism**: VentureBeat, MIT Technology Review, Wired, The Verge, Fortune, BBC, Washington Post, CSO Online, InfoWorld, where covering documented incidents.

Where prior versions of this research (in earlier drafts) cited authors or specific numbers that could not be re-verified—including names that surfaced in earlier conversational drafts such as "Olufemi 2025" and "Pal 2026"—those citations were dropped. Every numerical claim and every named incident in this final version is backed by a public source listed in the inline citations of Section 4 onward. Where a claim is only available from non-primary sources (such as LLM-hallucination statistics aggregated by analyst blogs), this is flagged.

The author has a financial and reputational interest in FreshContext as a reference implementation. To mitigate bias, FreshContext is treated in Section 7 as one entry alongside other systems, and the survey explicitly searches for and reports stronger or competing solutions where they exist.

---

## 4. Findings: The Mechanism and Its Consequences

### 4.1 The mechanism: cosine similarity is time-blind

The arithmetic is straightforward. A document chunk *d* and a query *q* are projected to vectors **v_d** and **v_q** by an embedding model *f*. The retrieval score is typically `cos(v_d, v_q) = (v_d · v_q) / (||v_d|| ||v_q||)`. This score depends on the lexical and semantic content of *d* and *q*. It does not depend on `published_at(d)`, `last_verified_at(d)`, or `now`. Two documents with identical content but different dates will return identical similarity scores.

The consequence: if your knowledge base contains a 2023 version of a pricing page and a 2026 version, both indexed as separate chunks, the retriever has no preference between them other than incidental embedding noise. If the 2026 version was chunked slightly differently, or if a phrase in the 2023 version happens to match the user's wording more closely, the retriever will surface the 2023 version. The generator will quote it, often verbatim, in a confident tone, with a citation to the document URL. From the user's perspective the answer looks fully grounded.

This failure mode is what Rhodes (2025) called "data freshness rot": a silent failure in which output looks grounded, evals stay green, and the system gets less accurate every week as the underlying corpus drifts. Glen Rhodes, an independent practitioner writing on his personal blog, frames the architectural gap directly: "We built retrieval systems that are very good at finding relevant content and completely blind to whether that content is still true."

### 4.2 Consequence: the Air Canada ruling and the "AI is the website" doctrine

In November 2022, Jake Moffatt was booking a last-minute flight to Toronto for his grandmother's funeral. Air Canada's website hosted a chatbot. Moffatt asked it about the airline's bereavement fare. The chatbot told him that bereavement fares could be claimed *retroactively* if a refund application was filed within 90 days of ticket issuance. Air Canada's actual policy, on a separate page of the same website, explicitly required the discount to be requested *before* travel.

Moffatt booked at full fare, attended the funeral, applied for the bereavement refund, was denied, and filed at the British Columbia Civil Resolution Tribunal. The Tribunal found in his favor. Air Canada's defense—that the chatbot was "a separate legal entity that is responsible for its own actions"—was rejected as "remarkable" by tribunal member Christopher Rivers, who held that Air Canada owed Moffatt a duty of care and breached it by failing to ensure the accuracy of the chatbot's output (*Moffatt v. Air Canada*, 2024 BCCRT 149, paras. 26–32). Damages: CA$650.88 plus CA$36.14 in pre-judgment interest plus CA$125 in fees, totaling CA$812.02.

The damages are trivial. The doctrine is not. In Canada, and by close analogy in any common-law jurisdiction that recognizes negligent misrepresentation, a company is responsible for what its AI tells customers. From a temporal-failure standpoint, the *Moffatt* ruling is particularly notable because the chatbot's underlying error was, structurally, a stale-data problem: a policy that had presumably been correct at some earlier time, presented to a customer as if it were still in force.

The Tribunal's framing has been picked up by subsequent legal commentary as a general principle. McCarthy Tétrault's 2024 analysis (Geist, 2024) noted that the case "may be the first case to affirm this principle in the context of information provided by chatbots, but there is significant caselaw dealing with programmed computers to the same effect." Gardiner Roberts LLP, in a 2024 commentary on *Moffatt* and a related Meta AI scam case, summarized the implication for operators bluntly: "Companies that use client facing chatbots must ensure they understand that their liability for erroneous chatbot statements is potentially limitless in that Canada's only legal decision on this topic states clients are entitled to rely on AI statements" (Gardiner Roberts, 2024).

### 4.3 Consequence: legal AI hallucinates despite RAG grounding

Magesh, Surani, Dahl, Suzgun, Manning, and Ho (2024), "Hallucination-Free? Assessing the Reliability of Leading AI Legal Research Tools" (arXiv:2405.20362), conducted what they describe as the first preregistered empirical evaluation of commercial AI-driven legal research tools. They tested Lexis+ AI from LexisNexis and Westlaw AI-Assisted Research from Thomson Reuters—both of which had publicly claimed to "eliminate" or "avoid" hallucinations through RAG grounding—against more than 200 manually constructed legal queries.

The results: Lexis+ AI hallucinated on more than 17% of queries; Westlaw AI-Assisted Research hallucinated on more than 34%. The authors identified two distinct failure modes: (i) the AI describes the law incorrectly or makes factual errors, and (ii) the AI describes the law correctly but cites sources that do not actually support its claims. The second mode is structurally a temporal-and-provenance failure: the citation may exist, but it has been superseded, distinguished, or overruled.

Stanford HAI summarized the broader picture: in earlier work on general-purpose LLMs answering legal questions, hallucination rates ranged from 58% to 88% depending on model and query type (Dahl et al., 2024, Oxford Journal of Legal Analysis).

### 4.4 Consequence: coding assistants and the slopsquatting attack

Code generation is among the most temporally fragile domains. Software libraries deprecate APIs, rename functions, change parameter signatures, and remove npm or PyPI packages on schedules measured in weeks to months. A model whose training data ended in March 2024 will confidently call APIs that no longer exist by the time a user invokes the model in May 2026.

Wang, Wang, Liu, et al. (ICSE 2025), "LLMs Meet Library Evolution: Evaluating Deprecated API Usage in LLM-based Code Completion," identified 9,022 instances of deprecated API usage across seven advanced code LLMs including CodeLlama and GPT-3.5, with deprecated usage rates (DUR) reaching 34.4% for StarCoder2-3b and 37.4% for GPT-3.5 even when the LLMs had access to context.

Spracklen, Wijewickrama, Sakib, et al. (2024), "We Have a Package for You! A Comprehensive Analysis of Package Hallucinations by Code Generating LLMs," found that 19.7% of LLM package recommendations across 16 models pointed to packages that did not exist on npm or PyPI. CodeLlama hallucinated packages more than 33% of the time. GPT-4 Turbo had the lowest rate at 3.59%. Crucially, 43% of hallucinated packages were repeated every time the same prompt was issued, and 58% were repeated more than once across ten runs.

This regularity has produced a new attack surface. Security researcher Seth Larson coined the term *slopsquatting* in early 2025 to describe attackers who register hallucinated package names on npm and PyPI as malicious payloads, then wait for AI coding agents to install them on developer machines (Larson, 2025; Help Net Security, 2025). Charlie Eriksen of Aikido Security registered the hallucinated name `react-codeshift` (a conflation of the real packages `jscodeshift` and `react-codemod`) on npm in January 2026 as a defensive demonstration; the package received real download attempts and propagated through 237 LLM-generated agent-skill repositories before Eriksen flagged it (Aikido, 2026; InfoWorld, 2026).

Slopsquatting is not narrowly a temporal failure; it is fundamentally a hallucination problem. But the temporal component is structural: the LLM is recommending packages from a frozen view of the registry, and the registry has moved on.

### 4.5 Consequence: medical and clinical decision support

Medical knowledge updates continuously. Guidelines, dosing recommendations, contraindications, and drug interactions change. A foundation model trained on a 2023 corpus does not know that a particular medication has been withdrawn or that a guideline has been updated.

Pandit, Hou, Hwang, Du, Liu, and Zhao (2025), "Medical Hallucination in Foundation Models and Their Impact on Healthcare" (medRxiv 2025.02.28.25323115), provides a multi-national clinician survey and a taxonomy of medical hallucination, with explicit attention to the role of outdated training data. The authors cite Shekelle et al. (2002) for the empirical observation that medical guidelines become outdated rapidly—a finding well predating LLMs but newly relevant in the RAG era.

Tonmoy, Zaman, Jain, Rani, Rawte, Chadha, and Das (2024), in their survey of hallucination mitigation techniques in medical LLMs (arXiv:2408.13808), specifically flag the need for "up-to-date and specialized knowledge" and "strict adherence to established medical guidelines" as defining requirements of the medical domain that current RAG implementations do not robustly satisfy.

### 4.6 Consequence: GDPR and the right to erasure

The European Union's General Data Protection Regulation (GDPR), Article 17, grants data subjects a right to erasure. When a customer requests deletion, an organization must remove their personal data from production systems. RAG pipelines complicate this: a document may be embedded into thousands of vector chunks, and those chunks are stored across vector databases, conversation logs, derived datasets, and caches.

AWS published guidance in 2024 on implementing right-to-be-forgotten requests for Amazon Bedrock Knowledge Bases, demonstrating the deletion of source documents from S3 propagating through to OpenSearch Serverless vector embeddings (AWS Machine Learning Blog, 2024). Milvus's documentation discusses TTL policies as a complementary GDPR control. CSO Online's 2025 reporting noted that "a massive, often-overlooked challenge in RAG pipelines is data deletion" and framed it as a zero-trust requirement spanning ingestion, retrieval, and generation.

The temporal dimension is direct: a GDPR violation can occur not only because data was retained past its lawful basis, but because the *time* between deletion request and effective propagation through caches, indexes, and conversation memory exceeds the regulatory window. Time-to-live becomes a compliance instrument, not just a freshness instrument.

### 4.7 Consequence: enterprise RAG silently degrades

The quantitative literature on enterprise RAG degradation is thinner than the qualitative practitioner literature, and the most-cited specific numbers (such as the claim that "73% of enterprise RAG deployments fail within the first year") trace to vendor blog posts rather than independent studies. We flag those numbers as marketing rather than research.

What is well-attested in the practitioner literature is the pattern. Tommy Adeliyi, writing on Medium in March 2026, described production failures in terms a regulator would recognize: "Query: 'Does the enterprise plan support SAML?' Retrieved: authentication_doc_v1.md (score: 0.91). Current doc: authentication_doc_v3.md (not in index). Grader score: 0.91 → Decision: Generate directly. Generated: 'Yes, the enterprise plan supports SAML authentication.' Actual answer: SAML was deprecated in v2. Removed in v3. Result: hallucinated answer served with high confidence." Adeliyi's framing is direct: "Retrieval grading alone cannot catch staleness."

Brainfish (2025) reported a case study from a SaaS company where a new pricing model shipped, documentation was updated three sprints later, and the support assistant continued to quote the old pricing for several weeks—creating customer escalations and a partial product rollback before the freshness gap was identified.

VentureBeat's coverage (Raj, 2025) framed the broader market shift: "Stale context, ungoverned access paths and poorly evaluated retrieval pipelines do not merely degrade answer quality; they undermine trust, compliance and operational reliability." The piece argued, plausibly, that retrieval should be treated as infrastructure with first-class freshness, governance, and evaluation properties—rather than as application logic.

### 4.8 Personal field example: jobs that no longer exist

In November 2025 the author, based in Grootfontein, Namibia, asked Anthropic's Claude assistant for help finding remote engineering roles. The assistant returned several listings, retrieved through its tool integrations. Two of the listings turned out to no longer exist; one had closed approximately two years prior. The model presented them with no temporal qualification and no confidence flag.

This anecdote does not constitute systematic evidence. It is the personal field example that prompted FreshContext. It is included here, with the same skepticism the author applies to any other single-source field report, because it concretely illustrates the absence of a freshness signal in a widely-deployed agent stack: the retriever had access to live web tools, the data was in fact stale, and there was no point in the pipeline at which the model was forced to reason about how old its evidence was.

---

## 5. Industry and Use-Case Mapping

The temporal failure surface differs by domain. The following mapping is organized roughly in decreasing order of where current practitioner literature suggests the impact is severe.

**Legal and regulatory compliance.** As Section 4.3 documents, RAG-grounded legal AI tools hallucinate at 17–34% rates on legal queries, often through citation drift to superseded cases. Compliance officers in financial services and healthcare face direct regulatory risk when AI cites obsolete rules. The Stanford and Yale work establishes this domain as the most thoroughly benchmarked.

**Medical and clinical decision support.** Section 4.5. The combination of fast-changing clinical guidelines, life-or-death stakes, and increasing regulatory attention (FDA, EMA, MHRA) makes this a domain where freshness is non-negotiable.

**Customer support automation.** Air Canada (Section 4.2) and similar incidents (DPD's chatbot, Cursor's "Sam" support agent, Klarna's partial reversal of full automation) have made customer support the most public site of stale-data failure. Fortune (2025) reported that customer-support chatbots are now seen by enterprise risk officers as a regulated risk surface comparable to consumer-finance disclosures.

**Code generation and developer assistants.** Section 4.4. Slopsquatting is a vivid example, but the broader pattern—deprecated APIs, removed packages, version-mismatched suggestions—affects every developer using AI coding assistants.

**Financial intelligence and trading.** Lanham (2026) and the *Just-in-Time Historical State Reconstruction* paper (MDPI AI 2026) document RAG latency and freshness as primary blockers for low-latency trading-research applications. Stale market data is not merely inaccurate; it is actionably wrong.

**Enterprise RAG over HR handbooks, SOPs, and policy.** Section 4.7. The Brainfish, Faktion, Binariks, and analyticsvidhya practitioner essays converge on the same diagnosis: HR and policy corpora drift quickly, retrieval is blind to that drift, and the failure is silent until users escalate.

**News and journalism AI.** Wu and Huberman (2007) showed news novelty decays as a stretched exponential on timescales of hours to days; modern social-media half-lives are measured in minutes (Graffius, 2024, 2025, 2026). News retrieval without aggressive recency weighting will surface yesterday's story for today's question.

**Sales intelligence and CRM enrichment.** Vendors including ZoomInfo, Apollo, Cognism, Clearbit/HubSpot Breeze, Lusha, and SalesIntel compete partly on data freshness. User reviews on G2 and Salesmotion (2026) repeatedly flag outdated contacts and decayed enrichment as the dominant complaint. Decay-aware enrichment is a feature here, not a research topic.

**Recruitment AI and applicant tracking systems.** Resume parsers (Jobscan, Enhancv, Resume.io, BeamJobs) and ATS systems handle a corpus where job listings expire daily and resumes update on personal timescales. The author's personal field example (Section 4.8) sits in this domain.

**Agent infrastructure (LangChain, LlamaIndex, Vercel AI SDK, Cohere, Cloudflare AI).** These platforms expose retrieval primitives to developers but do not enforce temporal hygiene. They are the layer at which an envelope standard would have most leverage.

---

## 6. Existing Technical Approaches

### 6.1 Time-aware language models (research lineage)

The lineage from Li and Croft (2003) is summarized in Section 2.2. Key milestones with verifiable citations:

- **Li and Croft (2003).** Time-based language models. CIKM '03. Exponential time prior in query-likelihood ranking.
- **Berberich, Bedathur, Alonso, Weikum (2010).** A language modeling approach for temporal information needs. ECIR 2010.
- **Kanhabua and Nørvåg (2008, 2009).** Document dating and temporal language models. ECDL.
- **Lazaridou et al. (2021).** Mind the Gap. NeurIPS 2021. Empirical demonstration that LLM perplexity degrades systematically over time post-training.
- **Vu, Iyyer, et al. (2023).** FreshLLMs / FreshPrompt / FreshQA. arXiv:2310.03214. Search-augmented prompting and a dynamic benchmark.
- **Gade and Jetcheva (2024).** TempRALM. arXiv:2401.13222. Temporal retrieval extension to Atlas.
- **Abdallah, Mozafari, Piryani, Anand, Jatowt (2025).** TempRetriever. arXiv:2502.21024. Fusion-based temporal DPR.
- **Siyue et al. (2024).** MRAG and TempRAGEval. arXiv:2412.15540. Modular retrieval with multiplicative semantic-temporal scoring.
- **Zhang, Li, Li, Ding, Low (2025).** E²RAG / ChronoQA. arXiv:2506.05939. Entity-event knowledge graphs for temporal-causal consistency.
- **Zerhoudi, Dinzinger, Granitzer, Mitrović (2026).** OwlerLite. arXiv:2601.17824. Browser-extension RAG with semantic change detection and freshness-aware crawling.
- **Piryani, Abdallah, Mozafari, Anand, Jatowt (2025).** "It's High Time": A survey of temporal IR and QA. arXiv:2505.20243.

### 6.2 Vector database support for freshness

A direct comparison of freshness-relevant features as of May 2026, drawn from vendor documentation:

- **Qdrant.** First-class decay functions (exponential, Gaussian, linear) introduced in version 1.14 as part of the score-boosting reranker. Decay is parameterized by `target` (typically current datetime), `scale` (e.g., 86,400 seconds for one-day half-decay), and `midpoint`. The query API supports formulas of the form `final_score = $score + exp_decay({...})` (Qdrant, 2025). Of the major vector databases this is the most complete native support.
- **Weaviate.** Object-level TTL introduced in version 1.35 and generalized in 1.36, with three expiration strategies (creation time, last-update time, date property), an `OBJECTS_TTL_DELETE_SCHEDULE` cron, and the option to filter expired-but-not-yet-deleted objects from query results. Decay scoring is not a first-class feature but is achievable through hybrid search and metadata-based reranking (Weaviate, 2025).
- **Pinecone.** Metadata filtering on numeric and string fields, including dates encoded as Unix timestamps. Native decay scoring is not provided; teams implement decay in application code or in a reranker layer. Pinecone Community threads document users discovering they cannot use ISO-8601 strings for `$gte` comparisons and must encode timestamps as numeric (Pinecone Community, 2024).
- **Cloudflare Vectorize.** Metadata filtering with `$eq`, `$ne`, `$in`, `$nin`, `$lt`, `$lte`, `$gt`, `$gte` operators on up to ten declared metadata indexes per vector index. Native decay is not provided; recency must be implemented externally (Cloudflare Vectorize Documentation, 2026).
- **Databricks Mosaic AI Vector Search.** Delta Sync Index supports continuous or triggered sync against a source Delta table, with Change Data Feed ensuring that only changed rows are re-embedded. This is a freshness-of-ingestion solution rather than a freshness-of-scoring solution; it keeps the index current but does not down-weight older chunks at query time (Databricks, 2025).
- **Milvus, Chroma, pgvector.** General-purpose metadata filtering. No first-class decay or TTL features at the time of writing.

### 6.3 RAG framework support

LangChain and LlamaIndex both expose `Document` and `Node` abstractions that carry arbitrary metadata. LlamaIndex provides a `FixedRecencyPostprocessor` and an auto-retrieval pattern that uses an LLM to infer date filters from natural-language queries (LlamaCloud Documentation, 2026). LangChain supports self-querying retrievers that translate user phrases like "recent" into structured filters. Neither framework enforces a freshness envelope; both leave temporal metadata as a developer convention.

### 6.4 Change-data-capture and webhook-driven re-indexing

Databricks Vector Search with Change Data Feed is the canonical example. Airbyte and Fivetran provide CDC-style ingestion into vector stores. The "RAG Freshness Paradox" (RAG About It, 2025) describes the architectural pattern as `Data sources → Change streams (CDC, webhooks, APIs) → Message queue (Kafka, Kinesis) → Processing pipeline → Vector index`, with reported end-to-end source-to-searchable latencies of 2–15 seconds. These claims are vendor-adjacent and should be read accordingly.

### 6.5 Hybrid retrieval with metadata filtering by date

The simplest production technique, and probably the most-deployed in May 2026: a developer attaches a `published_at` field to every chunk's metadata, and the retriever is configured to filter or boost based on date ranges inferred from the query. This works for explicit recency queries ("what's new this week?") but fails on implicit recency, where a user asks a present-tense question and expects the freshest answer without saying so. The literature on implicit temporal intent (Kanhabua and Nørvåg, 2010; Metzler et al., 2009) is directly relevant but rarely productionized.

### 6.6 Multi-source RAG with temporal alignment

MRAG (Siyue et al., 2024) provides the academic template. Practitioner implementations exist in vertical domains (financial trading, news aggregation) but are rarely open-sourced. The "10 RAG Shifts Redefining Production AI in 2026" essay (Guler, Microsoft Azure, 2026) argues that "the architectural move is from batch ingestion to freshness-aware retrieval"—a useful frame, though the essay does not propose a standard.

---

## 7. Current Approaches and Reference Implementations

This section catalogs publicly available, named systems that address temporal failure in retrieval. The list is not exhaustive. Inclusion does not constitute endorsement; readers should evaluate each against their own requirements.

**Qdrant decay functions.** Vendor-native, production-grade. Exponential, Gaussian, and linear decay integrated into the score-boosting reranker. Available since Qdrant 1.14 (2025). Documentation: qdrant.tech/documentation/search/search-relevance/.

**Weaviate Object TTL.** Vendor-native. Lifecycle-management oriented (auto-deletion of stale objects) rather than scoring oriented. Available since Weaviate 1.35 (mid-2025). Documentation: docs.weaviate.io/weaviate/manage-collections/time-to-live.

**FreshPrompt / FreshQA.** Open-source benchmark and prompting method (Vu et al., 2023). github.com/freshllms/freshqa. Useful as an evaluation harness; not a production retrieval layer.

**TempRALM.** Research code accompanying Gade and Jetcheva (2024). Few-shot extension to Atlas with a temporal-relevance term. Published at SJSU ScholarWorks.

**TempRetriever.** Research code accompanying Abdallah et al. (2025). Extension to DPR with date-aware passage embeddings. Published at WSDM 2026.

**MRAG / TempRAGEval.** Research code accompanying Siyue et al. (2024). Modular retrieval framework and time-sensitive QA benchmark.

**OwlerLite.** Browser-extension RAG system (Zerhoudi et al., 2026, arXiv:2601.17824) with a semantic change detector and freshness-aware re-indexing. Research preview.

**PentaRAG.** Five-layer cascade (arXiv:2506.21593) that combines fast cache paths, adaptive memory, and traditional RAG to balance freshness, latency, and cost in enterprise settings. Research artifact.

**Context7.** Commercial documentation-context server (context7.com) that provides version-specific library documentation to AI coding assistants, addressing the deprecated-API failure mode in Section 4.4.

**Milvus MCP.** Open-source MCP server from the Milvus team that injects current Milvus documentation into AI coding-assistant context, reducing the deprecated-API problem for that specific library (Milvus Blog, 2025).

**FreshContext (Gabriel, 2025–2026).** Open-source Model Context Protocol server, released under an MIT-licensed specification (v1.1, April 2026). FreshContext (Gabriel, 2025–2026) is one open-source reference implementation that wraps each retrieved signal in a structured envelope and applies an exponential decay function R_t = R_0·e^(−λt) to relevance scores. It exposes adapters to public sources including GitHub, Hacker News, Google Scholar, npm, PyPI, Y Combinator's company directory, USASpending.gov, SEC EDGAR, GDELT, and remote job boards, and emits envelopes of the form `{source, published_at, retrieved_at, freshness_confidence, freshness_score}`. Domain-calibrated half-lives in the v1.1 specification: Hacker News ≈14 hours, Reddit ≈3 days, job listings ≈6 days, GitHub repository activity ≈5 months, academic papers ≈1.6 years. Repository: github.com/PrinceGabriel-lgtm/freshcontext-mcp. Package: `freshcontext-mcp` on npm. Live demo: https://freshcontext-mcp.gimmanuel73.workers.dev/demo. The system is one entry in this catalog, not a comprehensive solution; users requiring sub-second freshness on financial market data, for example, will need a dedicated streaming pipeline rather than an MCP adapter layer.

**Honest comparison.** Among the listed systems, Qdrant decay functions provide the most mature *scoring-time* freshness primitive in a production vector database. Weaviate TTL provides the most mature *lifecycle* primitive. TempRetriever provides the strongest published *retrieval-time* gains on academic benchmarks. FreshContext is, to the author's knowledge, the most direct attempt to ship a *standard envelope format* through the MCP protocol layer; if a vector database vendor were to ship a comparable envelope as a first-class API, FreshContext's distinctiveness would narrow. The author considers that outcome desirable.

---

## 8. Decay Rate Calibration

A correctly calibrated decay function R_t = R_0·exp(−λt) requires choosing λ. The choice is content-class-specific. Empirical anchors:

**News / social media.** Wu and Huberman (2007), "Novelty and Collective Attention" (PNAS), analyzed 1 million Digg users and found that novelty decays as a stretched-exponential with characteristic timescale on the order of one day. Subsequent work by Castillo et al. (2013) showed that news article half-lives on social media vary by topic—business articles longer, sports articles shorter, with intermediate values for politics and entertainment. Graffius's annually updated "Lifespan (Half-Life) of Social Media Posts" reports (2024, 2025, 2026) put platform-specific engagement half-lives at: TikTok ≈0 minutes (effectively viral or dead), Snapchat ≈0 minutes, X (Twitter) ≈18 minutes, Facebook ≈6 hours, LinkedIn ≈24 hours, Instagram ≈48 hours, YouTube ≈8.4 days for engagement. These figures measure attention, not factual validity, but they bound the timescale on which social-media content is *consumed* and therefore the timescale on which retrieval staleness is most visible.

**Recommender systems.** Gkioulekas, Polychronopoulos, et al. (2017), "A Half-Life Decaying Model for Recommender Systems with Matrix Factorization," found that a half-life of approximately 150 days yielded large improvements in prediction accuracy on a 7-month MovieLens dataset.

**Code and APIs.** No widely cited empirical half-life. Anecdotally, JavaScript and Python ecosystems show major-version churn on roughly 12-month timescales, with deprecation windows of weeks to months.

**Academic papers.** Citation half-lives vary by field. The author's calibration in the FreshContext v1.1 specification uses ≈1.6 years for academic content, drawing on bibliometric analyses summarized in Uplatz (2025) but acknowledging that the figure is a rough working estimate rather than a settled empirical constant.

**Regulations and policy.** Highly variable. Tax rules update annually in most jurisdictions; clinical guidelines update on multi-year cycles. Practitioner blog posts (Rhodes, 2025) suggest TTLs of "six months for compliance policy, two weeks for API reference, two years for product vision posts" as defensible defaults but not as researched constants.

**The calibration challenge.** No widely adopted public dataset reports decay rates per content class with statistical confidence intervals. Most production teams set λ by intuition. The lack of an empirical benchmark for decay calibration is, in the author's assessment, the most significant gap in the temporal-IR literature. Closing this gap would require either a standard cross-domain corpus with explicit validity timestamps or a longitudinal study of correctness-decay in deployed RAG systems. Neither exists in mid-2026.

---

## 9. Discussion: The Infrastructure Gap

Synthesizing Sections 4–8, the gap can be stated precisely.

**At the embedding layer**, no production embedding model carries time as a feature. TempRetriever (Abdallah et al., 2025) demonstrates that this is fixable, but the technique has not propagated to commercial embedding APIs.

**At the vector database layer**, Qdrant has decay functions; Weaviate has TTL; Pinecone, Cloudflare, Milvus, Chroma, and pgvector do not have first-class decay scoring. No vendor has shipped a standard freshness envelope as part of the response payload.

**At the framework layer**, LangChain and LlamaIndex carry metadata but do not enforce freshness as a first-class concept. Self-querying retrievers can infer date filters, but the burden remains on the developer to wire the metadata in correctly.

**At the protocol layer**, the Model Context Protocol (Anthropic, 2024–2026) is emerging as a standard for tool integration but does not specify a freshness envelope. FreshContext is one attempt at a candidate envelope format; whether MCP itself, or a successor protocol, will adopt a standard remains open.

**At the evaluation layer**, RAGAS and ARES score answer faithfulness, answer relevance, and context relevance, but neither directly measures whether retrieved context is *temporally* valid. FreshQA and TempRAGEval are the closest research benchmarks; neither has been adopted as a standard CI gate in commercial RAG pipelines.

The implication: the field is at roughly the same maturity for *temporal* retrieval today as it was for *vector* retrieval in 2020. Primitives exist in research; production support is fragmented; standardization is absent; teams build ad-hoc pipelines.

A market consequence follows. Either the major vector database vendors absorb decay scoring and freshness envelopes as table-stakes features over the next 18–36 months, or a layer of independent middleware will form to do this work. Both paths are visible in the data above. Qdrant and Weaviate are moving in the first direction. FreshContext, Context7, OwlerLite, and various commercial CDC pipelines are evidence of the second.

---

## 10. Future Directions and Open Problems

**Adaptive decay calibration.** The strongest research direction is learning λ rather than setting it. A pipeline that tracks ground-truth correctness over time per document class, then optimizes decay parameters to minimize stale-citation rate, would dominate hand-tuned systems. The required dataset—document validity labels at multiple timestamps—does not exist publicly at scale.

**Cross-source temporal alignment.** When an answer cites a 2024 regulation, a 2026 commentary, and a 2025 court case, the user implicitly needs to know that the regulation is the most authoritative, that the court case may have re-interpreted it, and that the commentary should be down-weighted accordingly. MRAG (Siyue et al., 2024) and E²RAG (Zhang et al., 2025) take steps in this direction; production systems do not.

**Provenance and audit trails.** GDPR, the EU AI Act, and (in the United States) NIST AI Risk Management Framework guidance increasingly require operators to demonstrate what information their AI saw at the time of a decision. Cryptographic signing of retrieval-time envelopes—FreshContext implements SHA-256 provenance stamps under the working name "Ha-Pri" but the approach is not unique—is one direction. Standardization would benefit from cross-vendor input.

**Standardization.** The most direct policy lever would be a standard envelope format. A minimal proposal: every retrieved chunk returns `{content, source_uri, published_at, retrieved_at, validity_window, confidence}`. Whether this becomes part of MCP, OpenAI Tool Use, or a new protocol is a community decision; the technical content is uncontroversial. The author's work on FreshContext is a contribution toward this conversation, not a claim to its outcome.

**Evaluation benchmarks.** A standard "stale retrieval" benchmark, analogous to MMLU for general capability or HumanEval for code, would clarify which systems address the failure mode and which only claim to. FreshQA, TempRAGEval, and ChronoQA are starting points.

---

## 11. Limitations

This survey has the limitations characteristic of a single-author rapid review.

First, it relies primarily on English-language sources and may underweight relevant work in Mandarin, French, German, and other languages where temporal IR research is also active.

Second, several quantitative claims in the practitioner literature (the "73% of enterprise RAG deployments fail" figure, various vendor-cited reduction percentages from RAG, specific cost-per-query numbers) trace to non-peer-reviewed sources and are flagged as such throughout. Where a number cannot be verified to a primary source, the paper says so.

Third, the survey reflects the state of the field as of May 10, 2026. The vendor-feature landscape in particular is moving quickly; Qdrant and Weaviate added the freshness-relevant features cited here within the past 12 months, and others may follow before the ink dries.

Fourth, the author maintains FreshContext, an open-source reference implementation listed in Section 7. While effort has been made to present it as one entry among several rather than as a centerpiece, readers should assume the author has both more detailed knowledge of FreshContext than of competing systems and an interest in its adoption. The narrative judgments in Sections 7–9 should be read with that disclosure in mind.

Fifth, the personal field example in Section 4.8 is anecdotal evidence, not systematic data. It is included because it concretely illustrates a documented mechanism, not because two job listings constitute a benchmark.

---

## 12. Conclusion

The temporal dimension of retrieval is no longer optional infrastructure. The Air Canada ruling has settled the legal question of operator liability for AI-presented stale information in at least one common-law jurisdiction. Stanford's hallucination benchmarks have settled the empirical question of whether RAG grounding alone solves the problem (it does not). Vendor support is fragmented but moving; Qdrant and Weaviate have begun to ship freshness primitives, while Pinecone, Cloudflare, and the major framework vendors lag.

Organizations deploying RAG at scale will encounter these failure modes in year one or two of production. The pattern is consistent across the practitioner literature: demos work, evals stay green, and silent degradation accumulates until a regulator, a customer, or a court forces the issue.

The market for freshness-aware retrieval infrastructure is nascent but accelerating. It will be filled either by vector database vendors absorbing decay and TTL as table-stakes features, by RAG framework vendors codifying freshness envelopes as first-class metadata, or by independent middleware. All three movements are visible in the data surveyed here. The relevant research—from Li and Croft (2003) through TempRetriever (2025) and the MRAG-style modular architectures (2024–2025)—is mature enough to support production design choices today; the gap is in productization and standardization, not in algorithms.

For a builder considering where to invest, the practical answer in mid-2026 is: instrument freshness as an observable in your existing pipeline before changing your stack; choose a vector database whose decay or TTL story matches your domain's half-life; treat document staleness as a first-class metric in your evals; and watch the standardization conversation at the protocol layer, because the team that ships the de facto envelope format will define the interface that the rest of the ecosystem builds against.

The work remaining is not glamorous. It is cache invalidation, with citations.

---

## References

Abdallah, A., Mozafari, J., Piryani, B., Anand, A., & Jatowt, A. (2025). TempRetriever: Fusion-based Temporal Dense Passage Retrieval for Time-Sensitive Questions. *arXiv:2502.21024*. To appear in WSDM 2026.

American Bar Association. (2024). BC Tribunal Confirms Companies Remain Liable for Information Provided by AI Chatbot. *Business Law Today*, February 2024.

Aikido Security. (2026). Slopsquatting: The AI Package Hallucination Attack Already Happening. https://www.aikido.dev/blog/slopsquatting-ai-package-hallucination-attacks

AWS Machine Learning Blog. (2024). Implementing Knowledge Bases for Amazon Bedrock in support of GDPR (right to be forgotten) requests.

Berberich, K., Bedathur, S., Alonso, O., & Weikum, G. (2010). A Language Modeling Approach for Temporal Information Needs. *ECIR 2010*.

Brainfish. (2025). RAG Accuracy Degradation in Production. https://www.brainfishai.com/blog/rag-accuracy-degradation-in-production

British Columbia Civil Resolution Tribunal. (2024). *Moffatt v. Air Canada*, 2024 BCCRT 149.

CBC News. (2024). Air Canada found liable for chatbot's bad advice on bereavement rates. February 15, 2024.

Cloudflare. (2026). Vectorize Documentation: Metadata Filtering. https://developers.cloudflare.com/vectorize/reference/metadata-filtering/

Dahl, M., Magesh, V., Suzgun, M., & Ho, D. E. (2024). Profiling Legal Hallucinations in Large Language Models. *Oxford Journal of Legal Analysis*.

Databricks. (2025). Mosaic AI Vector Search Documentation: Delta Sync Index.

Faktion. (2025). Common Failure Modes of RAG & How to Fix Them for Enterprise Use Cases.

Fortune. (2025). A customer support AI went rogue—and it's a warning for every company considering replacing workers with automation.

Gade, A., & Jetcheva, J. G. (2024). It's About Time: Incorporating Temporality in Retrieval Augmented Language Models. *arXiv:2401.13222*.

Gabriel, I. (2025–2026). FreshContext: An MCP server for timestamped web intelligence with guaranteed freshness envelopes. https://github.com/PrinceGabriel-lgtm/freshcontext-mcp

Gardiner Roberts LLP. (2024). Is a company liable for its AI chatbot telling a customer to phone a scammer? https://www.grllp.com/blog/

Geist, M. (McCarthy Tétrault). (2024). Moffatt v. Air Canada: A Misrepresentation by an AI Chatbot. https://www.mccarthy.ca/

Graffius, S. M. (2024, 2025, 2026). Lifespan (Half-Life) of Social Media Posts: Annual Updates. ScottGraffius.com / ResearchGate.

Guler, O. (Microsoft Azure). (2026). 10 RAG Shifts Redefining Production AI in 2026. *Medium / Microsoft Azure*.

Help Net Security. (2025). Package hallucination: LLMs may deliver malicious code to careless devs. April 14, 2025.

InfoWorld. (2026). Supply-chain attacks take aim at your AI coding agents.

Kanhabua, N., & Nørvåg, K. (2008). Improving Temporal Language Models for Determining Time of Non-timestamped Documents. *ECDL 2008*.

Lazaridou, A., Kuncoro, A., Gribovskaya, E., et al. (2021). Mind the Gap: Assessing Temporal Generalization in Neural Language Models. *NeurIPS 2021*. *arXiv:2102.01951*.

Lewis, P., Perez, E., Piktus, A., et al. (2020). Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks. *NeurIPS 2020*.

Li, X., & Croft, W. B. (2003). Time-based Language Models. *CIKM 2003*, 469–475.

LlamaIndex / LlamaCloud. (2026). Documentation: Metadata Filter Inference; FixedRecencyPostprocessor.

Magesh, V., Surani, F., Dahl, M., Suzgun, M., Manning, C. D., & Ho, D. E. (2024). Hallucination-Free? Assessing the Reliability of Leading AI Legal Research Tools. *arXiv:2405.20362*. Stanford RegLab and HAI.

Milvus Blog. (2025). Why Your Vibe Coding Generates Outdated Code and How to Fix It with Milvus MCP.

Pandit, S., Hou, Y., Hwang, A. H.-C., Du, Y., Liu, R., & Zhao, J. (2025). Medical Hallucination in Foundation Models and Their Impact on Healthcare. *medRxiv 2025.02.28.25323115*.

Pinecone. (2024–2026). Pinecone Documentation: Metadata Filtering; Update Records.

Piryani, B., Abdallah, A., Mozafari, J., Anand, A., & Jatowt, A. (2025). It's High Time: A Survey of Temporal Information Retrieval and Question Answering. *arXiv:2505.20243*.

Qdrant. (2025). Untangling Relevance Score Boosting and Decay Functions. https://qdrant.tech/blog/decay-functions/

Qdrant. (2025). Qdrant 1.14 Release Notes: Score-Boosting Reranker. https://qdrant.tech/blog/qdrant-1.14.x/

RAG About It. (2025). The RAG Freshness Paradox: Why Your Enterprise Agents Are Making Decisions on Yesterday's Data.

Rhodes, G. (2025). Data freshness rot as the silent failure mode in production RAG systems. https://glenrhodes.com/

Siyue, W., et al. (2024). MRAG: A Modular Retrieval Framework for Time-Sensitive Question Answering. *arXiv:2412.15540*.

Socket. (2025). The Rise of Slopsquatting: How AI Hallucinations Are Fueling a New Class of Supply Chain Attacks.

Spracklen, J., Wijewickrama, R., Sakib, A. H., Maiti, A., Viswanath, B., & Jadliwala, M. (2024–2025). We Have a Package for You! A Comprehensive Analysis of Package Hallucinations by Code Generating LLMs.

Stanford HAI. (2024). AI on Trial: Legal Models Hallucinate in 1 out of 6 (or More) Benchmarking Queries. https://hai.stanford.edu/news/

Tonmoy, S. M. T. I., Zaman, S. M. M., Jain, V., Rani, A., Rawte, V., Chadha, A., & Das, A. (2024). Towards Reliable Medical Question Answering: Techniques and Challenges in Mitigating Hallucinations in Language Models. *arXiv:2408.13808*.

VentureBeat / Raj, V. (2025). Enterprises are measuring the wrong part of RAG. https://venturebeat.com/orchestration/

Vu, T., Iyyer, M., Wang, X., et al. (2023). FreshLLMs: Refreshing Large Language Models with Search Engine Augmentation. *arXiv:2310.03214*.

Wang, C., et al. (2025). LLMs Meet Library Evolution: Evaluating Deprecated API Usage in LLM-based Code Completion. *ICSE 2025*.

Weaviate. (2025). Weaviate 1.35 and 1.36 Release Notes: Object TTL. https://weaviate.io/blog/

Wu, F., & Huberman, B. A. (2007). Novelty and Collective Attention. *PNAS*, 104(45), 17599–17601.

Zerhoudi, S., Dinzinger, M., Granitzer, M., & Mitrović, J. (2026). OwlerLite: Scope- and Freshness-Aware Web Retrieval for LLM Assistants. *arXiv:2601.17824*.

Zhang, Z. Y., Li, Z., Li, Y., Ding, B., & Low, B. K. H. (2025). Respecting Temporal-Causal Consistency: Entity-Event Knowledge Graphs for Retrieval-Augmented Generation. *arXiv:2506.05939*.

---

## How to cite

```bibtex
@techreport{gabriel2026temporal,
  title  = {Temporal Failures in Retrieval-Augmented AI Systems: A Survey of Stale-Data Risks and the Emerging Market for Freshness-Aware Retrieval Infrastructure},
  author = {Gabriel, Immanuel},
  year   = {2026},
  month  = {May},
  type   = {Whitepaper},
  number = {freshcontext-research-2026-05},
  address = {Grootfontein, Namibia},
  institution = {Independent Research},
  url    = {https://github.com/PrinceGabriel-lgtm/freshcontext-mcp/blob/main/RESEARCH.md},
  note   = {Version 1.0. Licensed under CC-BY-4.0.}
}
```