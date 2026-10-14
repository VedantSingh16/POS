import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PosController } from './pos.controller.js';
import { PosService } from './pos.service.js';
import { AlertScheduler } from './alert.scheduler.js';
import { PricingAdminService } from './pricing-admin.service.js';
import { PaymentsService } from './payments/payments.service.js';

@Module({
  imports: [AuthModule],
  controllers: [PosController],
  providers: [PosService, PricingAdminService, PaymentsService, AlertScheduler],
})
export class PosModule {}
