# Signal Contract Replay Datasets

These replay datasets validate that Signal Contract v1 can be evaluated consistently across several saved candidate-context batches. They are not production-scale benchmarks.

Each file is a source-checkout fixture for:

```bash
npm run batch:validate -- <dataset>
```

The fixtures do not fetch, crawl, scrape, browse, or call live adapters. They are saved candidate-context examples used to inspect decision distributions, date quality, failed content handling, and score normalization.

## Replay Summary

| Dataset | Profile | Intent | Signals | Notable decisions | Anomalies | Top decision | Command |
| --- | --- | --- | ---: | --- | --- | --- | --- |
| `examples/batches/signal-contract-v1.academic.json` | `academic_research` | `citation_check` | 12 | primary 2; supporting 1; background 2; verify 3; watch 3; exclude 1 | missing date 1; invalid date 1; future date 1; clamped score 2; failed status 1 | `Cite as primary` | `npm run batch:validate -- examples/batches/signal-contract-v1.academic.json` |
| `examples/batches/signal-contract-v1.official-docs.json` | `official_docs` | `developer_adoption` | 12 | use first 3; background 1; verify 3; watch 4; exclude 1 | missing date 1; invalid date 1; future date 1; clamped score 2; failed status 1 | `Use first` | `npm run batch:validate -- examples/batches/signal-contract-v1.official-docs.json` |
| `examples/batches/signal-contract-v1.rag-vendors.json` | `company_intel` | `business_due_diligence` | 12 | background 5; verify 3; watch 3; exclude 1 | missing date 1; invalid date 1; future date 1; clamped score 2; failed status 1 | `Use as background` | `npm run batch:validate -- examples/batches/signal-contract-v1.rag-vendors.json` |
| `examples/batches/signal-contract-v1.jobs.json` | `jobs_opportunities` | `job_search` | 12 | use first 1; background 3; refresh 6; watch 1; exclude 1 | missing date 1; invalid date 1; future date 1; clamped score 2; failed status 1 | `Use first` | `npm run batch:validate -- examples/batches/signal-contract-v1.jobs.json` |
| `examples/batches/signal-contract-v1.mixed-agent-handoff.json` | `composite_landscape` | `developer_adoption` | 12 | use first 1; background 3; verify 3; watch 4; exclude 1 | missing date 1; invalid date 1; future date 1; clamped score 2; failed status 1 | `Use first` | `npm run batch:validate -- examples/batches/signal-contract-v1.mixed-agent-handoff.json` |

Use the structured `[FRESHCONTEXT_BATCH_JSON]` block from each run as the reproducible source of truth for exact decision and anomaly counts.
