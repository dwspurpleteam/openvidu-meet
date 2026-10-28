# Плавающие окна и переход от demo к API плагинов

Документ для сопровождения реализации от **2026-10-19**. Описывает текущий код, временные решения и порядок их замены. Это не спецификация API и не описание готовой платформы плагинов.

Архитектурные требования остаются в отдельном репозитории:

- [Сервис плагинов](../../specs/specs/plugin-service-architecture/spec.md).
- [Доставка медиа и событий](../../specs/specs/call-streaming/spec.md).

Эти ссылки работают при соседнем размещении репозиториев `openvidu-meet` и `specs`. При расхождении будущего API с этим документом сначала обновляются архитектурные решения, затем адаптер; demo-контракт не является обязательством для backend.

## 1. Что реализовано

Раньше плавающей могла быть только собственная камера. Теперь камера/аватар, демонстрация экрана и iframe используют одну оболочку `WindowShellComponent` через **композицию**, не наследование. Iframe не имитирует `ParticipantModel`, не создаёт LiveKit-участника и не публикует RTC-поток.

Поддерживаются:

- Открепление кнопкой из сетки и отдельный возврат в сетку; копии плитки в сетке не остаётся.
- Перемещение плавающего окна за заголовок, независимое изменение ширины/высоты четырьмя углами.
- Сворачивание кнопкой либо перетаскиванием в правый док; восстановление из дока в предыдущую плавающую геометрию с ограничением текущими границами.
- Клавиатурные перемещение/resize стрелками, Shift для большего шага; обработка отмены resize.
- Общая оболочка и тот же DOM-элемент содержимого во всех состояниях. Переходы не пересоздают iframe и не сбрасывают заметки внутри него.
- Откреплённые камеры не занимают слоты Smart Mosaic и не пропадают при ротации говорящих; освободившийся grid-слот заполняется другим участником.
- Звук удалённых участников остаётся у единственного persistent-audio владельца. Сворачивание не заглушает звук и не отключает публикацию камеры.

Вся реализация находится в Angular-библиотеке, общей для SPA и webcomponent. Backend, shared API typings, SFU, зависимости и lockfile для этой фичи не менялись. Нового backend API или протокола плагинов нет.

### Принятые UI-правила — не заглушки API

- Размещение, размер и док локальны для каждого пользователя. Они не синхронизируются с другими участниками.
- Раскладка окон не сохраняется между звонками/перезагрузками. Существующая browser preference собственной плавающей камеры сохраняется.
- У плагинов **нет крестика удаления/закрытия**. Demo-окна живут до выхода из звонка; minimize не означает остановку приложения.
- Новый размер плавающего окна — 320 × 220; обычный минимум — 160 × 100, но окно уменьшается ниже минимума, если сама область звонка меньше.
- Resize больше не фиксирует соотношение сторон 16:9. Видео продолжает масштабироваться по правилам своего компонента.
- Область окон — workspace сетки; при включённых субтитрах она находится над footer. Окна не предназначены для перекрытия субтитров.
- Существующая автоматика собственной камеры сохранена: первая удалённая сторона может сделать её плавающей, уход последней возвращает её в сетку. Вручную свёрнутая камера автоматически не разворачивается.
- Явный pin возвращает медиаплитку в сетку; открепление снимает grid-pin. Автоматический pin screen share не возвращает откреплённую/свёрнутую плитку в сетку.

Менять эти правила при подключении API автоматически не нужно. Если продукту нужны shared placement, закрытие UI отдельно от остановки плагина или сохранение раскладки — это отдельные решения.

## 2. Карта кода: что оставить и где менять

Для краткости `M` ниже означает:

```text
meet-ce/frontend/projects/shared-meet-components/src/lib/domains/meeting/
```

