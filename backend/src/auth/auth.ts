import {
  Body,
  CanActivate,
  Controller,
  createParamDecorator,
  ExecutionContext,
  Get,
  HttpCode,
  Injectable,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';
import { randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import { DataSource } from 'typeorm';
import { ApiError, conflict, forbidden, missing } from '../common/errors.js';
import { requestLog } from '../common/logging.js';
import type { Person } from '../common/types.js';
import { first, rows } from '../database/database.js';
import { hashPassword, hashToken, verifyPassword } from './password.js';
import { AccountDto, CreateAccountDto, RoleDto, createAccount, requireAdmin } from './accounts.js';

export const sessionCookie = 'okno_session';
const sessionLifetime = 8 * 60 * 60 * 1000;
const dummyHash = hashPassword(randomBytes(16).toString('hex'));
const cookieOptions = {
  httpOnly: true,
  sameSite: 'strict' as const,
  secure: process.env.SECURE_COOKIES === 'true',
  path: '/',
};

interface SessionRequest extends Request {
  person?: Person;
}

class LoginDto {
  @ApiProperty({ description: 'Логин сотрудника', example: 'engineer' })
  @IsString()
  @Length(1, 80)
  login!: string;
  @ApiProperty({ description: 'Пароль сотрудника', format: 'password' })
  @IsString()
  @Length(1, 200)
  password!: string;
}

function unauthenticated(): never {
  throw new ApiError(401, 'UNAUTHENTICATED', 'Войдите в систему или проверьте логин и пароль.');
}

function readToken(request: Request): string | undefined {
  const token: unknown = request.cookies?.[sessionCookie];
  return typeof token === 'string' && /^[a-f0-9]{64}$/.test(token) ? token : undefined;
}

@Injectable()
class AuthService {
  constructor(private readonly db: DataSource) {}

  async login({ login, password }: LoginDto) {
    const user = await first<Person & { passwordHash: string }>(
      this.db.manager,
      'SELECT id, display_name AS "displayName", role, password_hash AS "passwordHash" FROM users WHERE login = $1',
      [login.trim().toLowerCase()],
    );
    const valid = verifyPassword(password, user?.passwordHash ?? dummyHash);
    if (!user || !valid) unauthenticated();
    return this.openSession(user);
  }

  private async openSession(user: Person) {
    const token = randomBytes(32).toString('hex');
    await this.db.query('INSERT INTO sessions VALUES ($1, $2, $3)', [
      hashToken(token),
      user.id,
      new Date(Date.now() + sessionLifetime),
    ]);
    requestLog({ actorId: user.id, role: user.role });
    return { token, person: { id: user.id, displayName: user.displayName, role: user.role } };
  }

  async register(input: AccountDto) {
    if (process.env.SIGNUP_ENABLED !== 'true') forbidden();
    return this.openSession(await createAccount(this.db.manager, input, 'ENGINEER'));
  }

  listUsers(person: Person) {
    requireAdmin(person);
    return rows<Person & { login: string }>(
      this.db.manager,
      'SELECT id, login, display_name AS "displayName", role FROM users ORDER BY login',
    );
  }

  addUser(person: Person, input: CreateAccountDto) {
    requireAdmin(person);
    return createAccount(this.db.manager, input, input.role);
  }

  async changeRole(person: Person, id: string, { role }: RoleDto) {
    requireAdmin(person);
    return this.db.transaction(async (db) => {
      const account = await first<Person & { login: string }>(
        db,
        'SELECT id, login, display_name AS "displayName", role FROM users WHERE id=$1 FOR UPDATE',
        [id],
      );
      if (!account) missing();
      if (account.role === role) return account;
      if (account.role === 'ADMIN') forbidden();
      const assigned = await first(
        db,
        `
        SELECT 1 WHERE EXISTS(SELECT 1 FROM systems WHERE $1 IN (owner_id,operations_id,duty_id))
          OR EXISTS(SELECT 1 FROM approval_tasks WHERE assignee_id=$1 AND status='ACTIVE')
          OR EXISTS(SELECT 1 FROM work_items WHERE reviewer_id=$1 AND status='IN_TEST')
          OR EXISTS(SELECT 1 FROM work_items w WHERE w.assignee_id=$1
            AND NOT EXISTS(SELECT 1 FROM deployed_work_items d WHERE d.item_id=w.id))
      `,
        [id],
      );
      if (assigned)
        conflict('USER_ASSIGNED', 'Сначала передайте рабочие назначения этого сотрудника.');
      await db.query('UPDATE users SET role=$2 WHERE id=$1', [id, role]);
      await db.query('DELETE FROM sessions WHERE user_id=$1', [id]);
      return { ...account, role };
    });
  }

  async read(request: Request) {
    const token = readToken(request);
    if (!token) unauthenticated();
    const person = await first<Person>(
      this.db.manager,
      `SELECT u.id, u.display_name AS "displayName", u.role
       FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.token_hash = $1 AND s.expires_at > now()`,
      [hashToken(token)],
    );
    if (!person) unauthenticated();
    requestLog({ actorId: person.id, role: person.role });
    return person;
  }

  async logout(request: Request): Promise<void> {
    const token = readToken(request);
    if (!token) return;
    const session = await first<{ user_id: string }>(
      this.db.manager,
      'DELETE FROM sessions WHERE token_hash = $1 RETURNING user_id',
      [hashToken(token)],
    );
    if (session) requestLog({ actorId: session.user_id });
  }
}

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<SessionRequest>();
    request.person = await this.auth.read(request);
    return true;
  }
}

