# Разработка и локальный запуск

Нужны Node.js 26 LTS из .nvmrc, npm и Docker Compose.

```sh
cp .env.example .env
npm ci
docker compose up -d --wait db
npm run build
npm run db:migrate -w backend
npm run db:seed -w backend
```

Если обновляете уже работающую копию, выполните из корня проекта `npm run build -w backend` и `npm run db:migrate -w backend`, затем перезапустите бэкенд в IntelliJ IDEA. Миграции применяются к базе из корневого `.env`. Если после обновления `work-items`, `epics` и `sprints` отвечают HTTP 500, проверьте, что миграция применена к той же базе, которую использует запущенный бэкенд.

Запустите API и фронтенд в двух терминалах.

```sh
npm run start -w backend
```

```sh
VITE_DEMO_MODE=true npm run dev -w frontend
```

Интерфейс по адресу http://127.0.0.1:5186, Swagger UI по http://127.0.0.1:3100/docs, контракты по http://127.0.0.1:3100/api.json и http://127.0.0.1:3100/api.yaml. В демо логины engineer, developer, qa, owner, operations, duty и admin. Пароль для локальных примеров — okno-demo.

Самостоятельная регистрация включается через SIGNUP_ENABLED=true. Настройка есть в .env.example. Чтобы добавить администратора в отдельное окружение, передайте ADMIN_LOGIN, ADMIN_DISPLAY_NAME и ADMIN_PASSWORD через окружение и выполните `npm run db:admin -w backend` после миграций.

Миграции TypeORM находятся в [backend/src/database/migrations](../backend/src/database/migrations). Имя класса заканчивается timestamp. TypeORM использует его для порядка выполнения и записывает применённые миграции в таблицу migrations. Новое изменение схемы оформляется следующей миграцией.

Для сценария переноса после подготовки согласованного релиза запустите команду.

```sh
npm run demo:conflict -w backend
```

## Логи бэкенда

В IntelliJ IDEA откройте вкладку **Run → backend > start**. По умолчанию бэкенд пишет успешные изменения и действия с учётными записями на уровне INFO. В текстовом выводе Nest этот уровень называется `LOG`. Отклонённые входы, запреты и конфликты пишутся как WARN, серверные сбои — как ERROR.

Чтобы видеть чтение карточек, предпросмотры и время HTTP-запросов, добавьте `LOG_LEVEL=DEBUG` в корневой `.env` и перезапустите бэкенд. Доступны уровни `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR`. Параметр `LOG_FORMAT=json` включает вывод JSON.

Каждый ответ содержит `X-Request-Id`. По этому идентификатору можно найти запись с маршрутом, кодом ответа и длительностью. Для действий с задачами и релизами указывается номер карточки, для авторизованных действий — идентификатор сотрудника. Пароли, токены, cookie, параметры URL и тела запросов в журнал не записываются.

## Проверки

```sh
npm run format:check
npm run lint
npm run typecheck
npm run build
npm test
TEST_DATABASE_URL=postgresql://okno:okno_local@127.0.0.1:55436/okno npm run test:integration
TEST_DATABASE_URL=postgresql://okno:okno_local@127.0.0.1:55436/okno npm run test:coverage
```

HTTP-тест создаёт свою временную PostgreSQL-базу. Для Playwright поднимите отдельную базу с демонстрационными данными, добавьте конфликт календаря и направьте отдельный фронтенд на тестовый API. Пример рабочего окружения есть в [CI](../.github/workflows/ci.yml). Для локального прогона установите Chromium командой `npx playwright install chromium` и передайте адрес тестового фронтенда в E2E_BASE_URL. Для отчёта покрытия браузера запустите `E2E_COVERAGE=true npm run test:e2e` против Vite dev-сервера. SonarQube использует отчёты LCOV из бэкенда, Vitest и Playwright.
