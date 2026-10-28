import { Global, Module } from '@nestjs/common';

import { resolveDatabaseUrl } from '../config/database-url';
import { PrismaService } from './prisma.service';

// Global so later feature modules (health checks, HA client, ...) can inject
// PrismaService without every one of them re-importing PrismaModule. There is exactly
// one database connection per process by design: SQLite allows a single writer, and a
// second client would silently contend with the first on the same file.
@Global()
@Module({
  providers: [
    {
      provide: PrismaService,
      // A class whose constructor takes a string cannot be auto-injected: Nest would
      // try to resolve a `String` provider. The factory keeps the URL resolution in one
      // place (03-PATTERNS.md D-09) and still lets Nest run the instance's
      // onModuleInit/onModuleDestroy hooks.
      useFactory: (): PrismaService => new PrismaService(resolveDatabaseUrl(process.env)),
    },
  ],
  exports: [PrismaService],
})
export class PrismaModule {}
