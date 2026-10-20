import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service.js';
import { UserContext } from './auth.types.js';
import { PlatformAuthService } from './platform-auth.service.js';

export type AuthenticatedRequest = Request & { user?: UserContext; accessToken?: string };

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly platformAuth: PlatformAuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.header('authorization');
    const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : undefined;
    if (!token) throw new UnauthorizedException('Bearer token is required');

    // POS keeps its existing session tokens for direct sign-in, while a CRM
    // product token is a signed three-part JWT. This lets the product be
    // adopted incrementally without breaking existing tills and API clients.
    request.user = token.split('.').length === 3
      ? await this.platformAuth.authenticateToken(token, request.header('x-tenant-id') ?? undefined)
      : await this.auth.authenticateToken(token);
    request.accessToken = token;
    return true;
  }
}
