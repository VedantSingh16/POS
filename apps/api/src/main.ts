import { NestFactory } from '@nestjs/core';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { AppModule, ObserveInstrument } from './app.module.js';

if (typeof process.loadEnvFile === 'function') {
  const envCandidates = [resolve(process.cwd(), '.env'), resolve(process.cwd(), '..', '..', '.env')];
  for (const envPath of envCandidates) {
    if (!existsSync(envPath)) continue;
    try {
      process.loadEnvFile(envPath);
    } catch {
      // Environment variables may already be supplied by the host/container.
    }
    break;
  }
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    instrument: ObserveInstrument,
  });
  // Browsers only reach the API through the web app's server-side proxy, so CORS is limited to the web origin(s).
  const webOrigins = (process.env.POS_WEB_ORIGIN ?? 'http://localhost:3100,http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({ origin: webOrigins });
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
