import {
  Body,
  Controller,
  Get,
  HttpCode,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthModule, CurrentPerson, SessionGuard, sessionCookie } from '../auth/auth.js';
import { RevisionDto } from '../common/http.js';
import type { Person } from '../common/types.js';
import { CreateWorkDto, EditWorkDto, MoveWorkDto, WorkFilterDto } from './dto.js';
import { TrackerService } from './tracker.js';

@ApiTags('Доска задач')
@ApiCookieAuth(sessionCookie)
@UseGuards(SessionGuard)
@Controller('work-items')
class TrackerController {
  constructor(private readonly tracker: TrackerService) {}

  @Get()
  @ApiOperation({ summary: 'Получить задачи доски' })
  list(@CurrentPerson() person: Person, @Query() filters: WorkFilterDto) {
    return this.tracker.list(person, filters);
  }

  @Post()
  @ApiOperation({ summary: 'Создать и назначить задачу' })
  create(@CurrentPerson() person: Person, @Body() input: CreateWorkDto) {
    return this.tracker.create(person, input);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Открыть карточку задачи' })
  get(@CurrentPerson() person: Person, @Param('id', ParseUUIDPipe) id: string) {
    return this.tracker.get(person, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Обновить задачу или исполнителя' })
  edit(
    @CurrentPerson() person: Person,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: EditWorkDto,
  ) {
    return this.tracker.edit(person, id, input);
  }

  @Get(':id/return-impact')
  @ApiOperation({ summary: 'Проверить, какие релизы затронет возврат задачи' })
  impact(@CurrentPerson() person: Person, @Param('id', ParseUUIDPipe) id: string) {
    return this.tracker.returnImpact(person, id);
  }

  @Post(':id/review/claim')
  @HttpCode(200)
  @ApiOperation({ summary: 'Взять задачу на проверку' })
  claimReview(
    @CurrentPerson() person: Person,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: RevisionDto,
  ) {
    return this.tracker.claimReview(person, id, input.expectedRevision);
  }

  @Post(':id/transitions')
  @HttpCode(200)
  @ApiOperation({ summary: 'Переместить задачу в другую колонку' })
  move(
    @CurrentPerson() person: Person,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: MoveWorkDto,
  ) {
    return this.tracker.move(person, id, input);
  }
}

@Module({
  imports: [AuthModule],
  controllers: [TrackerController],
  providers: [TrackerService],
  exports: [TrackerService],
})
export class TrackerModule {}
