# Release A — retention substrate

Operational runbook. Establishes the storage and retention substrate for commercial
applications **before** any privacy notice describes it and before any application can be
accepted.

**Scope.** Migration `0002` plus the scheduled retention sweep. Nothing else.

**Not in this release.** The `/commercial/applications` route stays unmounted and absent
from `isAllowedRoute`. `INTAKE_ENABLED` is not set. Turnstile is not configured. The intake
rate limiter is not bound. The site is untouched. No application can be submitted, and none
will exist until Release C.

## Ordering, and why it is not negotiable

The Worker queries `commercial_applications` on every scheduled run. Deploy the code before
the table exists and every cron logs `application_purge_error` — harmless, isolated, and
noisy. **Migration first, then deploy.**

For this release that ordering is enforced by CI: the production deploy job applies exactly
`migrations/0002_commercial_applications.sql`, verifies the 20-column table shape, and only
then runs `wrangler deploy`. It deliberately does **not** run `wrangler d1 migrations apply`
because `0000_baseline.sql` is a historical snapshot explicitly marked not to be replayed.

The SQL in 0002 is additive and idempotent (`CREATE ... IF NOT EXISTS`), so retrying the
deploy job cannot duplicate the table or indexes. Nothing writes to the table until Release C.

## Sequence

### 1. Pre-deploy verification

```bash
cd worker && npm test          # expect 117 passed
cd .. && npm test              # expect 460 passed
npm run build                  # expect exit 0
npm run trust:gate             # expect exit 0
```

Confirm the intake is still unreachable in the artifact that will actually deploy:

```bash
cd worker && npx wrangler deploy --dry-run --outdir /tmp/wb
grep -c "handleApplicationIntake\|INTAKE_ENABLED\|commercial/applications" /tmp/wb/worker-e2.js
```

Expect `0`. `purgeExpiredApplications` and `commercial_applications` **should** appear —
that is the difference between this release and PR #99.

### 2. Merge Release A and let CI apply the schema gate

On the push to `main`, the production deploy job runs the equivalent of:

```bash
cd worker
npx wrangler d1 execute freshcontext-db --remote --yes \
  --file=migrations/0002_commercial_applications.sql
```

It then runs `PRAGMA table_info(commercial_applications)` and refuses to deploy the Worker
unless all 20 expected columns exist and no network-metadata columns are present.

The commands below remain useful as independent operator verification after the workflow
completes.

### 3. Verify the schema

```bash
npx wrangler d1 execute freshcontext-db --remote \
  --command "SELECT name FROM sqlite_master WHERE type='table' AND name='commercial_applications'"

npx wrangler d1 execute freshcontext-db --remote \
  --command "PRAGMA table_info(commercial_applications)"
```

Expect the table, 20 columns, and **no** column named `ip`, `ip_address` or `user_agent`.

```bash
npx wrangler d1 execute freshcontext-db --remote \
  --command "SELECT COUNT(*) AS n FROM commercial_applications"
```

Expect `0`. A non-zero count here means something is writing that should not be.

### 4. Confirm the Worker deployment

The same CI job deploys the Worker only after step 2 succeeds, then runs the existing
production smoke test proving the merged commit SHA is serving traffic. Record the workflow
run, deployed commit SHA and deployment status.

### 5. Insert a synthetic expired row

No personal data. The values below are deliberately non-identifying, and the reference is
outside the minted format so it can never collide with a real application.

```bash
npx wrangler d1 execute freshcontext-db --remote --command \
"INSERT INTO commercial_applications
 (reference, service, company, contact_name, contact_email, contact_role,
  workflow, stack, failure_mode, acceptance, timeline, environment,
  sensitivity, authority, acknowledged, received_at, purge_after)
 VALUES ('FC-TEST-EXPIRED-000001','assessment','SYNTHETIC','SYNTHETIC',
         'synthetic@invalid','SYNTHETIC','SYNTHETIC','SYNTHETIC','SYNTHETIC','SYNTHETIC',
         'Within 30 days','Staging / test','Public / non-sensitive test data',
         'Exploratory only',1,'2026-01-01T00:00:00.000Z','2026-01-02T00:00:00.000Z')"
```

