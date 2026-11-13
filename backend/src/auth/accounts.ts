import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, Length } from 'class-validator';
import { EntityManager } from 'typeorm';
import { bad, conflict, forbidden } from '../common/errors.js';
import { roles, type Person, type Role } from '../common/types.js';
import { first } from '../database/database.js';
import { hashPassword } from './password.js';

export class AccountDto {
  @ApiProperty({
    description: 'Логин из букв латиницы, цифр, точек, тире и подчёркиваний',
    example: 'a.volkova',
  })
  @IsString()
  @Length(3, 80)
  login!: string;

  @ApiProperty({ description: 'Имя сотрудника', example: 'Анна Волкова' })
  @IsString()
  @Length(1, 100)
  displayName!: string;

  @ApiProperty({ description: 'Пароль от 10 символов', format: 'password' })
  @IsString()
  @Length(10, 200)
  password!: string;
}

export class CreateAccountDto extends AccountDto {
  @ApiProperty({ description: 'Рабочая роль', enum: roles })
  @IsIn(roles)
  role!: Role;
}

export class RoleDto {
  @ApiProperty({ description: 'Новая роль', enum: roles })
  @IsIn(roles)
  role!: Role;
}

export function requireAdmin(person: Person) {
  if (person.role !== 'ADMIN') forbidden();
}

export async function createAccount(db: EntityManager, input: AccountDto, role: Role) {
  const login = input.login.trim().toLowerCase();
  const name = input.displayName.trim();
  if (!/^[a-z0-9._-]{3,80}$/.test(login) || !name || name.length > 100) {
    bad('Укажите имя и логин из 3–80 символов латиницы, цифр, точки, тире или подчёркивания.');
  }
  if (input.password.trim().length < 10 || input.password.length > 200) {
    bad('Пароль должен содержать от 10 до 200 символов.');
  }
  const account = await first<Person & { login: string }>(
    db,
    `
    INSERT INTO users(login,password_hash,display_name,role) VALUES ($1,$2,$3,$4)
    ON CONFLICT(login) DO NOTHING RETURNING id,login,display_name AS "displayName",role
  `,
    [login, hashPassword(input.password), name, role],
  );
  return account ?? conflict('LOGIN_TAKEN', 'Этот логин уже занят.');
}
