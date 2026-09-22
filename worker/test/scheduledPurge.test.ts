import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, test, expect, beforeAll, beforeEach } from "vitest";
import worker from "../src/worker-e2.js";

// ─── Release A: the scheduled retention sweep ─────────────────────────────────
//
// These drive the REAL exported scheduled() handler, not purgeExpiredApplications in
// isolation — applicationIntake.test.ts already proves the function. What was unproven,
// and what Release A actually claims, is that the six-hourly cron INVOKES it.
//
// A test that called the purge directly would pass whether or not the handler was ever
// wired, which is the same shape of false green this session has been eliminating.
//
// Note what the test environment does for free: there is no BROWSER binding and no
// network, so runScheduledScrape fails. That is not a nuisance here, it is the point —
// it is exactly the "unrelated scheduled intelligence work broke" condition under which
// the retention sweep must still run.

const MIGRATION_SQL = env.MIGRATION_0002_SQL as string;

async function applyMigration(db: D1Database, sql: string): Promise<void> {
  const statements = sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const statement of statements) {
    await db.prepare(statement).run();
  }
}

function scheduledController(): ScheduledController {
  return {
    scheduledTime: Date.parse("2026-09-22T00:00:00.000Z"),
    cron: "0 */6 * * *",
    noRetry() {
      /* nothing to do in test */
    },
  } as ScheduledController;
}

/** Runs the real handler and waits for everything it deferred with waitUntil. */
async function runScheduled(): Promise<void> {
  const ctx = createExecutionContext();
  await worker.scheduled(scheduledController(), env as never, ctx);
  await waitOnExecutionContext(ctx);
}

async function seed(reference: string, purgeAfter: string | null): Promise<void> {
  await (env.DB as D1Database)
    .prepare(
      `INSERT INTO commercial_applications
       (reference, service, company, contact_name, contact_email, contact_role,
        workflow, stack, failure_mode, acceptance, timeline, environment,
        sensitivity, authority, acknowledged, received_at, purge_after)
       VALUES (?, 'assessment', 'C', 'N', 'e@x.com', 'R', 'w', 's', 'f', 'a',
               'Within 30 days', 'Staging / test', 'Internal business data',
               'I can approve this engagement', 1, '2026-01-01T00:00:00.000Z', ?)`,
    )
    .bind(reference, purgeAfter)
    .run();
}

async function references(): Promise<string[]> {
  const rows = await (env.DB as D1Database)
    .prepare("SELECT reference FROM commercial_applications ORDER BY reference")
    .all<{ reference: string }>();
  return rows.results.map((r) => r.reference);
}

beforeAll(async () => {
  await applyMigration(env.DB as D1Database, MIGRATION_SQL);
});

beforeEach(async () => {
  await (env.DB as D1Database).exec("DELETE FROM commercial_applications");
});

describe("the six-hourly cron invokes the retention sweep", () => {
  test("an expired unconverted application is deleted by a scheduled run", async () => {
    await seed("FC-APP-20260101-AAAAAA", "2026-04-01T00:00:00.000Z");
    expect(await references()).toHaveLength(1);

    await runScheduled();

    expect(await references()).toEqual([]);
  });

  test("the sweep runs even though the intelligence work in the same handler fails", async () => {
    // There is no BROWSER binding and no outbound network in this environment, so the
    // scrape/briefing block throws and is caught. If the sweep shared that try block it
    // would never run, and this row would survive.
    await seed("FC-APP-20260101-BBBBBB", "2026-04-01T00:00:00.000Z");

    await expect(runScheduled()).resolves.toBeUndefined();

    expect(await references()).toEqual([]);
  });

  test("a converted row with NULL purge_after survives a scheduled run", async () => {
    await seed("FC-APP-20260101-CCCCCC", null);

    await runScheduled();

    expect(await references()).toEqual(["FC-APP-20260101-CCCCCC"]);
  });

  test("a row inside its retention window survives a scheduled run", async () => {
    await seed("FC-APP-20260101-DDDDDD", "2099-01-01T00:00:00.000Z");

    await runScheduled();

    expect(await references()).toEqual(["FC-APP-20260101-DDDDDD"]);
  });

  test("a mixed table loses only what has expired", async () => {
    await seed("FC-APP-20260101-EEEEEE", "2026-04-01T00:00:00.000Z"); // expired
    await seed("FC-APP-20260101-FFFFFF", null); // live matter
    await seed("FC-APP-20260101-999999", "2099-01-01T00:00:00.000Z"); // still in window

    await runScheduled();

    expect(await references()).toEqual(["FC-APP-20260101-999999", "FC-APP-20260101-FFFFFF"]);
  });
});

describe("the sweep fails safely", () => {
  test("a missing table does not throw out of the scheduled handler", async () => {
    // This is the deploy-ordering failure mode: Worker code live, migration not yet
    // applied. It must log and continue, never break the cron for everything else.
    await (env.DB as D1Database).exec("DROP TABLE commercial_applications");

    await expect(runScheduled()).resolves.toBeUndefined();

    // Restore for any later test in this file.
    await applyMigration(env.DB as D1Database, MIGRATION_SQL);
    expect(await references()).toEqual([]);
  });

  test("repeated runs are idempotent and do not touch surviving rows", async () => {
    await seed("FC-APP-20260101-111111", "2026-04-01T00:00:00.000Z");
    await seed("FC-APP-20260101-222222", null);

    await runScheduled();
    await runScheduled();
    await runScheduled();

    expect(await references()).toEqual(["FC-APP-20260101-222222"]);
  });
});
