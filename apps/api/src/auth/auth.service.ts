import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { isLocale } from '@pos/shared/locale';
import { createHash, randomBytes } from 'node:crypto';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { hashPassword, verifyPassword } from '../security/password.js';
import { AuthorizationService } from './authorization.service.js';
import { UserContext } from './auth.types.js';
import { ALL_PERMISSION_CODES, ORGANISATION_ADMINISTRATOR_ROLE, PERMISSIONS, SYSTEM_ROLES } from './permission-catalogue.js';

export type LoginInput = {
  email?: unknown;
  password?: unknown;
  pin?: unknown;
  organizationSlug?: unknown;
};

export type OrganizationRegistrationInput = {
  organizationName?: unknown;
  organizationSlug?: unknown;
  firstName?: unknown;
  lastName?: unknown;
  email?: unknown;
  password?: unknown;
};

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const SESSION_HOURS = 8;
const IDLE_MINUTES = 60;

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
    private readonly audit: AuditService,
  ) {}

  async login(input: LoginInput): Promise<{ accessToken: string; expiresAt: string; user: UserContext }> {
    const email = this.normalizedEmail(input.email);
    const password = typeof input.password === 'string' ? input.password : '';
    const pin = typeof input.pin === 'string' ? input.pin : '';
    const organizationSlug = typeof input.organizationSlug === 'string' ? input.organizationSlug.trim() : undefined;

    // An email can exist in more than one organisation. Without an organisation slug the account is
    // ambiguous: the organisations are only revealed to someone who proves they know the password.
    const candidates = await this.prisma.user.findMany({
      where: { email, ...(organizationSlug ? { organization: { slug: organizationSlug } } : {}) },
      include: { organization: { select: { slug: true, name: true } } },
      take: 20,
    });
    const isLocked = (u: (typeof candidates)[number]) => Boolean(u.lockedUntil && u.lockedUntil.getTime() > Date.now());
    const credentialOk = (u: (typeof candidates)[number]) =>
      u.status === 'ACTIVE' && ((password && verifyPassword(password, u.passwordHash)) || (pin && u.pinHash && verifyPassword(pin, u.pinHash)));

    if (candidates.length > 1) {
      const matching = candidates.filter((u) => !isLocked(u) && credentialOk(u));
      if (matching.length > 0) {
        throw new ConflictException({
          code: 'ORGANISATION_REQUIRED',
          message: 'This email belongs to more than one organisation. Choose one to continue.',
          organisations: matching.map((u) => ({ slug: u.organization.slug, name: u.organization.name })),
        });
      }
      for (const candidate of candidates) await this.recordFailure(candidate);
      throw new UnauthorizedException('Invalid email or password');
    }

    const user = candidates[0];
    if (user && isLocked(user)) {
      throw new UnauthorizedException('Account temporarily locked after repeated failed attempts');
    }
    if (!user || !credentialOk(user)) {
      if (user) await this.recordFailure(user);
      throw new UnauthorizedException('Invalid email or password');
    }

    const rawToken = randomBytes(32).toString('base64url');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SESSION_HOURS * 3_600_000);

    await this.prisma.$transaction(async (tx) => {
      await tx.session.create({
        data: { tokenHash: sha256(rawToken), userId: user.id, organizationId: user.organizationId, expiresAt, lastSeenAt: now },
      });
      await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: now, failedAttempts: 0, lockedUntil: null } });
      await this.audit.record({ organizationId: user.organizationId, userId: user.id }, 'auth.login', 'User', user.id, {}, tx);
    });

    return { accessToken: rawToken, expiresAt: expiresAt.toISOString(), user: await this.authorization.getUserContext(user.id) };
  }

  /** Creates a tenant and its first organisation administrator as one atomic registration. */
  async registerOrganization(input: OrganizationRegistrationInput): Promise<{ accessToken: string; expiresAt: string; user: UserContext }> {
    const organizationName = typeof input.organizationName === 'string' ? input.organizationName.trim() : '';
    const firstName = typeof input.firstName === 'string' ? input.firstName.trim() : '';
    const lastName = typeof input.lastName === 'string' ? input.lastName.trim() : '';
    if (typeof input.email !== 'string' || !/^\S+@\S+\.\S+$/.test(input.email.trim())) throw new BadRequestException('Enter a valid administrator email');
    const email = this.normalizedEmail(input.email);
    const password = typeof input.password === 'string' ? input.password : '';
    if (organizationName.length < 2 || organizationName.length > 120) throw new BadRequestException('Organisation name must be between 2 and 120 characters');
    if (firstName.length < 1 || firstName.length > 80) throw new BadRequestException('Enter the administrator first name');
    if (lastName.length > 80) throw new BadRequestException('Administrator last name is too long');
    if (password.length < 12 || password.length > 200) throw new BadRequestException('Password must be between 12 and 200 characters');

    const candidateSlug = typeof input.organizationSlug === 'string' && input.organizationSlug.trim()
      ? input.organizationSlug.trim().toLowerCase()
      : organizationName.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const organizationSlug = candidateSlug.slice(0, 48).replace(/-+$/g, '');
    if (!/^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/.test(organizationSlug)) {
      throw new BadRequestException('Organisation URL must be 3 to 48 lowercase letters, numbers, or hyphens');
    }

    const configuredLimit = Number.parseInt(process.env.POS_MAX_STORES ?? '5', 10);
    const maxStores = Number.isInteger(configuredLimit) && configuredLimit > 0 ? configuredLimit : 5;
    const accessToken = randomBytes(32).toString('base64url');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SESSION_HOURS * 3_600_000);

    try {
      const userId = await this.prisma.$transaction(async (tx) => {
        const organization = await tx.organization.create({ data: { name: organizationName, slug: organizationSlug, countryCode: 'IN', currency: 'INR' } });
        await tx.organizationEntitlement.create({ data: { organizationId: organization.id, maxStores } });
        await tx.organizationSettings.create({
          data: { organizationId: organization.id, settings: { enabledTenders: ['CASH'], onboarding: { version: 2, currentStep: 0, completedSteps: [], complete: false, required: true } } },
        });
        await tx.permission.createMany({ data: PERMISSIONS.map(([code, description]) => ({ code, description })), skipDuplicates: true });

        const roleIds = new Map<string, string>();
        for (const definition of SYSTEM_ROLES) {
          const role = await tx.role.create({
            data: { organizationId: organization.id, name: definition.name, description: definition.description, isSystem: true, storeAssignable: definition.storeAssignable ?? false },
          });
          roleIds.set(definition.name, role.id);
          await tx.rolePermission.createMany({
            data: [...new Set(definition.permissions)].map((permissionCode) => ({ roleId: role.id, permissionCode, effect: 'ALLOW' })),
          });
        }
        const administratorRoleId = roleIds.get(ORGANISATION_ADMINISTRATOR_ROLE);
        if (!administratorRoleId) throw new Error('Administrator system role is missing');
        await tx.rolePermission.createMany({
          data: ALL_PERMISSION_CODES.map((permissionCode) => ({ roleId: administratorRoleId, permissionCode, effect: 'ALLOW' })),
          skipDuplicates: true,
        });
        const user = await tx.user.create({
          data: {
            organizationId: organization.id,
            email,
            passwordHash: hashPassword(password),
            firstName,
            lastName,
          },
        });
        await tx.userRole.create({
          data: { organizationId: organization.id, userId: user.id, roleId: administratorRoleId, scopeType: 'ORGANIZATION' },
        });
        await tx.session.create({
          data: { tokenHash: sha256(accessToken), userId: user.id, organizationId: organization.id, expiresAt, lastSeenAt: now },
        });
        await this.audit.record({ organizationId: organization.id, userId: user.id }, 'organization.registered', 'Organization', organization.id, { slug: organizationSlug }, tx);
        return user.id;
      });
      return { accessToken, expiresAt: expiresAt.toISOString(), user: await this.authorization.getUserContext(userId) };
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 'P2002') {
        throw new ConflictException('That organisation URL or administrator account is already in use');
      }
      throw error;
    }
  }

  async authenticateToken(rawToken: string): Promise<UserContext> {
    const tokenHash = sha256(rawToken);
    const session = await this.prisma.session.findUnique({ where: { tokenHash } });

    if (!session || session.expiresAt.getTime() <= Date.now()) {
      if (session) await this.prisma.session.deleteMany({ where: { tokenHash } });
      throw new UnauthorizedException('Session is missing or expired');
    }
    if (session.lastSeenAt.getTime() + IDLE_MINUTES * 60_000 <= Date.now()) {
      await this.prisma.session.deleteMany({ where: { tokenHash } });
      throw new UnauthorizedException('Session expired after inactivity');
    }
    await this.prisma.session.update({ where: { tokenHash }, data: { lastSeenAt: new Date() } });
    return this.authorization.getUserContext(session.userId);
  }

  async logout(rawToken: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { tokenHash: sha256(rawToken) } });
  }

  async setPin(context: UserContext, pin: string): Promise<void> {
    if (!/^\d{4,8}$/.test(pin)) throw new UnauthorizedException('PIN must contain 4 to 8 digits');
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: context.userId }, data: { pinHash: hashPassword(pin) } });
      await this.audit.record(context, 'auth.pin.updated', 'User', context.userId, {}, tx);
    });
  }

  async updateProfile(context: UserContext, input: { firstName?: unknown; lastName?: unknown; password?: unknown; currentPassword?: unknown; pin?: unknown; preferredLocale?: unknown }): Promise<void> {
    const password = typeof input.password === 'string' && input.password.length ? input.password : undefined;
    const pin = typeof input.pin === 'string' && input.pin.length ? input.pin : undefined;
    const preferredLocale = input.preferredLocale;
    if (preferredLocale !== undefined && !isLocale(preferredLocale)) {
      throw new BadRequestException('Preferred language must be en or ar');
    }
    if (password && password.length < 12) throw new UnauthorizedException('Password must be at least 12 characters');
    if (password) {
      const stored = await this.prisma.user.findUnique({ where: { id: context.userId }, select: { passwordHash: true } });
      const supplied = typeof input.currentPassword === 'string' ? input.currentPassword : '';
      if (!stored || !supplied || !verifyPassword(supplied, stored.passwordHash)) throw new UnauthorizedException('Current password is incorrect');
    }
    if (pin && !/^\d{4,8}$/.test(pin)) throw new UnauthorizedException('PIN must contain 4 to 8 digits');
    if (!password && !pin && typeof input.firstName !== 'string' && typeof input.lastName !== 'string' && preferredLocale === undefined) throw new UnauthorizedException('At least one profile field is required');
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: context.userId }, data: {
        ...(typeof input.firstName === 'string' && input.firstName.trim() ? { firstName: input.firstName.trim() } : {}),
        ...(typeof input.lastName === 'string' ? { lastName: input.lastName.trim() } : {}),
        ...(password ? { passwordHash: hashPassword(password), failedAttempts: 0, lockedUntil: null } : {}),
        ...(pin ? { pinHash: hashPassword(pin) } : {}),
        ...(preferredLocale ? { preferredLocale } : {}),
      } });
      await this.audit.record(context, 'auth.profile.updated', 'User', context.userId, { passwordChanged: Boolean(password), pinChanged: Boolean(pin), preferredLocaleChanged: preferredLocale !== undefined }, tx);
    });
  }

  /** Counts a failed credential check and locks the account (audited) once the limit is reached. */
  private async recordFailure(user: { id: string; organizationId: string; failedAttempts: number }): Promise<void> {
    const failedAttempts = user.failedAttempts + 1;
    const locking = failedAttempts >= MAX_FAILED_ATTEMPTS;
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { failedAttempts, lockedUntil: locking ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null },
      });
      if (locking) {
        await this.audit.record({ organizationId: user.organizationId, userId: user.id }, 'auth.lockout', 'User', user.id, { failedAttempts, lockMinutes: LOCK_MINUTES }, tx);
      }
    });
  }

  /** Re-checks the signed-in user's PIN to unlock a shared till. Shares the failure counter with login. */
  async verifyPin(context: UserContext, pin: unknown): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: context.userId } });
    if (!user || user.status !== 'ACTIVE') throw new UnauthorizedException('Invalid PIN');
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      throw new UnauthorizedException('Account temporarily locked after repeated failed attempts');
    }
    if (typeof pin !== 'string' || !user.pinHash || !verifyPassword(pin, user.pinHash)) {
      await this.recordFailure(user);
      throw new UnauthorizedException('Invalid PIN');
    }
    await this.prisma.user.update({ where: { id: user.id }, data: { failedAttempts: 0, lockedUntil: null } });
    await this.audit.record(context, 'auth.unlock', 'User', user.id, {});
  }

  private normalizedEmail(value: unknown): string {
    if (typeof value !== 'string' || !value.includes('@')) throw new UnauthorizedException('Invalid email or password');
    return value.trim().toLowerCase();
  }

  hashPassword(password: string): string {
    return hashPassword(password);
  }
}
