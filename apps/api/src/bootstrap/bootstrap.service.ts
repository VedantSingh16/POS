import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { foundationConfigFromEnv, seedFoundation } from './foundation.js';

/** Provisions the bootstrap organisation and administrator when the API starts. */
@Injectable()
export class BootstrapService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    await seedFoundation(this.prisma, foundationConfigFromEnv());
  }
}
