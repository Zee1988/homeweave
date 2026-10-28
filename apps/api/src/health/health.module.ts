import { Module } from '@nestjs/common';

import { HealthController } from './health.controller';

// HealthModule does not import PrismaModule even though PrismaModule is @Global(): the
// liveness route has no dependencies at all, and 03-04's readiness checks will receive
// their data through explicit providers rather than reaching into the global client.
@Module({
  controllers: [HealthController],
})
export class HealthModule {}
