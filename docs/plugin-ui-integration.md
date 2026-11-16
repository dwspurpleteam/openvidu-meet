# Интеграция каталога и плагинов

Проверено **2026-11-15** на коммите `95f3d4027ea3976f4560de0d3ac74bf1c3929742`, ветка `feat/real-plugins`. Документ описывает реализованное поведение; целевые контракты находятся в [specs](../../specs/specs/plugin-service-architecture/spec.md).

## Статус

| Часть интеграции | Состояние |
| --- | --- |
| Список доступных плагинов | Настоящий Plugin Registry, без встроенного mock-каталога |
| Загрузка каталога | Все страницы, индикатор загрузки, пустой список, ошибка и повтор запроса |
| Запуск и остановка | Не подключены; кнопки в списке отключены (`Unavailable`) |
| Окна плагинов | Механика сохранена, но в текущем звонке нет источника окон |
| Серверные события | Принимаются из LiveKit, но ещё не связаны с активациями и iframe |
| Frontend SDK / bridge плагина | Не подключён |

**Задача «Connect the available plugins registry to the OpenVidu» с описанием «Заменить тестовые данные в UI списка доступных плагинов на данные из реестра» реализована в указанном коммите.** Запуск плагинов — отдельная задача. Приёмку на стенде следует отличать от готовности кода: полный браузерный сценарий с живым Registry в этой проверке не выполнялся.

## Как загружается каталог

```text
MeetingPluginsPanelComponent
  → ожидание RuntimeConfigService.isReadyForRequests()
  → PluginCatalogService.list(page, limit)
  → GET <origin сервера Meet>/v1/plugins?page=1&limit=20
  → следующие страницы до totalPages
  → отображение name и description с ключом id
```

Адрес строится от `RuntimeConfigService.serverBaseUrl()`, а в обычной SPA — от `window.location.origin`. Используется именно корень origin: `/v1/plugins`, не `/meet/v1/plugins` и не Meet API `/meet/api/v1/...`.

Контракт соответствует [API Registry](../../plugin-registry/README.md) и [принятой спецификации](../../specs/specs/plugin-service-architecture/spec-plugin-registry.md): страницы начинаются с 1, лимит по умолчанию 20, ответ содержит `items` и `totalPages`. Для списка используются только `id`, `name`, `description`.

`PluginCatalogService` создаёт `HttpClient` через `HttpBackend`, обходя HTTP-interceptors Meet. Поэтому заголовки авторизации Meet не добавляются; `withCredentials: true` позволяет браузеру отправить разрешённые cookie, включая выбор окружения ingress. При ошибке любой страницы панель показывает ошибку; повтор начинает загрузку с первой страницы. Частично загруженный список не публикуется.

Это **каталог зарегистрированных плагинов**, не список готовых к запуску версий: endpoint не фильтрует записи по наличию опубликованной версии. Версии и манифесты UI пока не запрашивает; права запуска и готовность backend не определяет.

### Развёртывание

- В локальном `deployer` на коммите `4952526` конфигурация [nginx](../../deployer/apps/calls/nginx/configs/nginx.conf.tmpl) направляет `/v1/` в Registry; отдельные маршруты активаций и конфигурации — в Manager.
- По [инструкции стенда](../../deployer/README.md) cookie `composer_stage` выбирает stage; без неё используется prod. Значение секрета в документации не хранится.
- Для локальной разработки нужен доступный Registry через `/v1/plugins` на origin Meet, например через reverse proxy. Fallback на тестовые данные отсутствует.
- Во внешнем webcomponent origin Registry остаётся origin сервера Meet, а не host-страницы. Такой запрос может стать cross-origin: нужны CORS с credentials и допустимая политика cookie. `withCredentials` не обходит ограничения браузера; этот режим не проверен.

## Карта кода

Пути ниже относительно `meet-ce/frontend/projects/shared-meet-components/src/lib/domains/meeting/`:

| Файл | Ответственность |
| --- | --- |
| `services/plugin-catalog.service.ts` | HTTP-клиент Registry и минимальные типы списка |
| `customization/meeting-plugins-panel/meeting-plugins-panel.component.{ts,html}` | Загрузка всех страниц и состояния панели |
| `services/plugin-events.service.ts` | Приём `plugin.event.v1` из LiveKit |
| `customization/meeting-custom-layout/meeting-custom-layout.component.ts` | Создаёт сервис событий; не формирует `pluginWindows` |

Mock Registry и Manager, демонстрационные iframe-страницы и peer-синхронизация `meet.plugins.mock.v1` удалены. `PluginEventsService.events` пока не имеет потребителя в рабочем UI. Сервис принимает пакеты без participant, проверяет JSON, размер до 15 KiB, `callId` по `Room.sid` и поля `activationId`, `name`, `data`; подписка очищается при смене комнаты.

Сохранённые контейнеры iframe и плавающих окон описаны в [floating-windows-and-plugin-integration.md](floating-windows-and-plugin-integration.md). Наличие контейнера не означает, что внешний плагин уже можно безопасно открыть.

## Что осталось до сквозной интеграции

