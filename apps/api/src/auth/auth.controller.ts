import { BadRequestException, Body, Controller, Get, HttpCode, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from './auth.guard.js';
import type { AuthenticatedRequest } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { AuthorizationService } from './authorization.service.js';
import type { JsonObject } from '../common/input.js';
import type { LoginInput } from './auth.service.js';

@Controller('api/auth')
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly authorization: AuthorizationService) {}

  @Post('login')
  @HttpCode(200)
  login(@Body() body: LoginInput) {
    return this.auth.login(body);
  }

  @Post('organizations/register')
  registerOrganization(@Body() body: JsonObject) {
    return this.auth.registerOrganization(body);
  }

  @Get('me')
  @UseGuards(AuthGuard)
  me(@Req() request: AuthenticatedRequest) {
    return this.authorization.getSessionProfile(request.user!);
  }

  @Post('unlock')
  @HttpCode(204)
  @UseGuards(AuthGuard)
  async unlock(@Req() request: AuthenticatedRequest, @Body() body: JsonObject): Promise<void> {
    await this.auth.verifyPin(request.user!, body.pin);
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(AuthGuard)
  async logout(@Req() request: AuthenticatedRequest): Promise<void> {
    if (request.accessToken) await this.auth.logout(request.accessToken);
  }

  @Post('pin')
  @HttpCode(204)
  @UseGuards(AuthGuard)
  async setPin(@Req() request: AuthenticatedRequest, @Body() body: JsonObject): Promise<void> {
    if (typeof body.pin !== 'string') throw new BadRequestException('PIN is required');
    await this.auth.setPin(request.user!, body.pin);
  }

  @Patch('profile')
  @UseGuards(AuthGuard)
  async profile(@Req() request: AuthenticatedRequest, @Body() body: JsonObject): Promise<void> {
    await this.auth.updateProfile(request.user!, body);
  }
}
