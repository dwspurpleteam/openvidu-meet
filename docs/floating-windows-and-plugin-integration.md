# Плавающие окна и контейнеры плагинов

Проверено **2026-11-15** на коммите `95f3d402`, ветка `feat/real-plugins`. Это описание текущей оконной механики и границ её использования, не история demo и не спецификация API. Статус каталога, запуска и проверок — в [plugin-ui-integration.md](plugin-ui-integration.md).

## Что работает сейчас

Камера/аватар и демонстрация экрана используют общую оболочку `WindowShellComponent` через композицию. Она также поддерживает iframe плагина, но **источника окон плагинов в текущем `MeetingCustomLayoutComponent` нет**: каталог не создаёт iframe, реальные плагины не открываются.

Общая механика поддерживает:

- Открепление из сетки и возврат в неё без второй копии плитки.
- Перемещение за заголовок, независимый resize ширины и высоты четырьмя углами.
- Сворачивание кнопкой или перетаскиванием в правый док; восстановление прежней геометрии с ограничением текущими границами.
- Клавиатурные перемещение и resize стрелками, увеличенный шаг с Shift, отмену pointer resize.
- Один DOM-элемент содержимого для grid/floating/minimized. Переходы не должны пересоздавать iframe.
- Отдельный учёт откреплённых камер в Smart Mosaic и заполнение освободившихся grid-слотов.
- Единственного владельца remote audio: сворачивание окна не отключает звук и не меняет публикацию камеры.

### Локальные UI-правила

Размещение, геометрия и док принадлежат конкретному пользователю, не синхронизируются с участниками и не сохраняются между звонками/перезагрузками. Существующая browser preference собственной плавающей камеры сохраняется отдельно.

Начальный floating-размер — 320 × 220, обычный минимум — 160 × 100; если workspace меньше, размер ограничивается его границами. Фиксированного соотношения 16:9 нет. Область окон — сетка звонка над footer субтитров, не весь документ.

Автоматика собственной камеры сохранена: появление удалённого участника может сделать её плавающей, уход последнего возвращает её в сетку. Вручную свёрнутая камера автоматически не разворачивается. Явный pin возвращает медиаплитку в сетку; автоматический pin screen share не возвращает откреплённое/свёрнутое окно.

В оболочке нет действия остановки плагина. `minimized` — локальное состояние отображения, не деактивация backend. Квоты и количество активных плагинов оконная механика не определяет.

## Карта кода

Пути относительно `meet-ce/frontend/projects/shared-meet-components/src/lib/domains/meeting/`:

| Файл | Ответственность |
| --- | --- |
| `openvidu-components/components/layout/window-shell/window-shell.component.{ts,html,scss}` | Controls, CDK drag, pointer/keyboard resize, bounds и `ng-content` |
| `openvidu-components/services/layout/stream-layout-state.service.ts` | Размещение по ID, геометрия, активное окно, pin/float и очистка |
| `openvidu-components/components/layout/base-layout.component.{ts,html,scss}` | Общие оболочки media/iframe, док, drop hit-test, восстановление и измерение сетки |
| `openvidu-components/components/layout/smart-layout/smart-layout.component.{ts,html}` | Grid selection и detached/minimized камеры, hidden video, единственный audio-контейнер; передача `pluginWindows` |
| `openvidu-components/models/participant.model.ts` | Раздельные ID и floating-состояния камеры и screen stream |
| `openvidu-components/services/meeting-events/meeting-events.service.ts` | Автоматический pin screen share и очистка на `TrackUnpublished` |
| `openvidu-components/services/screen-share/screen-share.service.ts` | Pin локального экрана и очистка геометрии при остановке |
| `components/plugin-iframe-window/plugin-iframe-window.component.ts` | Внутренний `PluginWindow` и iframe; production-политика доверия ещё не реализована |
| `customization/meeting-custom-layout/meeting-custom-layout.component.{ts,html}` | Встраивает Smart Layout без `pluginWindows`; управляет alone overlays |

Внешний host bridge находится в `domains/embedded/services/iframe-bridge.service.ts`. Он предназначен для управления **всем Meet со стороны родительского host**, а не для дочерних iframe плагинов. Проверку `event.source === window.parent` необходимо сохранить.

## Контракт оконной механики

Поддерживаемая цепочка для будущего источника окон:

```text
доверенное состояние активаций → PluginWindow[]
  → SmartLayoutComponent.pluginWindows
  → BaseLayoutComponent.pluginWindows
  → WindowShellComponent + PluginIframeWindowComponent
```

Сейчас первый шаг отсутствует, inputs по умолчанию содержат пустой массив. Demo-панели, demo assets и mock Manager удалены; инструкции по их удалению больше не нужны.

```ts
interface PluginWindow {
    id: string;
    title: string;
    url: string;
}
```

