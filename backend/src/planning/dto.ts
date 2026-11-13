import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  ValidateIf,
} from 'class-validator';
import { RevisionDto } from '../common/http.js';

export class EpicFilterDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  systemId?: string;
}

export class CreateEpicDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  systemId!: string;

  @ApiProperty()
  @IsString()
  @Length(1, 160)
  title!: string;

  @ApiProperty()
  @IsString()
  @Length(1, 500)
  goal!: string;
}

export class CreateSprintDto {
  @ApiProperty()
  @IsString()
  @Length(1, 120)
  name!: string;

  @ApiProperty()
  @IsString()
  @Length(1, 500)
  goal!: string;

  @ApiProperty({ format: 'date' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  startsOn!: string;

  @ApiProperty({ format: 'date' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  endsOn!: string;
}

export class MoveSprintDto extends RevisionDto {
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  @ValidateIf((value: MoveSprintDto) => value.sprintId !== null)
  @IsUUID()
  sprintId!: string | null;
}

export class CompletionDto extends RevisionDto {
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  @ValidateIf((value: CompletionDto) => value.destinationSprintId !== null)
  @IsUUID()
  destinationSprintId!: string | null;
}

export class CompleteSprintDto extends CompletionDto {
  @ApiProperty()
  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  previewToken!: string;
}