1. Подключить настоящий Manager: подтверждение пользователя и прав, выбор версии, асинхронный запуск, ошибки и остановка. В локальном `plugin-manager-service` (`22ea375`) есть регистрация активации и чтение её состояния; это ещё не полный контракт UI со списком активаций звонка и управлением остановкой.
2. Получать доверенное состояние активаций и обновления для всех участников, включая late join/reconnect; очищать UI и ресурсы при остановке и завершении звонка. Локальную геометрию хранить отдельно от серверного состояния.
3. Подключить проверенный URL, iframe-политику, handshake и Frontend SDK bridge с проверкой `event.origin`, `event.source` и activation. Секреты и токены OpenVidu не передавать плагину.
4. Связать проверенные серверные события с соответствующим iframe и проверить полный путь реального плагина.

На дату проверки `specs/main` остаётся на `ce57eb6` (сверено с GitHub API). [PR #5](https://github.com/dwspurpleteam/specs/pull/5) (манифест 1.1, head `e0f56f85`) и [PR #6](https://github.com/dwspurpleteam/specs/pull/6) (Frontend SDK / LaunchParams, head `d1c2d131`) открыты, не merged. Frontend SDK предназначен для страницы плагина; Meet реализует хостовую сторону bridge. В PR #6 остаются расхождения с принятой архитектурой: отсутствие проверки origin/source и wildcard вместо точного target origin; `call.id = room.name` вместо используемого сейчас `Room.sid`. Их следует согласовать до реализации, но загрузку каталога они не блокируют.

### Ограничения текущего Manager для активации

Уточнено 2026-11-15 по коду Manager `22ea375` и Registry `772da43`:

- `Unavailable` — безусловная отключённая кнопка в шаблоне панели (`PLUGINS.UNAVAILABLE`), не результат проверки доступности и не поле ответа Registry.
- Manager выбирает версию автоматически через `latestVersion` в `/v1/plugins`, но настоящий Registry возвращает только `id`, `name`, `description`. Автовыбор несовместим с этим ответом. Явный `pluginVersion` обходит этот путь, но требует существующего манифеста.
- Адаптер Manager также ожидает от `/versions` массив строк, тогда как Registry возвращает страницу объектов. В текущем выборе версии этот метод не используется, но готовым решением автовыбора его считать нельзя.
- Валидатор Manager принимает только `manifest-version: "0.1"`; принятый манифест 1.0 и предлагаемый 1.1 без согласования/доработки не подойдут.
- Обработчик активации сохраняет маршрут, проверяет health endpoint и переводит запись в `ACTIVE`, но `sendInitialActivationMessage` пока возвращает `Unit` без отправки. `ACTIVE` здесь не подтверждает запуск обработки конкретного звонка плагином.
- Публичный `GET /v1/plugins/1/versions?page=1&limit=20` без stage-cookie вернул пустой список: у записи `test` на момент запроса нет опубликованных версий. Состояние stage этим не проверено.

Реалистичный первый этап — регистрация настоящей серверной активации с явной версией и polling состояния, после подготовки опубликованной версии и доверенного пользовательского контекста. Полноценный запуск с UI и обработкой звонка требует также серверного control-контракта, состояния для всех участников, остановки и безопасного bridge. В ходе исследования POST активации не выполнялся; работоспособность развёрнутого Manager не подтверждена.

## Проверки и приёмка

Повторно проверено **2026-11-15**:

- **26 успешных unit-тестов**: каталог, события, layout и `StreamLayoutStateService`.
- Сборка Angular-библиотеки и проверка типов E2E — успешно. Сборка выдаёт предупреждения о deprecated builder, dynamic imports и export conditions; ошибок нет.
- Read-only запрос `https://calls.vareonix.cc/v1/plugins?page=1&limit=20` без cookie — успешно: получен JSON каталога с одной записью. Это проверка публичного API, не браузерного UI или версии развёрнутого Meet.
- Stage, браузерный сценарий с живым Registry, E2E звонка и cross-origin webcomponent **не проверены**. Полный unit-набор, сборки SPA и webcomponent в этот прогон не входили.

Команды из корня репозитория с установленными зависимостями и версиями Node/pnpm из проекта:

```bash
pnpm --filter @openvidu-meet/frontend run lib:build
pnpm --filter @openvidu-meet/frontend run test:types:e2e
pnpm --filter @openvidu-meet/frontend run test:unit:lib \
  --include='**/plugin-catalog.service.spec.ts' \
  --include='**/plugin-events.service.spec.ts' \
  --include='**/components/layout/**/*.spec.ts' \
  --include='**/stream-layout-state.service.spec.ts'
```

Для Karma нужен Chrome/Chromium, при необходимости задаётся `CHROME_BIN`. `plugin-catalog.service.spec.ts` проверяет URL/параметры, credentials и обход заголовков авторизации Meet; unit-теста панели на пагинацию и retry сейчас нет.

В `meet-ce/frontend/e2e/windows.test.ts` есть сценарий ошибки, повтора и двух страниц каталога. Он **подменяет HTTP-ответ Registry** через `page.route`, требует работающей инфраструктуры звонка и в эту проверку не запускался:

```bash
pnpm --filter @openvidu-meet/frontend run e2e:playwright:spa windows.test.ts
```

Для приёмки именно живого каталога на выбранном стенде: войти в звонок, открыть Plugins, проверить запросы `/v1/plugins` и соответствие записей ответу Registry. Отдельно проверить пустой список и ошибку/retry. Отключённая активация — текущее ожидаемое поведение, а не незавершённая часть задачи замены списка.
