import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class RevisionDto {
  @ApiProperty({ description: 'Ревизия карточки, с которой работал пользователь', example: 4 })
  @IsInt()
  @Min(1)
  expectedRevision!: number;
}

export class ErrorDto {
  @ApiProperty({ example: 'STALE_REVISION', description: 'Код ошибки' })
  code!: string;
  @ApiProperty({ example: 'Карточка изменилась.', description: 'Описание ошибки' })
  message!: string;
  @ApiPropertyOptional({ type: Object, description: 'Подробности для конкретной операции' })
  details?: unknown;
}

export class SearchDto {
  @ApiPropertyOptional({ description: 'Часть номера или названия задачи', example: 'OKNO-142' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  q?: string;
}
