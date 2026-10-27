import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  // Aligns with docs/21_HOME_ASSISTANT_APP_DEPLOYMENT.md (ingress_port: 8099).
  const port = Number(process.env.PORT ?? 8099);
  await app.listen(port, '0.0.0.0');
}

void bootstrap();
