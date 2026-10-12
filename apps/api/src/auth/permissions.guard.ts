import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthorizationService } from './authorization.service.js';
import { REQUIRED_PERMISSIONS } from './permissions.decorator.js';
import { AuthenticatedRequest } from './auth.guard.js';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authorization: AuthorizationService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const permissions = this.reflector.getAllAndOverride<string[]>(REQUIRED_PERMISSIONS, [context.getHandler(), context.getClass()]) ?? [];
    if (permissions.length === 0) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user) return false;
    const body = request.body as Record<string, unknown> | undefined;
    const query = request.query as Record<string, unknown> | undefined;
    const queryStoreId = typeof query?.storeId === 'string' ? query.storeId : undefined;
    const bodyStoreId = typeof body?.storeId === 'string' ? body.storeId : undefined;
    const paramStoreId = typeof request.params.storeId === 'string' ? request.params.storeId : undefined;
    const headerStoreId = request.header('x-store-id') ?? undefined;
    const storeId = paramStoreId ?? queryStoreId ?? bodyStoreId ?? headerStoreId;
    this.authorization.assertPermissions(request.user, permissions, storeId);
    if (storeId) this.authorization.assertStoreAccess(request.user, storeId);
    return true;
  }
}
