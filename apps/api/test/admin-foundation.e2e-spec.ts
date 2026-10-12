import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';

describe('Organisation Administrator foundation (e2e)', () => {
  let app: INestApplication;
  let token: string;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'admin@test.pos', password: 'Test-Admin-Password-2026!' })
      .expect(200);
    token = login.body.accessToken;
  });

  afterEach(async () => {
    await app.close();
  });

  it('enforces the platform store limit and creates registers', async () => {
    const first = await request(app.getHttpServer())
      .post('/api/admin/stores')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: 'MUM', name: 'Mumbai Store' })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/admin/stores')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: 'DEL', name: 'Delhi Store' })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/admin/stores')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: 'BLR', name: 'Bengaluru Store' })
      .expect(409);

    const register = await request(app.getHttpServer())
      .post(`/api/admin/stores/${first.body.id}/registers`)
      .set('Authorization', `Bearer ${token}`)
      .send({ code: 'REG-01', name: 'Front Register' })
      .expect(201);

    expect(register.body.storeId).toBe(first.body.id);

    const overview = await request(app.getHttpServer())
      .get('/api/admin/overview')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(overview.body.entitlement).toMatchObject({ maxStores: 2, currentStores: 2, remainingStores: 0 });

    const audit = await request(app.getHttpServer())
      .get('/api/admin/audit')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(audit.body.audit.some((entry: { action: string }) => entry.action === 'store.created')).toBe(true);
  });

  it('manages roles, users and the organisation catalogue', async () => {
    const store = await request(app.getHttpServer())
      .post('/api/admin/stores')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: 'MUM', name: 'Mumbai Store' })
      .expect(201);

    const roles = await request(app.getHttpServer())
      .get('/api/admin/roles')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const cashier = roles.body.roles.find((role: { name: string }) => role.name === 'Cashier');

    const user = await request(app.getHttpServer())
      .post('/api/admin/users')
      .set('Authorization', `Bearer ${token}`)
      .send({
        email: 'cashier@test.pos',
        password: 'Cashier-Password-2026!',
        firstName: 'Front',
        lastName: 'Cashier',
        roleIds: [cashier.id],
        storeIds: [store.body.id],
      })
      .expect(201);
    expect(user.body.storeIds).toEqual([store.body.id]);

    const category = await request(app.getHttpServer())
      .post('/api/admin/catalog/categories')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Beverages' })
      .expect(201);

    const uom = await request(app.getHttpServer())
      .post('/api/admin/catalog/uoms')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: 'PCS', name: 'Piece' })
      .expect(201);

    const tax = await request(app.getHttpServer())
      .post('/api/admin/catalog/tax-groups')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: 'GST18', name: 'GST 18%', ratePercent: 18 })
      .expect(201);

    const product = await request(app.getHttpServer())
      .post('/api/admin/catalog/products')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'POS Mug', categoryId: category.body.id })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/admin/catalog/products/${product.body.id}/variants`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        sku: 'MUG-001',
        name: 'POS Mug Standard',
        uomId: uom.body.id,
        taxGroupId: tax.body.id,
        barcode: '890000000001',
        amountCents: 11800,
        includesTax: true,
      })
      .expect(201);

    const products = await request(app.getHttpServer())
      .get('/api/admin/catalog/products')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(products.body.products[0].variants[0].prices[0]).toMatchObject({ amountCents: 11800, includesTax: true });
  });

  it('protects administrative routes and preserves the last administrator', async () => {
    await request(app.getHttpServer())
      .get('/api/admin/overview')
      .expect(401);

    const me = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/api/admin/users/${me.body.user.userId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'DISABLED' })
      .expect(409);
  });
});
