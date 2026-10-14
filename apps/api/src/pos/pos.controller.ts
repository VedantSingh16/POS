import { Body, Controller, Get, Header, Param, Patch, Post, Query, Req, Res, StreamableFile, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard } from '../auth/auth.guard.js';
import type { AuthenticatedRequest } from '../auth/auth.guard.js';
import { PermissionsGuard } from '../auth/permissions.guard.js';
import { RequirePermissions } from '../auth/permissions.decorator.js';
import { PosService } from './pos.service.js';
import { PricingAdminService } from './pricing-admin.service.js';
import { PaymentsService } from './payments/payments.service.js';
import type { JsonObject } from '../common/input.js';

@Controller('api/pos/v1')
@UseGuards(AuthGuard, PermissionsGuard)
export class PosController {
  constructor(
    private readonly pos: PosService,
    private readonly pricing: PricingAdminService,
    private readonly payments: PaymentsService,
  ) {}

  @Get('features') features() { return this.pos.featureStatus(); }

  @Get('overview')
  @RequirePermissions('store.overview.view')
  overview(@Req() request: AuthenticatedRequest, @Query('storeId') storeId?: string) { return this.pos.overview(request.user!, storeId); }

  @Get('catalog/search')
  @RequirePermissions('catalog.view')
  async search(@Req() request: AuthenticatedRequest, @Query('q') query?: string, @Query('storeId') storeId?: string, @Query('limit') limit?: string) {
    const products = await this.pos.searchProducts(request.user!, query, storeId, { limit: limit ? Number(limit) || undefined : undefined });
    return { products, inventoryPolicy: storeId ? await this.pos.inventoryPolicyFor(request.user!.organizationId, storeId) : undefined };
  }

  @Get('catalog/top-sellers')
  @RequirePermissions('catalog.view')
  topSellers(@Req() request: AuthenticatedRequest, @Query('storeId') storeId?: string, @Query('days') days?: string, @Query('limit') limit?: string) { return this.pos.topSellers(request.user!, storeId, days, limit); }

  @Get('catalog/categories')
  @RequirePermissions('catalog.view')
  async categories(@Req() request: AuthenticatedRequest, @Query('storeId') storeId?: string) { return { categories: await this.pos.listCategories(request.user!, storeId) }; }

  @Get('store-products')
  @RequirePermissions('catalog.view')
  async storeProducts(@Req() request: AuthenticatedRequest, @Query('storeId') storeId: string) { return { items: await this.pos.listStoreProducts(request.user!, storeId) }; }

  @Post('store-products')
  @RequirePermissions('catalog.manage.store')
  assignStoreProducts(@Req() request: AuthenticatedRequest, @Body() body: JsonObject) { return this.pos.assignStoreProducts(request.user!, body); }

  @Patch('store-products')
  @RequirePermissions('catalog.manage.store')
  updateStoreProduct(@Req() request: AuthenticatedRequest, @Body() body: JsonObject) { return this.pos.updateStoreProduct(request.user!, body); }

  @Post('stores/:storeId/products')
  @RequirePermissions('catalog.manage.store')
  createStoreProduct(@Req() request: AuthenticatedRequest, @Param('storeId') storeId: string, @Body() body: JsonObject) {
    return this.pos.createStoreProduct(request.user!, storeId, body);
  }

  @Get('stores/:storeId/pending-verification')
  @RequirePermissions('catalog.view')
  async pendingVerification(@Req() request: AuthenticatedRequest, @Param('storeId') storeId: string) {
    return { items: await this.pos.listPendingForStore(request.user!, storeId) };
  }

  @Post('store-products/verify')
  @RequirePermissions('store-catalog.verify')
  verifyStoreProduct(@Req() request: AuthenticatedRequest, @Body() body: JsonObject) {
    return this.pos.verifyPendingItem(request.user!, body);
  }

  @Get('distributions')
  @RequirePermissions('catalog.distribute')
  async distributions(@Req() request: AuthenticatedRequest) {
    return { distributions: await this.pos.listDistributions(request.user!) };
  }

  @Post('distributions')
  @RequirePermissions('catalog.distribute')
  createDistribution(@Req() request: AuthenticatedRequest, @Body() body: JsonObject) {
    return this.pos.createDistribution(request.user!, body);
  }

  @Post('distributions/:id/dispatch')
  @RequirePermissions('catalog.distribute')
  dispatchDistribution(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.pos.dispatchDistribution(request.user!, id);
  }

