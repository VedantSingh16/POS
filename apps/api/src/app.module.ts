import { Module } from '@nestjs/common';
import { createObserveModule } from '@nestjs/observe';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { DatabaseModule } from './database/database.module.js';
import { AuthModule } from './auth/auth.module.js';
import { AdminModule } from './admin/admin.module.js';
import { PosModule } from './pos/pos.module.js';
import { ScheduleModule } from '@nestjs/schedule';

export const { ObserveModule, ObserveInstrument } = createObserveModule();
const observeImports = process.env.OBSERVE_ENABLED === 'true'
  ? [ObserveModule.forRoot({
    appKey: process.env.OBSERVE_APP_KEY ?? '',
    appSecret: process.env.OBSERVE_APP_SECRET ?? '',
    serviceId: 'api',
  })]
  : [];

@Module({
  imports: [
    ...observeImports,
    ScheduleModule.forRoot(),
    DatabaseModule,
    AuthModule,
    AdminModule,
    PosModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
