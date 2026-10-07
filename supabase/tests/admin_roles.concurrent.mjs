/**
 * Two admins demoting each other at the same moment cannot both succeed.
 *
 * admin_set_role() locks every admin row before it looks, then checks the
 * caller is still an admin. Session A demotes B and holds its transaction
 * open; session B, meanwhile, tries to demote A. B must wait for A's lock,
 * then be refused (it is no longer an admin), so A keeps the role and there
 * is always an admin left.
 *
 * Fixtures are committed (other sessions must see them) and removed again,
 * with the audit entries they caused, before and after. Run by
 * `npm run test:db`.
 */
const A = "c9000000-0000-0000-0000-000000000011";
const B = "c9000000-0000-0000-0000-000000000012";

const CLEANUP = `
  delete from public.admin_audit_log where actor_id in ('${A}', '${B}') or row_id in ('${A}', '${B}');
  delete from auth.users where id in ('${A}', '${B}');
`;

const SETUP = `
  insert into auth.users (id, email, raw_user_meta_data) values
    ('${A}', 'p9-race-a@drincup.test', '{"full_name": "Race Admin A"}'),
    ('${B}', 'p9-race-b@drincup.test', '{"full_name": "Race Admin B"}');
  update public.profiles set role = 'admin' where id in ('${A}', '${B}');
`;

const as = (uid) => `select set_config('request.jwt.claims', '{"role":"authenticated","sub":"${uid}"}', false);`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export default async function run({ psql }) {
  const results = [];
  const check = (ok, name, detail) => results.push({ ok, name, detail });

  try {
    await psql(CLEANUP);
    const setup = await psql(SETUP);
    if (setup.status !== 0) throw new Error(`setup failed: ${setup.stderr}`);

    const a = psql(`${as(A)} begin; select public.admin_set_role('${B}', 'customer'); select pg_sleep(2); commit;`);
    await sleep(600);
    const started = Date.now();
    const b = await psql(`\\set VERBOSITY verbose\n${as(B)} select public.admin_set_role('${A}', 'customer');`);
    const waited = Date.now() - started;
    const aResult = await a;

    check(aResult.status === 0, "admin A demotes admin B", aResult.stderr);
    check(b.status !== 0 && /42501/.test(b.stderr), "admin B, demoted meanwhile, is refused (42501)", b.stderr || b.stdout);
    check(waited >= 1000, `admin B waited for A's lock first (${waited} ms)`, `waited ${waited} ms`);
    const roles = (await psql(`select string_agg(role::text, ' ' order by id) from public.profiles where id in ('${A}', '${B}');`)).stdout.trim();
    check(roles === "admin customer", "A is still an admin, B is a customer", `roles = ${roles}`);
  } finally {
    await psql(CLEANUP);
  }

  return results;
}
