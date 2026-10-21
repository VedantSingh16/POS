import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service.js';
import { UserContext } from './auth.types.js';
import { PlatformAuthService } from './platform-auth.service.js';

export type AuthenticatedRequest = Request & { user?: UserContext; accessToken?: string };

/** Shared till accounts are deliberately confined to the selling surface. Keeping this at the
 * authentication boundary prevents a cashier role accidentally gaining access to an admin route. */
export function isTillRouteAllowed(path: string, method: string): boolean {
  const normalized = path.replace(/\/$/, '');
  if (normalized === '/api/auth/me' || normalized === '/api/auth/logout' || normalized === '/api/auth/unlock') return true;
  if (method === 'GET' && /^\/api\/admin\/stores\/[^/]+\/registers$/.test(normalized)) return true;
  if (!normalized.startsWith('/api/pos/v1/')) return false;
  if (method === 'GET' && /^\/api\/pos\/v1\/(features|catalog\/search|catalog\/top-sellers|catalog\/categories|store-products|stores\/[^/]+\/(lookups|taxonomy|checkout-config|cashiers\/active)|sessions|sessions\/[^/]+\/summary|holds|sales|sales\/[^/]+(?:\/invoice\.pdf)?|returns|returns\/[^/]+|customers|customers\/[^/]+|discount-reasons)$/.test(normalized)) return true;
  if (method === 'POST' && /^\/api\/pos\/v1\/(stores\/[^/]+\/cashiers\/[^/]+\/verify|sessions|sessions\/[^/]+\/(cash|close)|holds|holds\/[^/]+\/resume|sales(?:\/quote)?|approvals|returns|customers|payments\/attempts)$/.test(normalized)) return true;
  if (method === 'GET' && /^\/api\/pos\/v1\/payments\/attempts\/[^/]+$/.test(normalized)) return true;
  if (method === 'POST' && /^\/api\/pos\/v1\/payments\/attempts\/[^/]+\/void$/.test(normalized)) return true;
  return false;
}

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
    if (request.user.accountType === 'STORE_TILL' && !isTillRouteAllowed(request.path || request.url, request.method)) {
      throw new ForbiddenException('Till accounts can only use POS selling surfaces');
    }
    return true;
  }
}