  @Get('sessions')
  @RequirePermissions('registers.view')
  async sessions(@Req() request: AuthenticatedRequest, @Query('storeId') storeId?: string) { return { sessions: await this.pos.listSessions(request.user!, storeId) }; }

  @Post('sessions')
  @RequirePermissions('register.open')
  openSession(@Req() request: AuthenticatedRequest, @Body() body: JsonObject) { return this.pos.openSession(request.user!, body); }

  @Get('sessions/:sessionId/summary')
  sessionSummary(@Req() request: AuthenticatedRequest, @Param('sessionId') sessionId: string) { return this.pos.sessionSummary(request.user!, sessionId); }

  @Post('sessions/:sessionId/cash')
  cash(@Req() request: AuthenticatedRequest, @Param('sessionId') sessionId: string, @Body() body: JsonObject) { return this.pos.cashMovement(request.user!, sessionId, body); }

  @Post('sessions/:sessionId/close')
  close(@Req() request: AuthenticatedRequest, @Param('sessionId') sessionId: string, @Body() body: JsonObject) { return this.pos.closeSession(request.user!, sessionId, body); }

  @Get('attendance')
  async attendance(@Req() request: AuthenticatedRequest, @Query('storeId') storeId: string) { return { attendance: await this.pos.attendance(request.user!, storeId) }; }

  @Post('attendance/clock-in')
  @RequirePermissions('attendance.clock')
  clockIn(@Req() request: AuthenticatedRequest, @Body() body: JsonObject) { return this.pos.clockIn(request.user!, body); }

  @Post('attendance/clock-out')
  @RequirePermissions('attendance.clock')
  clockOut(@Req() request: AuthenticatedRequest, @Body() body: JsonObject) { return this.pos.clockOut(request.user!, body); }

  @Get('day-closes')
  @RequirePermissions('report.view')
  async dayCloses(@Req() request: AuthenticatedRequest, @Query('storeId') storeId: string) { return { dayCloses: await this.pos.listDayCloses(request.user!, storeId) }; }

  @Post('day-closes')
  @RequirePermissions('dayclose.manage')
  closeDay(@Req() request: AuthenticatedRequest, @Body() body: JsonObject) { return this.pos.closeStoreDay(request.user!, body); }

  @Post('reports/exports')
  @RequirePermissions('report.export')
  createReportExport(@Req() request: AuthenticatedRequest, @Body() body: JsonObject) { return this.pos.createReportExport(request.user!, body); }

  @Get('reports/exports/:jobId')
  reportExportStatus(@Req() request: AuthenticatedRequest, @Param('jobId') jobId: string) { return this.pos.getReportExport(request.user!, jobId); }

  @Post('reports/exports/:jobId/retry')
  retryReportExport(@Req() request: AuthenticatedRequest, @Param('jobId') jobId: string) { return this.pos.retryReportExport(request.user!, jobId); }

  @Get('reports/exports/:jobId/download')
  async downloadReportExport(@Req() request: AuthenticatedRequest, @Param('jobId') jobId: string, @Res({ passthrough: true }) response: Response) {
    const file = await this.pos.downloadReportExport(request.user!, jobId);
    response.set({ 'Content-Type': file.contentType, 'Content-Disposition': `attachment; filename="${file.filename}"`, 'Cache-Control': 'no-store' });
    return new StreamableFile(file.buffer);
  }

  @Get('holds')
  @RequirePermissions('sale.hold')
  async holds(@Req() request: AuthenticatedRequest, @Query('storeId') storeId?: string) { return { holds: await this.pos.listHeldSales(request.user!, storeId) }; }

  @Post('holds')
  @RequirePermissions('sale.hold')
  hold(@Req() request: AuthenticatedRequest, @Body() body: JsonObject) { return this.pos.holdSale(request.user!, body); }

  @Post('holds/:holdId/resume')
  resume(@Req() request: AuthenticatedRequest, @Param('holdId') holdId: string) { return this.pos.resumeHold(request.user!, holdId); }

  @Get('stores/:storeId/lookups')
  @RequirePermissions('catalog.view')
  catalogLookups(@Req() request: AuthenticatedRequest, @Param('storeId') storeId: string) { return this.pos.catalogLookups(request.user!, storeId); }

  @Get('stores/:storeId/taxonomy')
  @RequirePermissions('catalog.view')
  storeTaxonomy(@Req() request: AuthenticatedRequest, @Param('storeId') storeId: string) { return this.pos.storeTaxonomy(request.user!, storeId); }