| Файлы относительно `M` | Ответственность |
| --- | --- |
| `openvidu-components/components/layout/window-shell/window-shell.component.{ts,html,scss}` | Общие controls, CDK drag, pointer resize, bounds, активное окно, сохранение геометрии. Контент передаётся через `ng-content`. |
| `openvidu-components/services/layout/stream-layout-state.service.ts` | Map размещения окон по ID, геометрия, активное окно, pin/float-переходы и очистка; существующий per-viewer mute остаётся здесь. |
| `openvidu-components/components/layout/base-layout.component.{ts,html,scss}` | Рендер общих оболочек, измеряемая сетка, док, drop hit-test, восстановление и ResizeObserver. Старая singleton-механика local drag/resize удалена, а не оставлена вторым путём. |
| `openvidu-components/components/layout/smart-layout/smart-layout.component.{ts,html}` | Различает grid-выборку и detached/minimized камеры, пополняет сетку, определяет действительно скрытое видео; сохраняет единственный audio-контейнер. Передаёт `pluginWindows` дальше. |
| `openvidu-components/models/participant.model.ts` | Screen stream теперь читает floating-состояние так же, как камера. Камера/аватар сохраняют стабильный `camera-<identity>`, экран имеет отдельный stream ID. |
| `openvidu-components/components/stream/stream.component.{ts,html}` | Старая local-only float-кнопка удалена: управление размещением теперь в оболочке. Метод `toggleFloat()` сохранён и обобщён для совместимости. Pin, mute, screen zoom остаются media-specific. |
| `openvidu-components/services/meeting-events/meeting-events.service.ts` | Автоприкрепление screen share через `pinStreamIfInGrid`, очистка окна на `TrackUnpublished`. |
| `openvidu-components/services/screen-share/screen-share.service.ts` | Аналогичный автоматический pin локального экрана и очистка геометрии при остановке. |
| `components/plugin-iframe-window/plugin-iframe-window.component.ts` | Минимальный `PluginWindow` и тело iframe. **Политику доверия и sandbox необходимо доработать до внешних плагинов.** |
| `customization/meeting-custom-layout/meeting-custom-layout.component.{ts,html,scss}` | Сейчас владеет demo-массивом и кнопкой добавления; передаёт окна в Smart Layout. Скрывает alone share/waiting overlay, пока виден хотя бы один плагин. |
| `customization/meeting-plugin-demo-panel/meeting-plugin-demo-panel.component.ts` | Удаляемая demo-панель: счётчик, кнопка, сообщение о лимите. Только emits `add`, не управляет окнами. |
| `lang/{en,de,es,fr,it,nl,pt,hi,ja,cn}.json` | Ключи `WINDOW.*`: общие действия и отдельно demo-надписи. |
| `components/index.ts`, `customization/index.ts`, `openvidu-components/index.ts` | Экспорты iframe, demo-панели, оболочки и состояния. |

Ещё два места вне `M`:

- `meet-ce/frontend/src/assets/plugin-demo/transcript.html` — статическая адаптивная транскрипция с заметками; это тестовые данные, не распознавание речи.
- `meet-ce/frontend/projects/shared-meet-components/src/lib/domains/embedded/services/iframe-bridge.service.ts` — существующий bridge **между внешним host и всем Meet** теперь дополнительно проверяет `event.source === window.parent`. Это защитная правка, её не нужно убирать вместе с demo. Этот bridge **не** является API дочерних плагинов.

### Поток данных сейчас

```text
MeetingPluginDemoPanelComponent.add
  → MeetingCustomLayoutComponent.addDemoPlugin()
  → signal<readonly PluginWindow[]>([])
  → SmartLayoutComponent.pluginWindows input
  → BaseLayoutComponent.pluginWindows input
  → WindowShellComponent + PluginIframeWindowComponent
```

Размещение независимо от этого массива хранится в `StreamLayoutStateService`:

```text
windowPlacement(id) → { mode: 'grid' | 'floating' | 'minimized', rect? }
setWindowMode(id, mode)
setWindowRect(id, rect)
clearWindow(id)
clearAllViewState()
```