Это внутренний descriptor отображения, не DTO активации и не `ParticipantModel`. Iframe не создаёт LiveKit-участника и не публикует RTC-поток. Для новой интеграции ID следует привязать к стабильному `activationId`, отдельно от ID камер/экранов; повторный snapshot не должен пересоздавать то же окно или без причины менять его `src`.

`StreamLayoutStateService` хранит локальное размещение независимо от descriptors:

```text
windowPlacement(id) → { mode: 'grid' | 'floating' | 'minimized', rect? }
setWindowMode(id, mode)
setWindowRect(id, rect)
clearWindow(id)
clearAllViewState()
```

Отсутствующая запись означает `grid`. `isStreamFloating(id)` означает **«не в сетке»**, включая `minimized`; это не проверка видимости. `clearWindow(id)` очищает локальное размещение, pin и активный ID, но не удаляет descriptor, не уничтожает iframe и не останавливает backend. При реальной деактивации потребуется и убрать descriptor из источника окон, и очистить локальное состояние и bridge.

## Перед открытием внешнего iframe

Текущий компонент оставлен с ограниченной политикой для прежнего demo: `sandbox="allow-scripts"`, запрет камеры/микрофона/display-capture/geolocation и `referrerpolicy="no-referrer"`. Он вызывает `bypassSecurityTrustResourceUrl`, **не проверяя URL**. Нельзя просто передать ему адрес из каталога и считать production-интеграцию готовой.

Требования [принятой архитектуры](../../specs/specs/plugin-service-architecture/spec.md):

1. Проверять URL на доверенной границе: HTTPS, допустимый origin, отсутствие credentials и соответствие описанию плагина. Angular bypass не является валидацией.
2. Размещать UI на отдельном от Meet origin. Для него согласовать sandbox `allow-scripts allow-same-origin`; эту комбинацию нельзя переносить на same-origin страницу как эквивалент изоляции. Текущий sandbox даёт opaque origin и не подходит без изменений для проверки реального origin SDK.
3. Настроить CSP `frame-src` у host; плагин должен разрешать embedding через `frame-ancestors` и не блокировать его `X-Frame-Options`. Для webcomponent важна также CSP внешнего host-документа. CORS не снимает запрет встраивания.
4. Добавить отдельный bridge UI Adapter ↔ iframe: готовность SDK, проверка версии/размера сообщений, точные `event.origin` и `event.source === iframe.contentWindow`, привязка к activation. Не принимать дочерние сообщения за host-команды существующего embedding bridge.
5. Передавать подписанный launch context только ожидаемому origin после handshake, не через URL или wildcard. Не передавать токены/секреты OpenVidu и E2EE keys; проверка прав остаётся серверной.
6. Обрабатывать запуск/ошибку/остановку, отзыв разрешений и reconnect, удалять listeners и ресурсы. Обычный iframe load не доказывает готовность SDK. Сворачивание не останавливает обработку плагином.

Кроме подключения `pluginWindows`, в custom layout нужно учесть видимые окна при показе alone overlays: плагин не увеличивает число реальных участников, а текущие overlay predicates о нём не знают. Полный план интеграции и открытые вопросы контракта — в [plugin-ui-integration.md](plugin-ui-integration.md).

## Инварианты при дальнейших изменениях

- Не создавать второй Smart Layout ради iframe: иначе появятся конкурирующие владельцы audio и layout service.
- Не разносить iframe по отдельным `@if`/outlets grid/float/minimized и не переносить между DOM-родителями. Менять placement/CSS того же host, сохранять стабильный `track plugin.id`.
- Сохранять стабильный ID камеры при выключении видео и отдельный ID screen share. Откреплённая камера должна оставаться в рендере вне speaker grid selection; видимое floating-видео нельзя останавливать как hidden.
- Не включать док и interaction shields в измеряемые layout-плитки; layout engine исключает `OV_floating`/`OV_ignored`. Во время drag/resize нужна защита при пересечении любого iframe.
- Поддерживать Shadow DOM, не переносить окна в `document.body`.
- Не путать локальное размещение с серверным lifecycle и не сбрасывать геометрию при каждом обновлении активаций.

## Проверки

Co-located unit-тесты `window-shell.component.spec.ts`, `base-layout.component.spec.ts`, `smart-layout.component.spec.ts` и `stream-layout-state.service.spec.ts` покрывают DOM iframe, геометрию, drag/dock, Smart Mosaic, audio и cleanup. Это тестовые descriptors iframe, а не подключённые плагины Registry.

`meet-ce/frontend/e2e/windows.test.ts` содержит проверку каталога с подменённым HTTP-ответом и сценарий открепления remote avatar/camera и screen share без дублирования audio. Старого E2E с demo-лимитом и demo-кнопкой больше нет. Для E2E нужна работающая инфраструктура Meet/LiveKit и хранилищ.

Команды и фактические результаты последнего прогона приведены в [plugin-ui-integration.md](plugin-ui-integration.md#проверки-и-приёмка). Прошлые результаты сборок и исторические таймауты не являются статусом текущего checkout.
