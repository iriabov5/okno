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
import {
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AuthModule, CurrentPerson, SessionGuard, sessionCookie } from '../auth/auth.js';
import { RevisionDto, SearchDto } from '../common/http.js';
import type { Person } from '../common/types.js';
import { TrackerModule } from '../tracker/controller.js';
import { requireEngineer, TrackerService } from '../tracker/tracker.js';
import { ReleaseCalendar } from './calendar.js';
import {
  AttachReleaseDto,
  ChangeDto,
  DecisionDto,
  DeployDto,
  DraftDto,
  ItemKeysDto,
  PatchDraftDto,
  WindowDto,
} from './dto.js';
import { ReleaseService } from './release.js';
import {
  WindowPreviewResponseDto,
  ChangeResponseDto,
  ReleaseResponseDto,
  ScopeResponseDto,
} from './openapi.js';
import { ReleaseScope } from './scope.js';

@ApiTags('Подготовка релиза')
@ApiCookieAuth(sessionCookie)
@UseGuards(SessionGuard)
@Controller()
class CatalogController {
  constructor(
    private readonly releases: ReleaseService,
    private readonly tracker: TrackerService,
  ) {}

  @Get('systems')
  @ApiOperation({ summary: 'Получить список систем' })
  systems() {
    return this.releases.systems();
  }

  @Get('systems/:id/release-items')
  @ApiOperation({ summary: 'Найти задачи для включения в релиз' })
  items(
    @CurrentPerson() person: Person,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: SearchDto,
  ) {
    requireEngineer(person);
    return this.tracker.list(person, { systemId: id }, query.q);
  }

  @Post('systems/:id/release-scope/preview')
  @HttpCode(200)
  @ApiOperation({ summary: 'Проверить готовность состава и обязательные зависимости' })
  @ApiOkResponse({ type: ScopeResponseDto, description: 'Препятствия и зависимости состава' })
  scope(
    @CurrentPerson() person: Person,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: ItemKeysDto,
  ) {
    return this.releases.previewScope(person, id, input.itemKeys);
  }

  @Post('windows/preview')
  @HttpCode(200)
  @ApiOperation({ summary: 'Проверить окно и подобрать свободное время' })
  @ApiOkResponse({
    type: WindowPreviewResponseDto,
    description: 'Проверка окна и предложение свободного интервала',
  })
  window(@CurrentPerson() person: Person, @Body() input: WindowDto) {
    return this.releases.previewWindow(person, input);
  }
}

@ApiTags('Заявки на релиз')
@ApiCookieAuth(sessionCookie)
@UseGuards(SessionGuard)
@Controller('release-requests')
class ReleaseController {
  constructor(private readonly releases: ReleaseService) {}

  @Get()
  @ApiOperation({ summary: 'Получить мои заявки' })
  list(@CurrentPerson() person: Person) {
    return this.releases.list(person);
  }

  @Post()
  @ApiOperation({ summary: 'Создать черновик заявки' })
  @ApiCreatedResponse({ type: ReleaseResponseDto, description: 'Карточка нового черновика' })
  create(@CurrentPerson() person: Person, @Body() input: DraftDto) {
    return this.releases.create(person, input);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Открыть заявку, маршрут и историю' })
  @ApiOkResponse({
    type: ReleaseResponseDto,
    description: 'Карточка с маршрутом, историей и доступными действиями',
  })
  card(@CurrentPerson() person: Person, @Param('id', ParseUUIDPipe) id: string) {
    return this.releases.card(person, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Сохранить черновик или заявку на доработке' })
  @ApiOkResponse({ type: ReleaseResponseDto, description: 'Обновлённая карточка' })
  edit(
    @CurrentPerson() person: Person,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: PatchDraftDto,
  ) {
    return this.releases.edit(person, id, input);
  }

  @Post(':id/submit')
  @HttpCode(200)
  @ApiOperation({ summary: 'Отправить заявку на согласование' })
  @ApiOkResponse({ type: ReleaseResponseDto, description: 'Карточка с запущенным маршрутом' })
  submit(
    @CurrentPerson() person: Person,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: RevisionDto,
  ) {
    return this.releases.submit(person, id, input.expectedRevision);
  }

  @Post(':id/changes/preview')
  @HttpCode(200)
  @ApiOperation({ summary: 'Посмотреть, как изменение повлияет на согласования' })
  @ApiOkResponse({ type: ChangeResponseDto, description: 'Предпросмотр для текущей ревизии' })
  preview(
    @CurrentPerson() person: Person,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: ChangeDto,
  ) {
    return this.releases.previewChange(person, id, input);
  }

  @Post(':id/changes')
  @HttpCode(200)
  @ApiOperation({ summary: 'Подтвердить изменение окна, состава или тега' })
  @ApiOkResponse({ type: ReleaseResponseDto, description: 'Карточка с пересчитанным маршрутом' })
  change(
    @CurrentPerson() person: Person,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: ChangeDto,
  ) {
    return this.releases.change(person, id, input);
  }

  @Post(':id/deploy')
  @HttpCode(200)
  @ApiOperation({ summary: 'Отметить фактическое внедрение' })
  @ApiOkResponse({
    type: ReleaseResponseDto,
    description: 'Карточка со статусом «Внедрено» и фактическим временем',
  })
  deploy(
    @CurrentPerson() person: Person,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: DeployDto,
  ) {
    return this.releases.deploy(person, id, input);
  }

  @Patch(':id/gitlab-release')
  @ApiOperation({ summary: 'Привязать GitLab Release после внедрения' })
  @ApiOkResponse({ type: ReleaseResponseDto, description: 'Карточка с привязанным GitLab Release' })
  attach(
    @CurrentPerson() person: Person,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: AttachReleaseDto,
  ) {
    return this.releases.attachRelease(person, id, input);
  }
}

@ApiTags('Согласование')
@ApiCookieAuth(sessionCookie)
@UseGuards(SessionGuard)
@Controller('approval-tasks')
class ApprovalController {
  constructor(private readonly releases: ReleaseService) {}

  @Get()
  @ApiOperation({ summary: 'Получить задачи согласования на мне' })
  queue(@CurrentPerson() person: Person) {
    return this.releases.queue(person);
  }

  @Post(':id/decision')
  @HttpCode(200)
  @ApiOperation({ summary: 'Согласовать этап или вернуть заявку автору' })
  @ApiOkResponse({ type: ReleaseResponseDto, description: 'Карточка после решения' })
  decision(
    @CurrentPerson() person: Person,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: DecisionDto,
  ) {
    return this.releases.decide(person, id, input);
  }
}

@Module({
  imports: [AuthModule, TrackerModule],
  controllers: [CatalogController, ReleaseController, ApprovalController],
  providers: [ReleaseService, ReleaseScope, ReleaseCalendar],
})
export class ReleaseModule {}