Отсутствующая запись означает `grid`. Унаследованный `isStreamFloating(id)` означает **«не в сетке»**: он возвращает `true` и для `minimized`. Для реальной видимости нужно читать `mode`, не этот boolean.

`clearWindow(id)` очищает только локальное размещение, pin и активный ID. Он **не удаляет descriptor из массива, не уничтожает iframe и не останавливает backend плагина**. Для удаления UI будущий lifecycle должен убрать descriptor из источника окон и очистить его локальное состояние.

## 3. Временные решения и как их убрать

### A. Убрать только временную панель, сохранив поддержку iframe

1. В `M/customization/meeting-custom-layout/meeting-custom-layout.component.html` удалить `<ov-meeting-plugin-demo-panel ... />`.
2. В соответствующем `.ts` удалить import `MeetingPluginDemoPanelComponent` и его элемент из `@Component.imports`, а также `canAddPlugin` и `addDemoPlugin()`.
3. Если демопанель больше нигде не нужна, удалить её компонент и export из `M/customization/index.ts`.
4. Удалить только demo-ключи `WINDOW.DEMO`, `WINDOW.ADD_DEMO`, `WINDOW.DEMO_LIMIT` из всех десяти локалей. Общие `WINDOW.FLOAT`, `REATTACH`, `MINIMIZE`, `RESTORE` и остальные window-ключи оставить.
5. Сценарий в `e2e/windows.test.ts`, который нажимает demo-кнопку, перевести на новый источник окон либо удалить только demo-specific часть. Проверки media-окон и общей оболочки оставить.

**Не удалять** `pluginWindows`, передачу через inputs, `hasVisiblePlugin`, общий iframe-компонент и cleanup, если вместо demo уже подключается реальный источник. Панель — только entry point; отсутствие панели не требует переписывать окна.

### B. Убрать demo-контент и hardcoded-ограничения при подключении API

В `MeetingCustomLayoutComponent` заменить локальное наполнение `pluginWindows` данными актуальных разрешённых активаций. Исчезают:

- `plugin:demo-1` … `plugin:demo-4` и заголовки `Demo N`.
- Жёсткий лимит четыре в `canAddPlugin`, тексте панели `(…/4)` и demo E2E.
- URL `assets/plugin-demo/transcript.html` и сам asset после перевода тестов на fixture/реальный тестовый плагин.

Четыре — лимит **локальной демонстрации**, а не квота платформы и не защита будущего API. Общий `BaseLayoutComponent` сам число plugin descriptors не ограничивает. Реальные квоты и бюджет iframe должны проверяться сервером и отображаться UI.

URL demo сейчас строится через `RuntimeConfigService.resolveUrl(...)`: это учитывает base path и удалённый сервер Meet в webcomponent. Сам resolver не удалять и не заменять относительными URL host-страницы. Для внешних плагинов брать проверенный `uiUrl` из доверенного каталога.

### C. Полностью отключить plugin UI, сохранив плавающие media-окна

Если API ещё нет, а демонстрация больше не нужна:

1. Выполнить удаление панели и demo-ключей из пункта A.
2. Удалить из custom layout `pluginWindows`, `hasVisiblePlugin`, plugin-only `ngOnDestroy`, ненужные imports/inject и `[pluginWindows]` binding. Убрать только `!this.hasVisiblePlugin()` из обоих alone overlay predicates; исходные проверки alone/embedded/access link оставить.
3. Из Smart Layout удалить `pluginWindows` input и его передачу в Base Layout.
4. Из Base Layout удалить `PluginWindow` input/import, plugin `@for`, plugin-часть `minimizedWindows` и `layoutShape`; общую оболочку и док оставить.
5. Удалить `PluginIframeWindowComponent`/`PluginWindow`, его export и demo asset, если больше нет потребителей. Проверить barrel exports и тестовые fixtures.
6. Общие window state, screen-share изменения, Smart Mosaic detached-логику, единый звук и parent-source проверку host bridge **сохранить**.

Это отключение плагинов, не откат всей фичи плавающих окон.

