import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service.js';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('healthz')
  health() { return { status: 'ok', service: 'pos-api', time: new Date().toISOString() }; }

  @Get('readyz')
  ready() { return { status: 'ready', service: 'pos-api', version: 'plan3-mvp' }; }
}
