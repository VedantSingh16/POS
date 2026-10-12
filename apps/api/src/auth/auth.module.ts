import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { AuthorizationService } from './authorization.service.js';
import { PermissionsGuard } from './permissions.guard.js';

@Module({
  controllers: [AuthController],
  providers: [AuthService, AuthorizationService, AuthGuard, PermissionsGuard],
  exports: [AuthService, AuthorizationService, AuthGuard, PermissionsGuard],
})
export class AuthModule {}