### D. Полный откат всей фичи

Откатывать целиком согласованный diff/выделенный feature-коммит: изменения затрагивают общий рендер, state readers, Smart Mosaic, media controls, lifecycle, локали, экспорты и E2E helpers. Простое удаление `window-shell/` оставит некомпилируемый/несогласованный frontend.

На момент подготовки документа фича находилась в рабочем дереве, отдельный feature-коммит в рамках этой работы не создавался. Поэтому универсальная команда `git revert <hash>` здесь не указана. Перед откатом нужно выделить именно этот diff, сохранить последующие изменения и отдельно учесть новые untracked-файлы; `git reset --hard`, `git clean` и массовый `git restore` для этой задачи не нужны. Откат удаления demo в разделах A–C также не требует удалять весь window-фундамент.

## 4. Что делать, когда появится API плагинов

### 4.1. Заменить источник окон, не оконную механику

Основная точка — `MeetingCustomLayoutComponent.pluginWindows`. Вместо `addDemoPlugin()` сюда должен попадать актуальный список разрешённых UI-экземпляров. Если асинхронный lifecycle станет общим для панели и layout, его состояние можно вынести в meeting-scoped сервис **по реальной необходимости**; drag/resize в него переносить не нужно.

Текущий frontend-тип:

```ts
interface PluginWindow {
    id: string;
    title: string;
    url: string;
}
```

Это внутренний descriptor UI, **не** DTO будущего API. После определения контракта нужен небольшой mapping ответа API в него и, при необходимости, дополнительные runtime-поля для handshake/статуса. Не надо превращать backend activation в `ParticipantModel`.

ID должен быть стабильным при повторном событии/получении snapshot, отдельным от media stream IDs и новым для действительно новой активации. Не использовать индекс массива, название или URL как identity. Пространство `plugin:…` сохраняет отличие от камер/экранов; конкретный состав ключа зависит от будущих `pluginId`, `activationId` и viewer scope.

Обновление server snapshot не должно беспричинно удалять и заново вставлять тот же iframe или присваивать новый `src`. Локальная геометрия хранится отдельно от server activation state и не должна сбрасываться при каждом событии API.

### 4.2. Реализовать жизненный цикл активаций

Понадобятся:

- Получение каталога и текущих активаций, отображение только разрешённых пользователю UI.
- Запрос активации с серверной проверкой прав/квот и идемпотентностью; асинхронная готовность backend не блокирует звонок.
- Snapshot для late join/reconnect и согласование с приходящими событиями без дублей.
- Состояния запуска/ошибки/недоступности UI. Сейчас специального loading/error/retry-интерфейса нет, обычная загрузка iframe не равна готовности SDK.
- Остановка/истечение разрешений/завершение звонка: убрать descriptor, уничтожить соответствующий iframe, очистить `clearWindow(id)`, message listeners и ресурсы. Не ждать ответа iframe для остановки.
- Разделение per-call/per-user активации, адресатов UI и личного сворачивания.
- Отзыв прав и смена роли в уже открытом окне.

`minimized` — только локальный UI-режим, не команда остановки. По спецификации backend обрабатывает разрешённые источники независимо от iframe. Текущее отсутствие крестика не запрещает платформе убрать UI после реальной деактивации.

### 4.3. Заменить demo-политику iframe перед загрузкой чужого кода

Сейчас `PluginIframeWindowComponent` вызывает `bypassSecurityTrustResourceUrl` для встроенного URL. **Валидации произвольных URL там нет.** Нельзя просто начать передавать туда строки из пользовательского ввода/непроверенного API.

Для production-интеграции:

