import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ReleasePersonDto {
  @ApiProperty({ description: 'Идентификатор сотрудника', format: 'uuid' })
  declare id: string;

  @ApiProperty({ description: 'Имя сотрудника', example: 'Анна Волкова' })
  declare displayName: string;
}

export class WindowResponseDto {
  @ApiProperty({ description: 'Начало окна', format: 'date-time' })
  declare startsAt: string;

  @ApiProperty({ description: 'Конец окна', format: 'date-time' })
  declare endsAt: string;
}

class CalendarConflictDto extends WindowResponseDto {
  @ApiProperty({ description: 'Занятый ресурс', example: 'Общая база данных' })
  declare resource: string;

  @ApiProperty({ description: 'Причина занятости', example: 'Плановые работы' })
  declare description: string;
}

export class CalendarResponseDto {
  @ApiProperty({ type: [CalendarConflictDto], description: 'Пересечения с работами' })
  declare conflicts: CalendarConflictDto[];

  @ApiProperty({
    type: WindowResponseDto,
    nullable: true,
    description: 'Следующее свободное окно той же длительности',
  })
  declare suggestedWindow: WindowResponseDto | null;
}

class ReleaseSprintResponseDto {
  @ApiProperty({ format: 'uuid' })
  declare id: string;

  @ApiProperty()
  declare name: string;

  @ApiProperty({ enum: ['PLANNED', 'ACTIVE', 'CLOSED'] })
  declare state: string;
}

class ReleaseItemResponseDto {
  @ApiProperty({ type: ReleaseSprintResponseDto, nullable: true, description: 'Спринт задачи' })
  declare sprint: ReleaseSprintResponseDto | null;

  @ApiProperty({ description: 'Номер задачи', example: 'OKNO-142' })
  declare key: string;

  @ApiProperty({ description: 'Название задачи в составе релиза' })
  declare title: string;
}

class RouteStepResponseDto {
  @ApiProperty({ description: 'Этап согласования', enum: ['OWNER', 'OPERATIONS', 'DUTY'] })
  declare stage: string;

  @ApiProperty({ description: 'Название этапа' })
  declare label: string;

  @ApiProperty({
    description: 'Состояние этапа',
    enum: ['APPROVED', 'ACTIVE', 'RECHECK', 'PENDING_RECHECK', 'PENDING'],
  })
  declare state: string;

  @ApiProperty({ type: ReleasePersonDto, nullable: true, description: 'Ответственный за этап' })
  declare assignee: ReleasePersonDto | null;
}

class ReleaseSystemResponseDto {
  @ApiProperty({ format: 'uuid', description: 'Идентификатор системы' })
  declare id: string;

  @ApiProperty({ description: 'Код системы', example: 'NOTIFY' })
  declare code: string;

  @ApiProperty({ description: 'Название системы' })
  declare name: string;
}

class BlockerResponseDto {
  @ApiProperty({ type: String, nullable: true, description: 'Номер задачи' })
  declare key: string | null;

  @ApiProperty({ description: 'Код препятствия', example: 'NOT_READY' })
  declare code: string;

  @ApiPropertyOptional({ description: 'Состояние задачи' })
  declare status?: string;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Исполнитель задачи' })
  declare assignee?: string | null;

  @ApiProperty({ description: 'Причина, показанная пользователю' })
  declare message: string;
}

class DependencyResponseDto {
  @ApiProperty({ description: 'Номер задачи' })
  declare key: string;

  @ApiProperty({ description: 'Номер обязательной задачи' })
  declare requiredKey: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Номер релиза, которым внедрена обязательная задача',
  })
  declare release: string | null;

  @ApiProperty({ description: 'Обязательная задача включена в состав' })
  declare included: boolean;
}

export class ScopeResponseDto {
  @ApiProperty({ type: [BlockerResponseDto], description: 'Препятствия в составе' })
  declare blockers: BlockerResponseDto[];

  @ApiProperty({ type: [DependencyResponseDto], description: 'Обязательные зависимости' })
  declare dependencies: DependencyResponseDto[];
}

class ReleaseEventResponseDto {
  @ApiProperty({ format: 'date-time', description: 'Время события' })
  declare createdAt: string;

  @ApiProperty({ description: 'Кто выполнил действие' })
  declare actor: string;

  @ApiProperty({ description: 'Тип события', example: 'DEPLOYED' })
  declare type: string;

  @ApiProperty({ type: Object, description: 'Подробности события' })
  declare details: object;
}

export class WindowPreviewResponseDto extends CalendarResponseDto {
  @ApiProperty({ type: [String], description: 'Маршрут выбранного окна' })
  declare route: string[];

