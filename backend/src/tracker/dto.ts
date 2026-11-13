import {
  ApiProperty,
  ApiPropertyOptional,
  PartialType,
  OmitType,
  IntersectionType,
} from '@nestjs/swagger';
import { ValidateIf, IsIn, IsOptional, IsString, IsUUID, Length, MaxLength } from 'class-validator';
import { RevisionDto } from '../common/http.js';
import { statuses, type WorkStatus } from './rules.js';

export const workTypes = ['TASK', 'STORY', 'BUG'] as const;
export const priorities = ['HIGH', 'NORMAL', 'LOW'] as const;
export type WorkType = (typeof workTypes)[number];
export type Priority = (typeof priorities)[number];

export class WorkFilterDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  sprintId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  epicId?: string;

  @ApiPropertyOptional({ enum: workTypes })
  @IsOptional()
  @IsIn(workTypes)
  type?: WorkType;

  @ApiPropertyOptional({ enum: ['true', 'false'] })
  @IsOptional()
  @IsIn(['true', 'false'])
  backlog?: string;

  @ApiPropertyOptional({ description: 'Идентификатор системы', format: 'uuid' })
  @IsOptional()
  @IsUUID()
  systemId?: string;
  @ApiPropertyOptional({ description: 'Идентификатор исполнителя', format: 'uuid' })
  @IsOptional()
  @IsUUID()
  assigneeId?: string;
}

export class CreateWorkDto {
  @ApiPropertyOptional({ enum: workTypes })
  @ValidateIf((value: CreateWorkDto) => value.type !== undefined)
  @IsIn(workTypes)
  type?: WorkType;

  @ApiPropertyOptional({ enum: priorities })
  @ValidateIf((value: CreateWorkDto) => value.priority !== undefined)
  @IsIn(priorities)
  priority?: Priority;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  epicId?: string | null;

  @ApiProperty({ description: 'Идентификатор системы', format: 'uuid' })
  @IsUUID()
  systemId!: string;
  @ApiProperty({ description: 'Название задачи', example: 'Добавить историю уведомлений' })
  @IsString()
  @Length(1, 160)
  title!: string;
  @ApiPropertyOptional({ description: 'Описание задачи', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string | null;
  @ApiPropertyOptional({ description: 'Исполнитель', format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  assigneeId?: string | null;
  @ApiPropertyOptional({
    description: 'Обязательная предшествующая задача',
    format: 'uuid',
    nullable: true,
  })
  @IsOptional()
  @IsUUID()
  requiredItemId?: string | null;
}

export class EditWorkDto extends IntersectionType(
  RevisionDto,
  PartialType(OmitType(CreateWorkDto, ['systemId'] as const)),
) {}

export class MoveWorkDto extends RevisionDto {
  @ApiProperty({ description: 'Целевая колонка доски', enum: statuses })
  @IsIn(statuses)
  targetStatus!: WorkStatus;
}