1. На границе trusted Registry/Manager проверить URL, допустимые HTTPS scheme/origin, отсутствие credentials и соответствие описанию плагина. `bypassSecurityTrustResourceUrl` только снимает Angular-проверку resource URL, он не является проверкой безопасности.
2. Размещать страницу плагина на отдельном от Meet origin. Demo работает со `sandbox="allow-scripts"` **без** `allow-same-origin`: это намеренно более строгая изоляция same-origin asset, не готовая production-конфигурация SDK.
3. Для отдельного проверенного origin согласовать sandbox из спецификации `allow-scripts allow-same-origin`. Не включать эту комбинацию у same-origin страницы: она не обеспечивает ожидаемую изоляцию. Медиа, геолокацию, top navigation, popups и прочие возможности не разрешать автоматически.
4. Настроить parent/host CSP `frame-src`; разработчик плагина должен разрешить embedding через `frame-ancestors` и не конфликтовать с `X-Frame-Options`. Для webcomponent действует также CSP внешнего host-документа.
5. CORS настраивается для API-запросов iframe к своему backend, а не как обход запрета встраивания. Общего proxy/CORS bypass эта реализация не содержит и не требует.

Текущий sandbox даёт opaque origin; его нельзя без пересмотра перенести на протокол, где требуется проверять реальный origin страницы. Не решать это через `targetOrigin: '*'` для передачи подписанного контекста — нужен правильный отдельный origin и согласованная sandbox-политика.

### 4.4. Добавить отдельный bridge UI Adapter ↔ iframe плагина

Сейчас дочерний iframe **не обменивается сообщениями с Meet**. SDK-ready, signed launch context, capabilities и token refresh/revocation ещё не реализованы.

При появлении контракта:

- Дождаться подтверждённой готовности SDK, проверить формат/версию и передавать signed context только точному origin ожидаемого iframe.
- Проверять одновременно `event.origin`, `event.source === iframe.contentWindow` и соответствие активному подключению. Поддерживать несколько iframe: сообщение одного не должно влиять на другой.
- Не передавать OpenVidu secret, access token или E2EE key; signed context не помещать в URL. Не логировать секреты; контекст и сессию хранить в памяти по требованиям спецификации.
- Проверять типы/размер сообщений, permissions и rate limits; авторизация остаётся серверной, проверка в браузере её не заменяет.
- Обычные бизнес-запросы плагина идут к его backend. Вызовы возможностей звонка идут через UI Adapter и наш backend.
- Очистить listeners/ожидания при исчезновении/замене активации. Результаты остановленного или другого подключения отбрасывать.

Существующий `domains/embedded/services/iframe-bridge.service.ts` имеет **другое направление**: внешний host управляет всем Meet. Не расширять его whitelist так, чтобы команды от дочерних плагинов принимались как host-команды; сохранить проверку настоящего parent.

### 4.5. Согласовать до реализации API

Спецификации ещё не задают окончательные схемы. Нужны решения о:

- endpoint/event names, versioning, подписанном контексте, expiration и протоколе ready;
- соответствии «один UI на плагин» и `activationId`, включая несколько scope/активаций одного плагина;
- правах запуска/остановки и адресатах per-call/per-user UI;
- восстановлении snapshot после reconnect, ordering/idempotency событий;
- том, будут ли вообще доступны отдельные «закрыть UI» и «остановить плагин»;
- реальных бюджетах iframe/ресурсов и отображении исчерпанной квоты;
- loading/error/retry и поведении при запрещённом embedding.

Геометрия окон, док и grid layout при этом уже реализованы и не требуют перепроектирования.

## 5. Что нельзя случайно сломать

- **Не создавать второй Smart Layout** для плавающих окон: он создаст второго владельца remote audio и конфликт за layout service.
- **Не разносить iframe по трём `@if`/outlets** grid/float/minimized и не перемещать его между DOM-родителями. Менять placement/CSS у того же host.
- Сохранить стабильный `track plugin.id` и отдельные ключи camera/screen. Участник с выключенной камерой остаётся тем же окном.
- Откреплённая камера должна входить в рендер независимо от speaker grid selection и не попадать в hidden-camera pause как невидимая.
- Док и interaction shields не должны становиться обычными измеряемыми плитками `#layout`. Layout engine исключает `OV_floating`/`OV_ignored`.
- Pointer-защита во время drag/resize нужна и при пересечении **другого** iframe, не только собственного.
- Размеры и DOM-поиски должны работать внутри Shadow DOM; не переносить окна в `document.body`.
- Не приравнивать вызов `clearWindow()` к деактивации, а boolean `isStreamFloating()` — к видимости.
- При замене demo сохранить условие скрытия alone overlay, пока виден iframe: число реальных участников плагин не увеличивает.