And a control row that must survive, representing a converted live matter:

```bash
npx wrangler d1 execute freshcontext-db --remote --command \
"INSERT INTO commercial_applications
 (reference, service, company, contact_name, contact_email, contact_role,
  workflow, stack, failure_mode, acceptance, timeline, environment,
  sensitivity, authority, acknowledged, received_at, purge_after)
 VALUES ('FC-TEST-SURVIVES-000002','assessment','SYNTHETIC','SYNTHETIC',
         'synthetic@invalid','SYNTHETIC','SYNTHETIC','SYNTHETIC','SYNTHETIC','SYNTHETIC',
         'Within 30 days','Staging / test','Public / non-sensitive test data',
         'Exploratory only',1,'2026-01-01T00:00:00.000Z',NULL)"
```

`@invalid` is a reserved TLD and cannot route mail anywhere.

### 6. Observe the sweep

The cron is `0 */6 * * *`. There is no supported way to trigger a production scheduled
event on demand, so this means waiting for the next boundary — at most six hours — with a
tail open:

```bash
npx wrangler tail --format json | grep -i application_purge
```

Expect one `application_purge` event at `level: "info"` carrying `deleted_count`. It must
carry no reference, no contact detail and no field value.

If `application_purge_error` appears instead, stop and diagnose before proceeding. The most
likely cause is step 2 not having been applied to the same database.

### 7. Prove the expired row is gone

```bash
npx wrangler d1 execute freshcontext-db --remote \
  --command "SELECT reference FROM commercial_applications WHERE reference='FC-TEST-EXPIRED-000001'"
```

Expect no rows.

### 8. Prove the live row survived

```bash
npx wrangler d1 execute freshcontext-db --remote \
  --command "SELECT reference, purge_after FROM commercial_applications WHERE reference='FC-TEST-SURVIVES-000002'"
```

Expect one row with `purge_after` NULL. This is the assertion that matters most: a
retention sweep that deletes converted matters is worse than one that does not run.

### 9. Remove the synthetic state

```bash
npx wrangler d1 execute freshcontext-db --remote \
  --command "DELETE FROM commercial_applications WHERE reference LIKE 'FC-TEST-%'"

npx wrangler d1 execute freshcontext-db --remote \
  --command "SELECT COUNT(*) AS n FROM commercial_applications"
```

Expect `0`.

### 10. Record the evidence

Capture, in the private commercial workspace rather than here:

- deployed commit SHA and the `wrangler deploy` version id
- migration applied timestamp
- the `PRAGMA table_info` output
- the `application_purge` log line with its `deleted_count`
- step 7 and step 8 query results
- confirmation that step 9 returned to zero

## Rollback

**Before any real application exists** — that is, between this release and Release C:

```bash
# Worker: redeploy the previous commit.
git checkout <previous-sha> && cd worker && npx wrangler deploy

# Table: only while it is provably empty.
npx wrangler d1 execute freshcontext-db --remote \
  --command "SELECT COUNT(*) AS n FROM commercial_applications"   # must be 0
npx wrangler d1 execute freshcontext-db --remote \
  --command "DROP TABLE commercial_applications"
```

**Once any real application exists, dropping the table is forbidden.** Those rows are other
people's personal data submitted in commercial good faith, and a drop is unrecoverable.
Rollback then means redeploying the previous Worker so the sweep stops running, and leaving
the table in place. A retention sweep that has stopped is a documentation problem; a dropped
table is a data-loss incident.

The migration is additive — one table, four indexes, no foreign keys, no change to any
existing table. The verdict ledger is untouched by both the forward and the rollback path.

## Exit criteria

Release A is complete when steps 7, 8 and 9 have all passed against production and the
evidence in step 10 is recorded. Only then may Release B describe the 90-day window as a
control rather than an intention.
