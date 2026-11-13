import {
  Body,
  Controller,
  Get,
  HttpCode,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthModule, CurrentPerson, SessionGuard, sessionCookie } from '../auth/auth.js';
import { RevisionDto } from '../common/http.js';
import type { Person } from '../common/types.js';
import { TrackerModule } from '../tracker/controller.js';
import { TrackerService } from '../tracker/tracker.js';
import {
  CompleteSprintDto,
  CompletionDto,
  CreateEpicDto,
  CreateSprintDto,
  EpicFilterDto,
  MoveSprintDto,
} from './dto.js';
import { PlanningService } from './planning.js';

@ApiTags('Планирование')
@ApiCookieAuth(sessionCookie)
@UseGuards(SessionGuard)
@Controller()
class PlanningController {
  constructor(
    private readonly planning: PlanningService,
    private readonly tracker: TrackerService,
  ) {}

  @Get('epics')
  @ApiOperation({ summary: 'Получить эпики и готовность карточек' })
  epics(@Query() filter: EpicFilterDto) {
    return this.planning.epics(filter.systemId);
  }

  @Post('epics')
  @ApiOperation({ summary: 'Создать эпик' })
  createEpic(@CurrentPerson() person: Person, @Body() input: CreateEpicDto) {
    return this.planning.createEpic(person, input);
  }

  @Get('sprints')
  @ApiOperation({ summary: 'Получить спринты' })
  sprints() {
    return this.planning.sprints();
  }

  @Post('sprints')
  @ApiOperation({ summary: 'Запланировать спринт' })
  createSprint(@CurrentPerson() person: Person, @Body() input: CreateSprintDto) {
    return this.planning.createSprint(person, input);
  }

  @Post('sprints/:id/start')
  @HttpCode(200)
  @ApiOperation({ summary: 'Запустить спринт' })
  start(
    @CurrentPerson() person: Person,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: RevisionDto,
  ) {
    return this.planning.start(person, id, input.expectedRevision);
  }

  @Post('sprints/:id/completion-preview')
  @HttpCode(200)
  @ApiOperation({ summary: 'Проверить переносы и связанные релизы перед завершением спринта' })
  preview(
    @CurrentPerson() person: Person,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: CompletionDto,
  ) {
    return this.planning.preview(person, id, input);
  }

  @Post('sprints/:id/complete')
  @HttpCode(200)
  @ApiOperation({ summary: 'Завершить спринт и сохранить итоги' })
  complete(
    @CurrentPerson() person: Person,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: CompleteSprintDto,
  ) {
    return this.planning.complete(person, id, input);
  }

  @Get('sprints/:id/results')
  @ApiOperation({ summary: 'Получить зафиксированные итоги спринта' })
  results(@Param('id', ParseUUIDPipe) id: string) {
    return this.planning.results(id);
  }

  @Post('work-items/:id/sprint')
  @HttpCode(200)
  @ApiOperation({ summary: 'Перенести карточку в спринт или бэклог' })
  async move(
    @CurrentPerson() person: Person,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: MoveSprintDto,
  ) {
    await this.planning.move(person, id, input);
    return this.tracker.get(person, id);
  }
}

@Module({
  imports: [AuthModule, TrackerModule],
  providers: [PlanningService],
  controllers: [PlanningController],
})
export class PlanningModule {}
