import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service.js';
import { UserContext } from './auth.types.js';

export type AuthenticatedRequest = Request & { user?: UserContext; accessToken?: string };

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.header('authorization');
    const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : undefined;
    if (!token) throw new UnauthorizedException('Bearer token is required');

    request.user = await this.auth.authenticateToken(token);
    request.accessToken = token;
    return true;
  }
}
