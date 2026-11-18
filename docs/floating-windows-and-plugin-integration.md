# Плавающие окна и контейнеры плагинов

Оконная механика используется для медиа и iframe активированных плагинов. Настройка Manager, demo и серверный контракт описаны в [plugin-activation.md](plugin-activation.md).

## Что работает сейчас

Камера, аватар, демонстрация экрана и iframe плагина используют общую оболочку `WindowShellComponent` через композицию. `MeetingCustomLayoutComponent` подаёт в Smart Layout окна активированных плагинов. Видимый iframe замещает экран ожидания или приглашения для участника, который находится в звонке один.

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

| Файл                                                                                       | Ответственность                                                                                                  |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `openvidu-components/components/layout/window-shell/window-shell.component.{ts,html,scss}` | Controls, CDK drag, pointer/keyboard resize, bounds и `ng-content`                                               |
| `openvidu-components/services/layout/stream-layout-state.service.ts`                       | Размещение по ID, геометрия, активное окно, pin/float и очистка                                                  |
| `openvidu-components/components/layout/base-layout.component.{ts,html,scss}`               | Общие оболочки media/iframe, док, drop hit-test, восстановление и измерение сетки                                |
| `openvidu-components/components/layout/smart-layout/smart-layout.component.{ts,html}`      | Grid selection и detached/minimized камеры, hidden video, единственный audio-контейнер; передача `pluginWindows` |
| `openvidu-components/models/participant.model.ts`                                          | Раздельные ID и floating-состояния камеры и screen stream                                                        |
| `openvidu-components/services/meeting-events/meeting-events.service.ts`                    | Автоматический pin screen share и очистка на `TrackUnpublished`                                                  |
| `openvidu-components/services/screen-share/screen-share.service.ts`                        | Pin локального экрана и очистка геометрии при остановке                                                          |
| `components/plugin-iframe-window/plugin-iframe-window.component.ts`                        | Описатель `PluginWindow`, проверка адреса внешнего iframe и изолированный demo iframe                            |
| `customization/meeting-custom-layout/meeting-custom-layout.component.{ts,html}`            | Подаёт `pluginWindows` в Smart Layout и управляет экранами ожидания                                              |

Внешний host bridge находится в `domains/embedded/services/iframe-bridge.service.ts`. Он предназначен для управления **всем Meet со стороны родительского host**, а не для дочерних iframe плагинов. Проверку `event.source === window.parent` необходимо сохранить.

## Контракт оконной механики

Окна проходят через следующие компоненты.

```text
PluginActivationService.windows → PluginWindow[]
  → SmartLayoutComponent.pluginWindows
  → BaseLayoutComponent.pluginWindows
  → WindowShellComponent + PluginIframeWindowComponent
```

`PluginWindow` содержит ID и заголовок, а также URL внешнего iframe или признак demo. ID окна имеет вид `plugin:<activationId>`. При опросе тот же ID сохраняет DOM и геометрию. Iframe не создаёт LiveKit-участника и не публикует RTC-поток.

`StreamLayoutStateService` хранит локальное размещение независимо от descriptors:

```text
windowPlacement(id) → { mode: 'grid' | 'floating' | 'minimized', rect? }
setWindowMode(id, mode)
setWindowRect(id, rect)
clearWindow(id)
clearAllViewState()
```

Отсутствующая запись означает `grid`. `isStreamFloating(id)` включает `minimized`. Когда окно исчезает из состояния звонка, сервис активации удаляет его из layout и вызывает `clearWindow(id)` для очистки локального размещения. Остановка плагина требует отдельного вызова Manager.

## Перед открытием внешнего iframe

Meet проверяет URL на backend и в клиенте перед передачей Angular. Внешний UI открывается по HTTPS с отдельного origin, в `sandbox="allow-scripts allow-same-origin"` и с запретом камеры, микрофона, захвата экрана и геолокации. Для demo используется фиксированный `srcdoc` с полным sandbox. Политика встраивания браузера задаётся также ответом страницы плагина и CSP хоста.

Подписанный контекст и bridge для дочернего iframe остаются следующим этапом. Обработчик должен проверять готовность SDK, версию и размер сообщения, точные `event.origin`, `event.source === iframe.contentWindow` и привязку к активации. [Архитектура](../../specs/specs/plugin-service-architecture/spec.md), [переход на обновлённые компоненты](plugin-activation.md#как-перейти-на-обновлённые-сервисы).

## Инварианты при дальнейших изменениях

- Не создавать второй Smart Layout ради iframe: иначе появятся конкурирующие владельцы audio и layout service.
- Не разносить iframe по отдельным `@if`/outlets grid/float/minimized и не переносить между DOM-родителями. Менять placement/CSS того же host, сохранять стабильный `track plugin.id`.
- Сохранять стабильный ID камеры при выключении видео и отдельный ID screen share. Откреплённая камера должна оставаться в рендере вне speaker grid selection; видимое floating-видео нельзя останавливать как hidden.
- Не включать док и interaction shields в измеряемые layout-плитки; layout engine исключает `OV_floating`/`OV_ignored`. Во время drag/resize нужна защита при пересечении любого iframe.
- Поддерживать Shadow DOM, не переносить окна в `document.body`.
- Не путать локальное размещение с серверным lifecycle и не сбрасывать геометрию при каждом обновлении активаций.

## Проверки

Co-located unit-тесты `window-shell.component.spec.ts`, `base-layout.component.spec.ts`, `smart-layout.component.spec.ts` и `stream-layout-state.service.spec.ts` покрывают DOM iframe, геометрию, drag/dock, Smart Mosaic, audio и cleanup. Это тестовые descriptors iframe, а не подключённые плагины Registry.

`meet-ce/frontend/e2e/windows.test.ts` содержит проверку каталога с подменённым HTTP-ответом и сценарий открепления remote avatar/camera и screen share без дублирования audio. Для E2E нужна работающая инфраструктура Meet/LiveKit и хранилищ. [Проверка демо](plugin-activation.md#проверка-демо).
