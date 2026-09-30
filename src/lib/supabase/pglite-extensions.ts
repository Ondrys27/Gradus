/**
 * Postgres extensions the migrations create, loaded into the in-process
 * database (PGlite) of the schema tests. Supabase provides them in production.
 */
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { unaccent } from "@electric-sql/pglite/contrib/unaccent";

export const PGLITE_EXTENSIONS = { pg_trgm, unaccent };