export const CurrentPerson = createParamDecorator(
  (_: unknown, context: ExecutionContext): Person =>
    context.switchToHttp().getRequest<SessionRequest>().person ?? unauthenticated(),
);

@ApiTags('Сеанс')
@Controller()
class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly db: DataSource,
  ) {}

  @Post('auth/login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Войти в систему' })
  async login(@Body() body: LoginDto, @Res({ passthrough: true }) response: Response) {
    const { token, person } = await this.auth.login(body);
    response.cookie(sessionCookie, token, { ...cookieOptions, maxAge: sessionLifetime });
    return person;
  }

  @Get('auth/options')
  @ApiOperation({ summary: 'Узнать, включена ли регистрация' })
  options() {
    return { signupEnabled: process.env.SIGNUP_ENABLED === 'true' };
  }

  @Post('auth/register')
  @ApiOperation({ summary: 'Зарегистрировать инженера и открыть сеанс' })
  async register(@Body() body: AccountDto, @Res({ passthrough: true }) response: Response) {
    const { token, person } = await this.auth.register(body);
    response.cookie(sessionCookie, token, { ...cookieOptions, maxAge: sessionLifetime });
    return person;
  }

  @Post('auth/logout')
  @HttpCode(204)
  @ApiOperation({ summary: 'Завершить сеанс' })
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    await this.auth.logout(request);
    response.clearCookie(sessionCookie, cookieOptions);
  }

  @Get('me')
  @UseGuards(SessionGuard)
  @ApiCookieAuth(sessionCookie)
  @ApiOperation({ summary: 'Получить текущего сотрудника' })
  me(@CurrentPerson() person: Person) {
    return person;
  }

  @Get('people')
  @UseGuards(SessionGuard)
  @ApiCookieAuth(sessionCookie)
  @ApiOperation({ summary: 'Получить сотрудников для назначения задач' })
  async people() {
    return {
      items: await rows<Person>(
        this.db.manager,
        'SELECT id, display_name AS "displayName", role FROM users ORDER BY display_name',
      ),
    };
  }
}

@ApiTags('Пользователи')
@ApiCookieAuth(sessionCookie)
@UseGuards(SessionGuard)
@Controller('admin/users')
class AccountAdminController {
  constructor(private readonly auth: AuthService) {}

  @Get()
  @ApiOperation({ summary: 'Получить учётные записи' })
  async list(@CurrentPerson() person: Person) {
    return { items: await this.auth.listUsers(person) };
  }

  @Post()
  @ApiOperation({ summary: 'Создать пользователя с выбранной ролью' })
  create(@CurrentPerson() person: Person, @Body() input: CreateAccountDto) {
    return this.auth.addUser(person, input);
  }

  @Patch(':id/role')
  @ApiOperation({ summary: 'Сменить роль и завершить активные сеансы пользователя' })
  updateRole(
    @CurrentPerson() person: Person,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: RoleDto,
  ) {
    return this.auth.changeRole(person, id, input);
  }
}

@Module({
  controllers: [AuthController, AccountAdminController],
  providers: [AuthService, SessionGuard],
  exports: [SessionGuard, AuthService],
})
export class AuthModule {}
