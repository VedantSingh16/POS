import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Tx } from '../database/db.js';

type Actor = { organizationId: string; userId: string | null };

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /** Appends an audit entry. Pass `tx` to make it part of the caller's transaction. */
  async record(
    actor: Actor,
    action: string,
    entityType: string,
    entityId: string | null,
    metadata: Record<string, unknown> = {},
    tx?: Tx,
  ): Promise<void> {
    await (tx ?? this.prisma).auditLog.create({
      data: {
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        action,
        entityType,
        entityId,
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
  }
}
