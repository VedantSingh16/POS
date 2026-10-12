import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';

describe('Authentication foundation (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('logs in the bootstrap organisation administrator and exposes its scoped permissions', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'admin@test.pos', password: 'Test-Admin-Password-2026!' })
      .expect(200);

    expect(login.body.accessToken).toEqual(expect.any(String));
    expect(login.body.user.email).toBe('admin@test.pos');
    expect(login.body.user.isOrganisationAdministrator).toBe(true);
    expect(login.body.user.grants).toEqual(expect.arrayContaining([
      expect.objectContaining({ permissionCode: 'stores.manage' }),
      expect.objectContaining({ permissionCode: 'users.manage' }),
    ]));

    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .expect(200)
      .expect((response) => {
        expect(response.body.user.userId).toBe(login.body.user.userId);
      });
  });

  it('rejects invalid credentials', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'admin@test.pos', password: 'wrong-password' })
      .expect(401);
  });

  it('supports an individual PIN and records authentication activity', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'admin@test.pos', password: 'Test-Admin-Password-2026!' })
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/auth/pin')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .send({ pin: '2468' })
      .expect(204);

    const pinLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'admin@test.pos', pin: '2468' })
      .expect(200);

    expect(pinLogin.body.user.email).toBe('admin@test.pos');
  });

  it('locks repeated failed logins and clears the counter after a valid login', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'admin@test.pos', password: 'wrong-password' })
        .expect(401);
    }
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'admin@test.pos', password: 'Test-Admin-Password-2026!' })
      .expect(401);
  });
});