  @Get('stores/:storeId/checkout-config')
  @RequirePermissions('sale.create')
  checkoutConfig(@Req() request: AuthenticatedRequest, @Param('storeId') storeId: string) { return this.pos.checkoutConfig(request.user!, storeId); }

  @Post('sales/quote')
  @RequirePermissions('sale.create')
  quote(@Req() request: AuthenticatedRequest, @Body() body: JsonObject) { return this.pos.quoteSale(request.user!, body); }

  @Get('tax-groups')
  @RequirePermissions('catalog.view')
  async taxGroups(@Req() request: AuthenticatedRequest, @Query('storeId') storeId?: string) { return { taxGroups: await this.pos.listTaxGroups(request.user!, storeId) }; }

  @Post('tax-groups')
  @RequirePermissions('tax.manage')
  createStoreTaxGroup(@Req() request: AuthenticatedRequest, @Body() body: JsonObject) { return this.pos.createStoreTaxGroup(request.user!, body); }

  @Patch('tax-groups/:taxGroupId')
  @RequirePermissions('tax.manage')
  updateStoreTaxGroup(@Req() request: AuthenticatedRequest, @Param('taxGroupId') taxGroupId: string, @Body() body: JsonObject) { return this.pos.updateStoreTaxGroup(request.user!, taxGroupId, body); }

  @Get('charges')
  @RequirePermissions('pricing.view')
  async charges(@Req() request: AuthenticatedRequest, @Query('storeId') storeId?: string) { return { charges: await this.pos.listCharges(request.user!, storeId) }; }

  @Post('charges')
  @RequirePermissions('pricing.manage')
  createCharge(@Req() request: AuthenticatedRequest, @Body() body: JsonObject) { return this.pos.createCharge(request.user!, body); }

  @Patch('charges/:chargeId')
  @RequirePermissions('pricing.manage')
  updateCharge(@Req() request: AuthenticatedRequest, @Param('chargeId') chargeId: string, @Body() body: JsonObject) { return this.pos.updateCharge(request.user!, chargeId, body); }

  @Post('sales')
  @RequirePermissions('sale.create')
  sale(@Req() request: AuthenticatedRequest, @Body() body: JsonObject) { return this.pos.completeSale(request.user!, body); }

  @Get('sales')
  @RequirePermissions('sale.view')
  async sales(@Req() request: AuthenticatedRequest, @Query('storeId') storeId?: string, @Query('from') from?: string, @Query('to') to?: string, @Query('receipt') receipt?: string, @Query('customer') customer?: string) {
    return { sales: await this.pos.listSales(request.user!, storeId, from, to, receipt, customer) };
  }

  @Get('sales/:saleId/invoice.pdf')
  async invoicePdf(@Req() request: AuthenticatedRequest, @Param('saleId') saleId: string, @Res({ passthrough: true }) response: Response) {
    const { filename, buffer } = await this.pos.invoicePdf(request.user!, saleId);
    response.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${filename}"`, 'Cache-Control': 'no-store' });
    return new StreamableFile(buffer);
  }

  @Get('sales/:saleId')
  saleDetail(@Req() request: AuthenticatedRequest, @Param('saleId') saleId: string) { return this.pos.getSale(request.user!, saleId); }

  @Post('approvals')
  @RequirePermissions('approval.request')
  requestApproval(@Req() request: AuthenticatedRequest, @Body() body: JsonObject) { return this.pos.requestApproval(request.user!, body); }

  @Patch('approvals/:approvalId')
  decideApproval(@Req() request: AuthenticatedRequest, @Param('approvalId') approvalId: string, @Body() body: JsonObject) { return this.pos.decideApproval(request.user!, approvalId, body); }

  @Get('approvals')
  @RequirePermissions('approval.manage')
  async approvals(@Req() request: AuthenticatedRequest, @Query('storeId') storeId?: string) { return { approvals: await this.pos.listApprovals(request.user!, storeId) }; }

  @Get('inventory')
  @RequirePermissions('inventory.view')
  inventory(@Req() request: AuthenticatedRequest, @Query('storeId') storeId?: string) { return this.pos.inventory(request.user!, storeId); }

  @Get('inventory/ledger')
  @RequirePermissions('inventory.view')
  async ledger(@Req() request: AuthenticatedRequest, @Query('storeId') storeId?: string) { return { movements: await this.pos.ledger(request.user!, storeId) }; }

  @Post('inventory/adjustments')
  @RequirePermissions('inventory.manage')
  adjustment(@Req() request: AuthenticatedRequest, @Body() body: JsonObject) { return this.pos.adjustInventory(request.user!, body); }

