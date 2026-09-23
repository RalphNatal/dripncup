@AGENTS.md

# Spec

Read `docs/SPEC.md` in full before starting any phase. It is the source of
truth; where its Decisions Log differs from the original sections, the log wins.

# Database migrations

Once the migrations in `supabase/migrations/` have been pushed to a hosted
Supabase project (`npm run db:push` / `supabase db push`), never edit an
existing migration file again. Always add a new, later-timestamped migration
instead. The hosted database records which versions it has applied, so an
edited file is silently skipped there and local and production drift apart.

Until that first push, the migrations have only ever run locally and may still
be edited in place (then `npm run db:reset`).
