# Интеграция каталога и плагинов

Панель Plugins загружает настоящий каталог Plugin Registry. При настроенном Plugin Manager модератор выбирает опубликованную версию и запускает её на звонок. Подключение Manager, локальная проверка с mock и порядок обновления описаны в [plugin-activation.md](plugin-activation.md).

## Как загружается каталог

```text
MeetingPluginsPanelComponent
  → RuntimeConfigService.isReadyForRequests()
  → PluginCatalogService.list(page, limit)
  → GET <origin сервера Meet>/v1/plugins?page=1&limit=20
  → следующие страницы до totalPages
  → отображение name и description с ключом id
```

Адрес строится от `RuntimeConfigService.serverBaseUrl()`, а в обычной SPA — от `window.location.origin`. Маршруты `/v1/plugins` и `/v1/plugins/{pluginId}/versions` находятся в корне origin. Registry возвращает `items` и `totalPages`, нумерация начинается с 1. Версии загружаются при выборе конкретного плагина. У записи без опубликованных версий панель показывает соответствующее сообщение. [Спецификация Registry](../../specs/specs/plugin-service-architecture/spec-plugin-registry.md).

`PluginCatalogService` использует отдельный HTTP-клиент без интерсепторов Meet. Заголовки авторизации Meet в Registry не отправляются. `withCredentials: true` позволяет браузеру передавать разрешённые cookie, включая выбор окружения ingress. При ошибке любой страницы панель позволяет повторить загрузку. Во внешнем webcomponent origin Registry остаётся origin сервера Meet. Разрешения CORS и cookie должны соответствовать конфигурации окружения. [Развёртывание](../../deployer/README.md).

## Состояние в звонке

| Код в `domains/meeting/`                | Ответственность                                                  |
| --------------------------------------- | ---------------------------------------------------------------- |
| `services/plugin-catalog.service.ts`    | Чтение страниц каталога и опубликованных версий                  |
| `customization/meeting-plugins-panel/`  | Каталог, выбор версии, запуск и отображение статусов             |
| `services/plugin-activation.service.ts` | Вызовы защищённого API Meet, опрос состояния и формирование окон |
| `customization/meeting-custom-layout/`  | Подача `pluginWindows` в Smart Layout                            |
| `services/plugin-events.service.ts`     | Приём серверных `plugin.event.v1`                                |

`PluginEventsService` принимает серверные пакеты без participant и проверяет JSON, размер до 15 KiB, `callId = Room.sid` и поля `activationId`, `name`, `data`. Подписка очищается при смене комнаты. Статус активации сейчас приходит из внутреннего HTTP API Meet. Привязка результатов к iframe зависит от контракта дочернего bridge. [Плавающие окна и iframe](floating-windows-and-plugin-integration.md).