  @Patch('inventory/thresholds')
  @RequirePermissions('inventory.manage')
  thresholds(@Req() request: AuthenticatedRequest, @Body() body: JsonObject) { return this.pos.setInventoryThresholds(request.user!, body); }

  @Post('inventory/rebuild')
  @RequirePermissions('inventory.manage')
  rebuildInventory(@Req() request: AuthenticatedRequest, @Query('storeId') storeId?: string) { return this.pos.rebuildInventory(request.user!, storeId); }

  @Post('inventory/opening-stock/preview')
  @RequirePermissions('inventory.manage')
  openingStockPreview(@Req() request: AuthenticatedRequest, @Body() body: JsonObject) { return this.pos.previewOpeningStock(request.user!, body); }

  @Post('inventory/opening-stock/commit')
  @RequirePermissions('inventory.manage')
  openingStockCommit(@Req() request: AuthenticatedRequest, @Body() body: JsonObject) { return this.pos.commitOpeningStock(request.user!, body); }

  @Get('locations')
  @RequirePermissions('inventory.view')
  async locations(@Req() request: AuthenticatedRequest, @Query('storeId') storeId?: string) { return { locations: await this.pos.listLocations(request.user!, storeId) }; }

  @Post('locations')
  @RequirePermissions('inventory.manage')
  location(@Req() request: AuthenticatedRequest, @Body() body: JsonObject) { return this.pos.createLocation(request.user!, body); }

  @Post('returns')
  @RequirePermissions('refund.create')
  returns(@Req() request: AuthenticatedRequest, @Body() body: JsonObject) { return this.pos.createReturn(request.user!, body); }

  @Get('returns')
  @RequirePermissions('refund.view')
  async returnList(@Req() request: AuthenticatedRequest, @Query('storeId') storeId?: string) { return { returns: await this.pos.listReturns(request.user!, storeId) }; }

  @Get('returns/:returnId')
  returnDetail(@Req() request: AuthenticatedRequest, @Param('returnId') returnId: string) { return this.pos.getReturn(request.user!, returnId); }

  @Get('reports')
  @RequirePermissions('report.view')
  reports(@Req() request: AuthenticatedRequest, @Query('from') from?: string, @Query('to') to?: string, @Query('storeId') storeId?: string, @Query('registerId') registerId?: string, @Query('cashierId') cashierId?: string) {
    return this.pos.reports(request.user!, from, to, storeId, registerId, cashierId);
  }

  @Get('reports/export')
  @RequirePermissions('report.export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="pos-report.csv"')
  reportExport(@Req() request: AuthenticatedRequest, @Query('from') from?: string, @Query('to') to?: string, @Query('storeId') storeId?: string, @Query('registerId') registerId?: string, @Query('cashierId') cashierId?: string) {
    return this.pos.reportCsv(request.user!, from, to, storeId, registerId, cashierId);
  }

  @Get('alerts')
  @RequirePermissions('report.view')
  async alerts(@Req() request: AuthenticatedRequest, @Query('storeId') storeId?: string) { return { alerts: await this.pos.alerts(request.user!, storeId) }; }

  @Patch('alerts/:alertId')
  acknowledgeAlert(@Req() request: AuthenticatedRequest, @Param('alertId') alertId: string, @Body() body: JsonObject = {}) { return this.pos.acknowledgeAlert(request.user!, alertId, body); }

  @Get('customers')
  @RequirePermissions('customer.view')
  async customers(@Req() request: AuthenticatedRequest, @Query('storeId') storeId?: string) { return { customers: await this.pos.listCustomers(request.user!, storeId) }; }

  @Get('customers/:customerId')
  @RequirePermissions('customer.view')
  customerDetail(@Req() request: AuthenticatedRequest, @Param('customerId') customerId: string, @Query('storeId') storeId?: string) { return this.pos.getCustomer(request.user!, customerId, storeId); }

  @Post('customers')
  @RequirePermissions('customer.manage')
  customer(@Req() request: AuthenticatedRequest, @Body() body: JsonObject) { return this.pos.createCustomer(request.user!, body); }

  @Patch('customers/:customerId')
  @RequirePermissions('customer.manage')
  customerUpdate(@Req() request: AuthenticatedRequest, @Param('customerId') customerId: string, @Body() body: JsonObject) { return this.pos.updateCustomer(request.user!, customerId, body); }

