/** Tests only ever use local/CI Postgres, never Neon. */
export function testServerUrl(): string {
  const url = process.env.TEST_DATABASE_URL || "postgres://postgres@localhost:5545";
  if (/neon\.tech/.test(url)) throw new Error("TEST_DATABASE_URL points at Neon; tests must use local Postgres");
  return url;
}

export function dbUrl(name: string): string {
  const u = new URL(testServerUrl());
  u.pathname = `/${name}`;
  return u.toString();
}

export const TEMPLATE_DB = "etm_test_template";
export const workerDbName = (poolId: string | number) => `etm_test_${poolId}`;