## 6. Проверки и зафиксированный результат

Проверки, добавленные/обновлённые вместе с фичей:

- `M/openvidu-components/services/layout/stream-layout-state.service.spec.ts` — переходы, геометрия, pin, автоматика камеры, независимость screen и cleanup.
- `M/openvidu-components/components/layout/window-shell/window-shell.component.spec.ts` — iframe DOM/window и заметки, bounds, двухмерный resize, pointercancel и клавиатура.
- `M/openvidu-components/components/layout/base-layout.component.spec.ts` — CDK drag-to-dock, восстановление, сохранение iframe и исчезновение shields при удалении перетаскиваемого окна.
- `M/openvidu-components/components/layout/smart-layout/smart-layout.component.spec.ts` — refill сетки, ротация, hidden video и единый audio attach.
- `domains/embedded/services/iframe-bridge.service.spec.ts` — отказ принимать child-frame сообщение даже с доверенным origin.
- `meet-ce/frontend/e2e/windows.test.ts` — demo limit, iframe state, drag/resize/dock, узкий viewport, remote avatar/camera и screen-share lifecycle.
- `e2e/helpers/stream.helper.ts` и `e2e/stream.test.ts` — старые local-only ожидания адаптированы к общим controls и свободному resize.

Команды из корня `openvidu-meet` после установки Node/pnpm из README:

```bash
pnpm install --frozen-lockfile
./meet.sh build-typings
pnpm --filter @openvidu-meet/frontend run lib:build
pnpm --filter @openvidu-meet/frontend run build
pnpm --filter @openvidu-meet/webcomponent run build:wc:bundle
pnpm --filter @openvidu-meet/frontend run lint
pnpm --filter @openvidu-meet/frontend run test:types:e2e
pnpm --filter @openvidu-meet/frontend run test:unit:lib
```

Karma нужен Chrome/Chromium; при нестандартной установке задать `CHROME_BIN`. Для целевого прогона затронутых unit-проверок:

```bash
pnpm --filter @openvidu-meet/frontend run test:unit:lib \
  --include='**/components/layout/**/*.spec.ts' \
  --include='**/stream-layout-state.service.spec.ts' \
  --include='**/meeting-events.service.spec.ts' \
  --include='**/iframe-bridge.service.spec.ts'
```

Для E2E нужны запущенные Meet backend, LiveKit, MongoDB, Redis и storage:

```bash
pnpm --filter @openvidu-meet/frontend run e2e:playwright:spa windows.test.ts
```

**Результат проверки реализации 2026-10-19, не обещание будущего прогона:**

- Библиотека, SPA, webcomponent, ESLint и Playwright typecheck — успешно.
- Целевой набор — **87 успешных проверок**.
- Последние полные прогоны — **685 успешных, 1 неуспешная**: `SidenavLayoutDirective — recomputes the layout repeatedly while the sidenav changes width, then leaves it alone`, таймаут. Сбой воспроизвёлся отдельно; код/тест этой директивы в фиче не менялся. Отдельный более ранний полный прогон проходил успешно, поэтому весь набор не следует обозначать как стабильно зелёный.
- E2E реального звонка и runtime smoke внешнего host/webcomponent **не выполнены**: локальный Meet backend был недоступен. Сборка webcomponent не заменяет проверку в браузере на внешнем host.

После перехода на API особенно проверить ready/context routing для нескольких плагинов, revoke/stop при свёрнутом iframe, late join/reconnect без дубликатов, CSP на внешнем host и неизменность звука во время всех UI-переходов.
