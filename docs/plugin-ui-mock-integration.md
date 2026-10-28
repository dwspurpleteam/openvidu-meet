# Plugin UI: временный frontend-адаптер

## Назначение

В `feat/plugin-list` добавлен UI-адаптер для будущих Plugin Registry и Plugin Manager. Реальных сервисов этих компонентов пока нет, поэтому фронтенд использует временные реализации, сохраняющие форму данных и границы из `specs/specs/plugin-service-architecture/`.

Это не production-протокол и не замена серверной авторизации.

## Что видит пользователь

В панели звонка появилась кнопка **Plugins**. Она открывает каталог, в котором отображаются:

- доступные плагины из временного Registry;
- состояние каждого подключения (`AVAILABLE`, `ACTIVATING`, `ACTIVE`, `FORBIDDEN`, `REJECTED`, `ACTIVATION_FAILED`);
- список активных в текущем звонке подключений;
- кнопка `Disconnect` напротив каждого активного подключения;
- ошибки загрузки каталога и повторная попытка.

`restricted` демонстрирует недоступность по правам, а `rejected` — отказ активации. Эти сценарии зафиксированы во временном адаптере и предназначены для проверки UI.

После активации каждый участник звонка получает окно с UI-заготовкой в iframe. Окно использует существующую механику плавающих, сворачиваемых и возвращаемых окон. Остановка удаляет descriptor окна и вызывает `StreamLayoutStateService.clearWindow`.

Положение окна, его размер и сворачивание остаются локальными для участника. Сама активация и остановка распространяются на весь звонок.

## Точки замены

| Сейчас | Когда появятся сервисы |
| --- | --- |
| `services/plugin-registry.service.ts` | заменить `list`, `find`, `getManifest` и `uiUrl` на HTTP-вызовы Registry |
| `services/plugin-manager.service.ts` | заменить `activate`, `stop`, `refresh` и обработчик data-channel на Plugin Manager API/events |
| `PluginActivation` | сопоставить с DTO `Activation` (`activationId`, `callId`, `pluginId`, `pluginVersion`, `registryId`, `state`, `stateChangedAt`, `idempotencyKey`) |
| `PluginWindow` mapping в `meeting-custom-layout.component.ts` | оставить: descriptor окна отделён от серверной активации, ID строится из стабильного `activationId` |
| `plugin-iframe-window.component.ts` | оставить только после проверки доверенного `uiUrl`, origin и sandbox-политики |

Слой UI не должен превращать активацию в `ParticipantModel`. UI-окно — отдельный descriptor, а его identity должна оставаться стабильной при snapshot/event обновлениях.

## Временный обмен состоянием

Пока backend отсутствует, `PluginManagerService` реплицирует небольшой snapshot через LiveKit reliable data packet с topic `meet.plugins.mock.v1`.

Сообщения имеют форму:

```json
{
  "version": 1,
  "callId": "<Room.sid>",
  "type": "request | snapshot",
  "items": []
}
```

`items` содержат временные поля `revision` и `writer` для идемпотентного слияния. Новый участник отправляет `request`, уже подключённый участник отвечает snapshot. Записи другого звонка, неизвестный plugin ID, неправильная версия, слишком большой пакет и malformed JSON отбрасываются.

Это только стендовая peer-replication модель. Она не предоставляет:

- серверской проверки пользователя, роли, прав и квот;
- подписи сообщений или защиты от участника, подделывающего snapshot;
- durable Activation Store;
- backend lifecycle `ACTIVATING → ACTIVE`;
- серверной остановки после окончания звонка или отзыва разрешения.

При подключении Plugin Manager data-channel нужно удалить, не расширять его до доверенного control plane. Активация должна выполняться сервером асинхронно, а UI должен получать authoritative snapshot и события Manager. `activationId` должен выдаваться Manager; повторный запрос должен использовать idempotency key.

## Имена demo-ресурсов

`src/assets/plugin-demo/transcript.html` и `notes.html` — только локальные UI fixtures. Они не реализуют Frontend SDK, ready-handshake, signed launch context или bridge с Meet. Перед загрузкой внешних страниц нужно реализовать требования из раздела 4.3–4.4 документа `floating-windows-and-plugin-integration.md`: доверенный origin, CSP, согласованный sandbox, проверка `event.source`/`event.origin` и очистка listeners.

## Проверки

Unit-проверки временного manager находятся в `services/plugin-manager.service.spec.ts` и покрывают:

- пагинацию Registry и manifest;
- несколько активаций, запрет дублей и выборочную остановку;
- отказ по правам и отказ активации;
- ошибку остановки с сохранением активного подключения;
- snapshot для late join/reconnect;
- stale/foreign/malformed сообщения и очистку после выхода.
