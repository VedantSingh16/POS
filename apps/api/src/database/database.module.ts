import { Global, Module } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { BootstrapService } from '../bootstrap/bootstrap.service.js';
import { PrismaService } from './prisma.service.js';

@Global()
@Module({
  providers: [PrismaService, AuditService, BootstrapService],
  exports: [PrismaService, AuditService],
})
export class DatabaseModule {}
