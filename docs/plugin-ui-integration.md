# Интеграция каталога и плагинов

Панель **Plugins** загружает каталог из реестра плагинов. Когда подключён сервис управления плагинами, модератор может выбрать опубликованную версию и запустить её для текущего звонка. Настройка сервиса и сквозная проверка плагина посещаемости описаны в [инструкции по активации](plugin-activation.md).

## Как загружается каталог

```text
MeetingPluginsPanelComponent
  → RuntimeConfigService.isReadyForRequests()
  → PluginCatalogService.list(page, limit)
  → GET <адрес сервера Meet>/v1/plugins?page=1&limit=20
  → следующие страницы до totalPages
  → отображение name и description с ключом id
```

Адрес строится от `RuntimeConfigService.serverBaseUrl()`, а в обычной SPA — от `window.location.origin`. Маршруты `/v1/plugins` и `/v1/plugins/{pluginId}/versions` доступны от корня сервера. Реестр возвращает `items` и `totalPages`. Нумерация страниц начинается с 1. Версии загружаются при выборе конкретного плагина. У записи без опубликованных версий панель показывает соответствующее сообщение. [Спецификация реестра плагинов](https://github.com/dwspurpleteam/specs/blob/main/specs/plugin-service-architecture/spec-plugin-registry.md).

`PluginCatalogService` использует отдельный HTTP-клиент без перехватчиков Meet. Реестр получает запросы без заголовков авторизации Meet. `withCredentials: true` позволяет браузеру передавать разрешённые cookie, в том числе для выбора окружения на входном прокси. При ошибке любой страницы панель позволяет повторить загрузку. Веб-компонент на стороннем сайте обращается к реестру по адресу сервера Meet. Разрешения CORS и cookie должны соответствовать конфигурации окружения. [Развёртывание](https://github.com/dwspurpleteam/deployer/blob/main/README.md).

## Состояние в звонке

| Код в `domains/meeting/`                | Ответственность                                                  |
| --------------------------------------- | ---------------------------------------------------------------- |
| `services/plugin-catalog.service.ts`    | Чтение страниц каталога и опубликованных версий                  |
| `customization/meeting-plugins-panel/`  | Каталог, выбор версии, запуск и отображение статусов             |
| `services/plugin-activation.service.ts` | Вызовы защищённого API Meet, опрос состояния и формирование окон |
| `customization/meeting-custom-layout/`  | Подача `pluginWindows` в Smart Layout                            |
| `services/plugin-events.service.ts`     | Приём серверных `plugin.event.v1`                                |

`PluginEventsService` принимает серверные пакеты без `participant` и проверяет JSON, размер до 15 КиБ, `callId = Room.sid` и поля `activationId`, `name`, `data`. Подписка очищается при смене комнаты. Статус активации сейчас приходит из внутреннего HTTP API Meet. Привязка результатов к iframe зависит от протокола обмена сообщениями между Meet и плагином. [Плавающие окна и iframe](floating-windows-and-plugin-integration.md).
