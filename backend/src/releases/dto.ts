import { ApiProperty, ApiPropertyOptional, IntersectionType } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsDefined,
  IsIn,
  IsObject,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { RevisionDto } from '../common/http.js';

const offset = /(?:Z|[+-]\d{2}:\d{2})$/u;
const scopeLimit = 100;

export class DraftDto {
  @ApiPropertyOptional({
    description: 'Система релиза',
    type: String,
    nullable: true,
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  systemId?: string | null;
  @ApiPropertyOptional({ description: 'Название релиза', type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  title?: string | null;
  @ApiPropertyOptional({ description: 'План отката', type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  rollbackPlan?: string | null;
  @ApiPropertyOptional({ description: 'Начало окна со смещением', type: String, nullable: true })
  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(offset)
  startsAt?: string | null;
  @ApiPropertyOptional({ description: 'Окончание окна со смещением', type: String, nullable: true })
  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(offset)
  endsAt?: string | null;
  @ApiPropertyOptional({
    description: 'Номера задач релиза',
    type: [String],
    example: ['OKNO-142'],
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(scopeLimit)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  itemKeys?: string[];
  @ApiPropertyOptional({
    description: 'Ссылка на тег GitLab',
    type: String,
    nullable: true,
    example: 'https://gitlab.example.ru/team/notifications/-/tags/v1.2.0',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  gitlabTagUrl?: string | null;
}

export class PatchDraftDto extends IntersectionType(DraftDto, RevisionDto) {}

export class ItemKeysDto {
  @ApiProperty({ description: 'Номера задач релиза', type: [String], example: ['OKNO-142'] })
  @IsArray()
  @ArrayMaxSize(scopeLimit)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  itemKeys!: string[];
}

class ProposedChangesDto {
  @ApiPropertyOptional({ description: 'Новое начало окна со смещением' })
  @ValidateIf((_, value) => value !== undefined)
  @IsISO8601({ strict: true })
  @Matches(offset)
  startsAt?: string;
  @ApiPropertyOptional({ description: 'Новое окончание окна со смещением' })
  @ValidateIf((_, value) => value !== undefined)
  @IsISO8601({ strict: true })
  @Matches(offset)
  endsAt?: string;
  @ApiPropertyOptional({ description: 'Новый состав', type: [String] })
  @ValidateIf((_, value) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(scopeLimit)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  itemKeys?: string[];
  @ApiPropertyOptional({ description: 'Новая ссылка на тег GitLab', type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  gitlabTagUrl?: string | null;
}

export class ChangeDto extends RevisionDto {
  @ApiProperty({ type: ProposedChangesDto, description: 'Предлагаемые изменения' })
  @Type(() => ProposedChangesDto)
  @ValidateNested()
  @IsDefined()
  @IsObject()
  proposedChanges!: ProposedChangesDto;
}

export class WindowDto {
  @ApiProperty({ description: 'Система релиза', format: 'uuid' })
  @IsUUID()
  systemId!: string;
  @ApiProperty({ description: 'Начало окна со смещением' })
  @IsISO8601({ strict: true })
  @Matches(offset)
  startsAt!: string;
  @ApiProperty({ description: 'Окончание окна со смещением' })
  @IsISO8601({ strict: true })
  @Matches(offset)
  endsAt!: string;
}

export class DecisionDto extends RevisionDto {
  @ApiProperty({ description: 'Решение по этапу', enum: ['APPROVE', 'RETURN'] })
  @IsIn(['APPROVE', 'RETURN'])
  decision!: 'APPROVE' | 'RETURN';
  @ApiPropertyOptional({ description: 'Причина возврата' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}

export class DeployDto extends RevisionDto {
  @ApiProperty({ description: 'Фактическое время внедрения со смещением' })
  @IsISO8601({ strict: true })
  @Matches(offset)
  deployedAt!: string;
  @ApiPropertyOptional({ description: 'Ссылка на GitLab Release', type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  gitlabReleaseUrl?: string | null;
}

export class AttachReleaseDto extends RevisionDto {
  @ApiProperty({
    description: 'Ссылка на GitLab Release',
    example: 'https://gitlab.example.ru/team/notifications/-/releases/v1.2.0',
  })
  @IsString()
  @Length(1, 2048)
  gitlabReleaseUrl!: string;
}
