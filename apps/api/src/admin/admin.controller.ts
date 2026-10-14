import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import type { AuthenticatedRequest } from '../auth/auth.guard.js';
import { PermissionsGuard } from '../auth/permissions.guard.js';
import { RequirePermissions } from '../auth/permissions.decorator.js';
import { AdminService } from './admin.service.js';
import type { JsonObject } from '../common/input.js';

@Controller('api/admin')
@UseGuards(AuthGuard, PermissionsGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('overview')
  @RequirePermissions('org.overview.view')
  overview(@Req() request: AuthenticatedRequest) {
    return this.admin.getOverview(request.user!);
  }

  @Patch('organization')
  @RequirePermissions('org.settings.manage')
  updateOrganization(@Req() request: AuthenticatedRequest, @Body() body: JsonObject) {
    return this.admin.updateOrganization(request.user!, body);
  }

  @Get('settings')
  @RequirePermissions('org.settings.manage')
  settings(@Req() request: AuthenticatedRequest) {
    return this.admin.getSettings(request.user!, true);
  }

  @Patch('settings')
  @RequirePermissions('org.settings.manage')
  updateSettings(@Req() request: AuthenticatedRequest, @Body() body: JsonObject) {
    return this.admin.updateSettings(request.user!, body);
  }

  @Get('approval-policy')
  @RequirePermissions('org.settings.manage')
  approvalPolicy(@Req() request: AuthenticatedRequest) {
    return this.admin.getApprovalPolicy(request.user!);
  }

  @Put('approval-policy')
  @RequirePermissions('org.settings.manage')
  updateApprovalPolicy(@Req() request: AuthenticatedRequest, @Body() body: JsonObject) {
    return this.admin.updateApprovalPolicy(request.user!, body);
  }

  @Get('audit')
  @RequirePermissions('audit.view')
  async audit(@Req() request: AuthenticatedRequest) {
    return { audit: await this.admin.listAuditLogs(request.user!) };
  }

  @Get('onboarding')
  @RequirePermissions('org.settings.manage')
  onboarding(@Req() request: AuthenticatedRequest) {
    return this.admin.getOnboarding(request.user!);
  }

  @Patch('onboarding')
  @RequirePermissions('org.settings.manage')
  updateOnboarding(@Req() request: AuthenticatedRequest, @Body() body: JsonObject) {
    return this.admin.updateOnboarding(request.user!, body);
  }

  @Post('onboarding/required')
  @RequirePermissions('org.settings.manage')
  completeRequiredOnboarding(@Req() request: AuthenticatedRequest, @Body() body: JsonObject) {
    return this.admin.completeRequiredOnboarding(request.user!, body);
  }

  @Post('onboarding/skip-optional')
  @RequirePermissions('org.settings.manage')
  skipOptionalOnboarding(@Req() request: AuthenticatedRequest) {
    return this.admin.skipOptionalOnboarding(request.user!);
  }

  @Post('onboarding/stores')
  @RequirePermissions('org.settings.manage')
  saveOnboardingStores(@Req() request: AuthenticatedRequest, @Body() body: JsonObject) {
    return this.admin.saveOnboardingStores(request.user!, body);
  }

  @Post('onboarding/managers')
  @RequirePermissions('org.settings.manage')
  saveOnboardingManagers(@Req() request: AuthenticatedRequest, @Body() body: JsonObject) {
    return this.admin.saveOnboardingManagers(request.user!, body);
  }

  @Post('onboarding/finish')
  @RequirePermissions('org.settings.manage')
  finishOnboarding(@Req() request: AuthenticatedRequest) {
    return this.admin.finishOnboarding(request.user!);
  }

  @Get('permission-groups')
  @RequirePermissions('roles.view')
  async permissionGroups() {
    return { groups: await this.admin.listPermissionGroups() };
  }

  @Get('users')
  @RequirePermissions('users.view')
  async users(@Req() request: AuthenticatedRequest) {
    return { users: await this.admin.listUsers(request.user!) };
  }

  @Post('users')
  @RequirePermissions('users.manage')
  createUser(@Req() request: AuthenticatedRequest, @Body() body: JsonObject) {
    return this.admin.createUser(request.user!, body);
  }

  @Patch('users/:userId')
  @RequirePermissions('users.manage')
  updateUser(@Req() request: AuthenticatedRequest, @Param('userId') userId: string, @Body() body: JsonObject) {
    return this.admin.updateUser(request.user!, userId, body);
  }

  @Get('users/:userId')
  @RequirePermissions('users.view')
  user(@Req() request: AuthenticatedRequest, @Param('userId') userId: string) {
    return this.admin.getUser(request.user!, userId);
  }

  @Get('users/:userId/effective-access')
  @RequirePermissions('users.view')
  effectiveAccess(@Req() request: AuthenticatedRequest, @Param('userId') userId: string) {
    return this.admin.effectiveAccess(request.user!, userId);
  }

  @Get('roles')
  @RequirePermissions('roles.view')
  async roles(@Req() request: AuthenticatedRequest) {
    return { roles: await this.admin.listRoles(request.user!) };
  }

  @Get('roles/:roleId')
  @RequirePermissions('roles.view')
  role(@Req() request: AuthenticatedRequest, @Param('roleId') roleId: string) {
    return this.admin.getRole(request.user!, roleId);
  }

  @Post('roles')
  @RequirePermissions('roles.manage')
  createRole(@Req() request: AuthenticatedRequest, @Body() body: JsonObject) {
    return this.admin.createRole(request.user!, body);
  }

  @Patch('roles/:roleId')
  @RequirePermissions('roles.manage')
  updateRole(@Req() request: AuthenticatedRequest, @Param('roleId') roleId: string, @Body() body: JsonObject) {
    return this.admin.updateRole(request.user!, roleId, body);
  }

  @Get('stores')
  @RequirePermissions('stores.view')
  async stores(@Req() request: AuthenticatedRequest) {
    return { stores: await this.admin.listStores(request.user!) };
  }

  @Get('stores/:storeId')
  @RequirePermissions('stores.view')
  store(@Req() request: AuthenticatedRequest, @Param('storeId') storeId: string) {
    return this.admin.getStoreForContext(request.user!, storeId);
  }

  @Post('stores')
  @RequirePermissions('stores.manage')
  createStore(@Req() request: AuthenticatedRequest, @Body() body: JsonObject) {
    return this.admin.createStore(request.user!, body);
  }

  @Patch('stores/:storeId')
  updateStore(@Req() request: AuthenticatedRequest, @Param('storeId') storeId: string, @Body() body: JsonObject) {
    return this.admin.updateStore(request.user!, storeId, body);
  }

  @Get('stores/:storeId/settings')
  @RequirePermissions('store.settings.view')
  storeSettings(@Req() request: AuthenticatedRequest, @Param('storeId') storeId: string) {
    return this.admin.getStoreSettings(request.user!, storeId);
  }

  @Patch('stores/:storeId/settings')
  @RequirePermissions('store.settings.manage')
  updateStoreSettings(@Req() request: AuthenticatedRequest, @Param('storeId') storeId: string, @Body() body: JsonObject) {
    return this.admin.updateStoreSettings(request.user!, storeId, body);
  }

  @Get('stores/:storeId/users')
  @RequirePermissions('store.staff.view')
  async storeStaff(@Req() request: AuthenticatedRequest, @Param('storeId') storeId: string) {
    return { users: await this.admin.listStoreStaff(request.user!, storeId) };
  }

  @Get('stores/:storeId/assignable-roles')
  @RequirePermissions('store.staff.manage')
  async storeAssignableRoles(@Req() request: AuthenticatedRequest, @Param('storeId') storeId: string) {
    return { roles: await this.admin.listStoreAssignableRoles(request.user!, storeId) };
  }

  @Patch('stores/:storeId/users/:userId/role')
  @RequirePermissions('store.staff.manage')
  assignStoreRole(@Req() request: AuthenticatedRequest, @Param('storeId') storeId: string, @Param('userId') userId: string, @Body() body: JsonObject) {
    return this.admin.assignStoreRole(request.user!, storeId, userId, body);
  }

  @Get('registers')
  @RequirePermissions('registers.view')
  async registers(@Req() request: AuthenticatedRequest) {
    return { registers: await this.admin.listRegisters(request.user!) };
  }

  @Get('stores/:storeId/registers')
  @RequirePermissions('registers.view')
  async storeRegisters(@Req() request: AuthenticatedRequest, @Param('storeId') storeId: string) {
    return { registers: await this.admin.listRegisters(request.user!, storeId) };
  }

  @Post('stores/:storeId/registers')
  createRegister(@Req() request: AuthenticatedRequest, @Param('storeId') storeId: string, @Body() body: JsonObject) {
    return this.admin.createRegister(request.user!, storeId, body);
  }

  @Patch('registers/:registerId')
  updateRegister(@Req() request: AuthenticatedRequest, @Param('registerId') registerId: string, @Body() body: JsonObject) {
    return this.admin.updateRegister(request.user!, registerId, body);
  }

  @Get('catalog/categories')
  @RequirePermissions('catalog.view')
  async categories(@Req() request: AuthenticatedRequest) {
    return { categories: await this.admin.listCategories(request.user!) };
  }

  @Post('catalog/categories')
  @RequirePermissions('catalog.manage')
  createCategory(@Req() request: AuthenticatedRequest, @Body() body: JsonObject) {
    return this.admin.createCategory(request.user!, body);
  }

  @Get('catalog/uoms')
  @RequirePermissions('catalog.view')
  async uoms(@Req() request: AuthenticatedRequest) {
    return { units: await this.admin.listUoms(request.user!) };
  }

  @Post('catalog/uoms')
  @RequirePermissions('catalog.manage')
  createUom(@Req() request: AuthenticatedRequest, @Body() body: JsonObject) {
    return this.admin.createUom(request.user!, body);
  }

  @Get('catalog/products')
  @RequirePermissions('catalog.view')
  async products(@Req() request: AuthenticatedRequest) {
    return { products: await this.admin.listProducts(request.user!) };
  }

  @Get('catalog/brands')
  @RequirePermissions('catalog.view')
  async brands(@Req() request: AuthenticatedRequest) {
    return { brands: await this.admin.listBrands(request.user!) };
  }

  @Post('catalog/brands')
  @RequirePermissions('catalog.manage')
  createBrand(@Req() request: AuthenticatedRequest, @Body() body: JsonObject) {
    return this.admin.createBrand(request.user!, body);
  }

  @Patch('catalog/brands/:brandId')
  @RequirePermissions('catalog.manage')
  updateBrand(@Req() request: AuthenticatedRequest, @Param('brandId') brandId: string, @Body() body: JsonObject) {
    return this.admin.updateBrand(request.user!, brandId, body);
  }

  @Delete('catalog/brands/:brandId')
  @RequirePermissions('catalog.manage')
  deleteBrand(@Req() request: AuthenticatedRequest, @Param('brandId') brandId: string) {
    return this.admin.deleteBrand(request.user!, brandId);
  }

  @Get('catalog/product-types')
  @RequirePermissions('catalog.view')
  async productTypes(@Req() request: AuthenticatedRequest) { return { types: await this.admin.listProductTypes(request.user!) }; }

  @Post('catalog/product-types')
  @RequirePermissions('catalog.manage')
  createProductType(@Req() request: AuthenticatedRequest, @Body() body: JsonObject) { return this.admin.createProductType(request.user!, body); }

  @Patch('catalog/product-types/:typeId')
  @RequirePermissions('catalog.manage')
  updateProductType(@Req() request: AuthenticatedRequest, @Param('typeId') typeId: string, @Body() body: JsonObject) { return this.admin.updateProductType(request.user!, typeId, body); }

  @Get('catalog/products/:productId')
  @RequirePermissions('catalog.view')
  product(@Req() request: AuthenticatedRequest, @Param('productId') productId: string) {
    return this.admin.getProduct(request.user!, productId);
  }

  @Post('catalog/products')
  @RequirePermissions('catalog.manage')
  createProduct(@Req() request: AuthenticatedRequest, @Body() body: JsonObject) {
    return this.admin.createProduct(request.user!, body);
  }

  @Post('catalog/products/:productId/variants')
  @RequirePermissions('catalog.manage')
  createVariant(@Req() request: AuthenticatedRequest, @Param('productId') productId: string, @Body() body: JsonObject) {
    return this.admin.createVariant(request.user!, productId, body);
  }

  @Post('catalog/import/preview')
  @RequirePermissions('catalog.manage')
  importPreview(@Req() request: AuthenticatedRequest, @Body() body: JsonObject) {
    return this.admin.previewCatalogImport(request.user!, body);
  }

  @Post('catalog/import/commit')
  @RequirePermissions('catalog.manage')
  importCommit(@Req() request: AuthenticatedRequest, @Body() body: JsonObject) {
    return this.admin.commitCatalogImport(request.user!, body);
  }

  @Patch('catalog/products/:productId')
  @RequirePermissions('catalog.manage')
  updateProduct(@Req() request: AuthenticatedRequest, @Param('productId') productId: string, @Body() body: JsonObject) {
    return this.admin.updateProduct(request.user!, productId, body);
  }

  @Patch('catalog/variants/:variantId')
  @RequirePermissions('catalog.manage')
  updateVariant(@Req() request: AuthenticatedRequest, @Param('variantId') variantId: string, @Body() body: JsonObject) {
    return this.admin.updateVariant(request.user!, variantId, body);
  }
}
