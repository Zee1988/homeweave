import { Module } from '@nestjs/common';

// Controllers, providers and adapters are added by later phases.
// This module intentionally stays empty: it only proves the build and the
// startup path that the container image depends on.
@Module({})
export class AppModule {}