  @Post('customers/:customerId/ledger')
  @RequirePermissions('customer.manage')
  customerLedger(@Req() request: AuthenticatedRequest, @Param('customerId') customerId: string, @Body() body: JsonObject) { return this.pos.customerLedger(request.user!, customerId, body); }

  @Get('promotions')
  @RequirePermissions('pricing.view')
  async promotions(@Req() request: AuthenticatedRequest, @Query('storeId') storeId?: string) { return { promotions: await this.pos.listPromotions(request.user!, storeId) }; }

  @Post('promotions')
  @RequirePermissions('pricing.manage')
  promotion(@Req() request: AuthenticatedRequest, @Body() body: JsonObject) { return this.pos.createPromotion(request.user!, body); }

  @Patch('promotions/:promotionId')
  @RequirePermissions('pricing.manage')
  promotionUpdate(@Req() request: AuthenticatedRequest, @Param('promotionId') promotionId: string, @Body() body: JsonObject) { return this.pricing.updatePromotion(request.user!, promotionId, body); }

  @Get('price-rules')
  @RequirePermissions('pricing.view')
  async priceRules(@Req() request: AuthenticatedRequest, @Query('storeId') storeId?: string) { return { rules: await this.pricing.listPriceRules(request.user!, storeId) }; }

  @Post('price-rules')
  @RequirePermissions('pricing.manage')
  priceRule(@Req() request: AuthenticatedRequest, @Body() body: JsonObject) { return this.pricing.createPriceRule(request.user!, body); }

  @Patch('price-rules/:ruleId')
  @RequirePermissions('pricing.manage')
  priceRuleUpdate(@Req() request: AuthenticatedRequest, @Param('ruleId') ruleId: string, @Body() body: JsonObject) { return this.pricing.updatePriceRule(request.user!, ruleId, body); }

  /** With ?storeId= a till reads the active reasons; without it an administrator lists all of them. The service checks the permission. */
  @Get('discount-reasons')
  async discountReasons(@Req() request: AuthenticatedRequest, @Query('storeId') storeId?: string) { return { reasons: await this.pricing.listDiscountReasons(request.user!, storeId) }; }

  @Post('discount-reasons')
  @RequirePermissions('pricing.manage')
  discountReason(@Req() request: AuthenticatedRequest, @Body() body: JsonObject) { return this.pricing.createDiscountReason(request.user!, body); }

  @Patch('discount-reasons/:reasonId')
  @RequirePermissions('pricing.manage')
  discountReasonUpdate(@Req() request: AuthenticatedRequest, @Param('reasonId') reasonId: string, @Body() body: JsonObject) { return this.pricing.updateDiscountReason(request.user!, reasonId, body); }

  @Post('payments/attempts')
  @RequirePermissions('sale.create')
  paymentAttempt(@Req() request: AuthenticatedRequest, @Body() body: JsonObject) { return this.payments.createAttempt(request.user!, body); }

  @Get('payments/attempts/:attemptId')
  paymentAttemptStatus(@Req() request: AuthenticatedRequest, @Param('attemptId') attemptId: string) { return this.payments.refreshAttempt(request.user!, attemptId); }

  @Post('payments/attempts/:attemptId/void')
  paymentAttemptVoid(@Req() request: AuthenticatedRequest, @Param('attemptId') attemptId: string) { return this.payments.voidAttempt(request.user!, attemptId); }

  @Get('bundles')
  @RequirePermissions('promotion.manage')
  async bundles(@Req() request: AuthenticatedRequest) { return { bundles: await this.pos.listBundles(request.user!) }; }

  @Post('bundles')
  @RequirePermissions('promotion.manage')
  bundle(@Req() request: AuthenticatedRequest, @Body() body: JsonObject) { return this.pos.createBundle(request.user!, body); }

  @Get('transfers')
  @RequirePermissions('transfer.manage')
  async transfers(@Req() request: AuthenticatedRequest) { return { transfers: await this.pos.listTransfers(request.user!) }; }

  @Post('transfers')
  @RequirePermissions('transfer.manage')
  transfer(@Req() request: AuthenticatedRequest, @Body() body: JsonObject) { return this.pos.createTransfer(request.user!, body); }

  @Patch('transfers/:transferId')
  @RequirePermissions('transfer.manage')
  transferStatus(@Req() request: AuthenticatedRequest, @Param('transferId') transferId: string, @Body() body: JsonObject) { return this.pos.updateTransfer(request.user!, transferId, body); }

  @Post('demo/seed')
  @RequirePermissions('catalog.manage')
  seed(@Req() request: AuthenticatedRequest) { return this.pos.seedDemo(request.user!); }
}
