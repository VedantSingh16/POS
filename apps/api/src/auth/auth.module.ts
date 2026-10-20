import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { AuthorizationService } from './authorization.service.js';
import { PermissionsGuard } from './permissions.guard.js';
import { PlatformAuthService } from './platform-auth.service.js';

@Module({
  controllers: [AuthController],
  providers: [AuthService, AuthorizationService, AuthGuard, PermissionsGuard, PlatformAuthService],
  exports: [AuthService, AuthorizationService, AuthGuard, PermissionsGuard, PlatformAuthService],
})
export class AuthModule {}