  @ApiProperty({ type: [String], description: 'Маршрут предложенного окна' })
  declare suggestedRoute: string[];
}

export class ReleaseResponseDto extends ScopeResponseDto {
  @ApiProperty({ description: 'Идентификатор заявки', format: 'uuid' })
  declare id: string;

  @ApiProperty({ description: 'Номер релиза', example: 'REL-24' })
  declare key: string;

  @ApiProperty({
    description: 'Статус заявки',
    enum: ['DRAFT', 'IN_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'DEPLOYED'],
  })
  declare status: string;

  @ApiProperty({ description: 'Текущая ревизия заявки', example: 4 })
  declare revision: number;

  @ApiProperty({ description: 'Название релиза', type: String, nullable: true })
  declare title: string | null;

  @ApiProperty({ type: [ReleaseItemResponseDto], description: 'Состав релиза' })
  declare items: ReleaseItemResponseDto[];

  @ApiProperty({ type: [RouteStepResponseDto], description: 'Маршрут и состояние этапов' })
  declare route: RouteStepResponseDto[];

  @ApiProperty({ description: 'Доступные действия пользователя', type: [String] })
  declare availableActions: string[];

  @ApiProperty({ description: 'Текущее назначение', type: ReleasePersonDto, nullable: true })
  declare currentAssignee: ReleasePersonDto | null;

  @ApiProperty({
    description: 'Фактическое время внедрения',
    type: String,
    format: 'date-time',
    nullable: true,
  })
  declare deployedAt: string | null;

  @ApiProperty({ description: 'Тег GitLab', type: String, format: 'uri', nullable: true })
  declare gitlabTagUrl: string | null;

  @ApiProperty({ type: ReleasePersonDto, nullable: true, description: 'Автор заявки' })
  declare author: ReleasePersonDto | null;

  @ApiProperty({ type: ReleaseSystemResponseDto, nullable: true, description: 'Система релиза' })
  declare system: ReleaseSystemResponseDto | null;

  @ApiProperty({ type: String, nullable: true, description: 'План отката' })
  declare rollbackPlan: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'Начало окна' })
  declare startsAt: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'Конец окна' })
  declare endsAt: string | null;

  @ApiProperty({ type: [CalendarConflictDto], description: 'Текущие конфликты календаря' })
  declare calendarConflicts: CalendarConflictDto[];

  @ApiProperty({ type: WindowResponseDto, nullable: true, description: 'Предложенное окно' })
  declare suggestedWindow: WindowResponseDto | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'Активная задача текущего согласующего',
  })
  declare currentTaskId: string | null;

  @ApiProperty({ type: [ReleaseEventResponseDto], description: 'История заявки' })
  declare history: ReleaseEventResponseDto[];

  @ApiProperty({ description: 'GitLab Release', type: String, format: 'uri', nullable: true })
  declare gitlabReleaseUrl: string | null;
}

class ChangeStepDto {
  @ApiProperty({ description: 'Этап согласования', enum: ['OWNER', 'OPERATIONS', 'DUTY'] })
  declare stage: string;

  @ApiProperty({
    description: 'Последствие изменения',
    enum: ['KEEP', 'RECHECK', 'ADD', 'REMOVE', 'PENDING'],
  })
  declare effect: string;

  @ApiProperty({ description: 'Причина, понятная участнику' })
  declare reason: string;
}

export class ChangeResponseDto extends ScopeResponseDto {
  @ApiProperty({ description: 'Ревизия для подтверждения изменения' })
  declare revision: number;

  @ApiProperty({ type: CalendarResponseDto, description: 'Проверка нового окна' })
  declare calendar: CalendarResponseDto;

  @ApiProperty({ type: [ChangeStepDto], description: 'Последствия по этапам' })
  declare steps: ChangeStepDto[];

  @ApiProperty({
    type: ReleasePersonDto,
    nullable: true,
    description: 'Кто получит следующую задачу',
  })
  declare nextAssignee: ReleasePersonDto | null;

  @ApiProperty({ description: 'Добавленные номера', type: [String] })
  declare addedItemKeys: string[];

  @ApiProperty({ description: 'Удалённые номера', type: [String] })
  declare removedItemKeys: string[];

  @ApiProperty({ type: WindowResponseDto, description: 'Предыдущее окно' })
  declare previousWindow: WindowResponseDto;

  @ApiProperty({ type: WindowResponseDto, description: 'Предложенное окно' })
  declare window: WindowResponseDto;

  @ApiProperty({ type: String, nullable: true, description: 'Предыдущий тег GitLab' })
  declare previousTag: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'Предлагаемый тег GitLab' })
  declare gitlabTagUrl: string | null;
}
