import { defineConfig } from 'prisma/config'

// Prisma 7 removed `url` from the schema datasource block (P1012). The connection
// URL for CLI commands (migrate/introspect) now lives here.
//
// Resolution order:
//   1. DATABASE_URL from the environment (CI, container, exported shell var)
//   2. documented local-dev default (docs/14_ENV_AND_DEPLOYMENT.md)
//
// No `dotenv` dependency: Prisma 7 no longer auto-loads `.env`, and we do not want
// to add a package just for the CLI. Export DATABASE_URL, or rely on the default.
//
// Container path (Home Assistant App) is an absolute path on the persistent
// volume: DATABASE_URL=file:/data/homeweave.db — see
// docs/21_HOME_ASSISTANT_APP_DEPLOYMENT.md:105.
const databaseUrl = process.env.DATABASE_URL ?? 'file:./data/app.db'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: databaseUrl,
  },
})
