# Дослідження скрипта VoxArbor UA 0.10.4 (www.youtube.com і m.youtube.com)

Етап 1 (лише дослідження, без змін коду), 2026-11-21. Джерело: `origin/main` = тег `v0.10.4` (870201c). Копія, яку
віддає сервер (`server/app/userscript/voxarbor.user.js`, `TAG` = `v0.10.4`), байт у байт збігається зі збіркою
`node build.mjs` (окрім підстановки адреси сервера). Посилання `файл:рядок` ведуть у `src/`.

## 0. Коротко

1. **Субтитри з телефона не доходять до сервера через дві речі в коді.** `collectPage` вмикає субтитри кнопкою
   `#movie_player .ytp-subtitles-button` (`adapters/youtube/page.ts:164`), а на m.youtube.com такої кнопки немає.
   Тому плеєр не робить власного запиту `timedtext` із `pot=`, скрипт 8 с чекає (`page.ts:182`) і віддає сторінку
   без `subs`. Далі `Poller.sendPage` надсилає сторінку **лише з `subs`** (`core/poller.ts:247`), тож сервер не
   отримує нічого, навіть назви доріжок, і через 20 с іде в yt-dlp/STT. Докази: розділ 9 (лог сервера й
   емуляція m.youtube.com: `#movie_player.getPlayerResponse` там є, кнопки CC немає). Із цього хоста YouTube не
   пускає відтворення (`LOGIN_REQUIRED`, перевірка на бота), тож саму поведінку timedtext/`pot` на телефоні
   перевірено лише за кодом.
   На m.youtube.com не приходить і `yt-navigate-finish`: навігацію ловить лише опитування раз на секунду.
2. Те саме з Shorts на комп'ютері: `playerResponse()` читає лише `#movie_player` і відкидає відповідь чужого відео
   (`page.ts:82-86`). У Shorts плеєр інший (`#shorts-player`), тож для Shorts сторінка не надсилається ніколи.
3. Скрипт синхронно викликає `GM_getValue`, `GM_setValue` і `GM_xmlhttpRequest` (`platform/gm.ts:324-327`). Там,
   де є лише асинхронний `GM.*` (Greasemonkey 4, частина iOS-менеджерів), він падає ще на старті (розділ 12).
4. Мертвого коду мало. Є дублікати (`OPEN_WINDOW_S` = `WINDOW_S`; два екземпляри `Previews` на одному
   `AudioContext`), застарілі браузерні харнеси `test/browser/*.js`, міграції налаштувань 0.1–0.2, застарілі
   коментарі й відставання `api/script-openapi.json` від серверного golden (розділ 10).
5. Сам `collectPage` тестами не покрито: тести є для його допоміжних функцій і для `sendPage` із підставленою
   сторінкою, а для кнопки CC, `PerformanceObserver`, мобільної розмітки й Shorts тестів немає (розділ 13).

## 1. Збірка й метадані

- `build.mjs`: esbuild збирає `src/main.ts` в один IIFE (es2020, без мініфікації). Над ним іде заголовок із
  `src/meta.ts`.
- Заголовок (`meta.ts:5-23`):
  - `@match *://*.youtube.com/*` (а з ним і music., studio., accounts. тощо) і `__VOXARBOR_SERVER__/panel/install*`;
  - `@grant GM_xmlhttpRequest, GM_getValue, GM_setValue, GM_registerMenuCommand, GM_openInTab, GM_setClipboard`;
  - `@connect *`, `@run-at document-idle`, `@noframes`;
  - `@downloadURL` і `@updateURL` ведуть на `__VOXARBOR_SERVER__/voxarbor.user.js`.
- `unsafeWindow` не запитується й не використовується. Об'єкти сторінки скрипт читає через DOM-елемент
  `#movie_player`, а у Firefox через `wrappedJSObject` (`page.ts:27-30, 84`).
- `@noframes` вимикає скрипт у вбудованих плеєрах (`/embed/` в iframe). `youtube-nocookie.com` теж не підходить
  під `@match`.
- Адресу сервера підставляє сам сервер, коли віддає файл (`settings/store.ts:7`). Налаштування сервера в UI немає.

## 2. Старт і пошук відео

1. Вхідна точка, `main.ts:215-223`. Якщо це сторінка панелі «Скрипт» (`onPanel`, `core/autolink.ts:195`), скрипт
   міняє одноразовий код на токен і закінчує роботу. Інакше `adapterFor(location)`
   (`adapters/registry.ts`) повертає єдиний адаптер `youtubeAdapter`, і далі працює `wire()`.
2. Відео сторінки, `pageVideoId` (`page.ts:76-78`): `?v=` або `/shorts/ID` чи `/live/ID`. Канонічна адреса завжди
   `https://www.youtube.com/watch?v=ID` (`adapters/youtube/index.ts:31-34`), і з m. теж. Через це сервер не бачить,
   з телефона прийшов запит чи ні: про пристрій каже лише User-Agent.
   - `/embed/ID` не розпізнається (null), тому на такій сторінці немає ні кнопок, ні озвучки.
   - music.youtube.com має `?v=`, тому кнопки там з'являються в режимі `overlay`/`float`. Ніхто цього не
     задумував і не перевіряв.
3. Елемент `<video>`, `getVideo` (`index.ts:6-10`): `#shorts-player video` на Shorts, інакше `#movie_player video`,
   а як запасний варіант `video.html5-main-video, video`. Плеєр шукається як `closest('.html5-video-player')`
   (`index.ts:12-15`). Реклама визначається класом `.ad-showing` на плеєрі (`index.ts:25-28`).
4. Відповідь плеєра (`playerResponse`), `page.ts:82-86`: `#movie_player.getPlayerResponse()` (у Firefox через
   `wrappedJSObject`). Її копіюють у звичайні дані (`readPlayer`, `page.ts:50-73`), бо у Firefox функції скрипта не
   можна викликати на масивах сторінки. Якщо `videoId` не збігається з адресою, результат null. Інших джерел
   (`window.ytInitialPlayerResponse`, `ytplayer.config`, `/youtubei/v1/player`) скрипт не читає.
5. SPA-навігація:
   - подія `yt-navigate-finish` (`index.ts:41-44`) і опитування `watch()` раз на секунду (`main.ts:202-212`), яке
     помічає зміну адреси без події;
   - `onNavigate` (`main.ts:174-188`) зупиняє сесію, скидає питання й панелі та переставляє кнопки;
   - перехід на інший момент того самого відео (`&t=`) нічого не скидає (`main.ts:176`).
6. Кнопки (`adapters/youtube/mount.ts`). Місце (`place()`, `mount.ts:71-86`):
   - `bar`: капсула перед `#movie_player .ytp-right-controls` (комп'ютер, звичайне відео);
   - `top`: рядок `#player-control-container .player-controls-top` (m.youtube.com) або
     `ytd-shorts-player-controls #right-controls` (Shorts на комп'ютері), див. `topRow`, `mount.ts:10-13`;
   - `overlay`: капсула в куті плеєра, яка ховається через 3,5 с (`autoHide`, `mount.ts:115-140`);
   - `float`: капсула над нижньою панеллю сторінки.

   Раз на секунду `wantsRemount` перевіряє, чи не з'явилося краще місце (`mount.ts:57-61`).

## 3. Увімкнення: що відбувається після натискання

1. `startChecked` (`main.ts:117-136`): якщо в YouTube є власна українська доріжка (`hasUkrainianDub`,
   `page.ts:206`; `captions.ts:45`), скрипт питає «Все одно озвучити?» і запам'ятовує відповідь у
   `GM ukDubOk` (до 300 відео).
2. `startReady` (`main.ts:148-170`) робить дві речі одночасно:
   - `session.prepare()` (`core/session.ts:204-215`), тобто **POST /v1/videos** з `page_support: true` і `from`.
     Сервер відкриває відео й чекає сторінку до 20 с (`server/app/services/pipeline.py:69, 765-772`);
   - `readyOffer` (`core/ready.ts`), тобто **GET /v1/voiced?url=**. Якщо відео майже повністю (≥ 80 %) озвучене
     іншими голосами, ще й **GET /v1/voices**, і глядач отримує питання з вибором голосу (`ui/ready.ts`).
3. `session.start()` (`session.ts:218-294`):
   - створює `AudioContext` (один на сторінку, `output()`, `session.ts:357-365`) і вішає слухачі на `<video>`;
   - бере відповідь `prepare`, якщо минуло менше 5 с і відео зрушило менше ніж на 5 с (`EARLY_MS`, `EARLY_NEAR`,
     `session.ts:15-16, 236-237`). Інакше робить ще один POST;
   - якщо відео на паузі, ставить `held`/`startHold` і показує «Чекаю озвучку…» (`session.ts:289-293`).

Наслідки:

- якщо глядач довго думає над питанням про готові голоси (понад 5 с), POST повторюється;
- якщо глядач натиснув «Скасувати», сервер уже відкрив відео й 20 с чекав сторінку.

## 4. Обмін із сервером (/v1)

Усі запити йдуть через `GM_xmlhttpRequest` (`api/client.ts:114-158`):

- тайм-аут 30 с;
- `Authorization: Bearer <token>` лише на свій сервер;
- аудіо приходить як `arraybuffer`;
- у журнал іде рядок на кожен запит із часом і `server-timing`.

| Запит | Коли | Де |
|---|---|---|
| POST /v1/videos `{url, voice, mode, lead_*, page_support:true, switch, from, paused?, tab}` | увімкнення (prepare/poll); зміна голосу чи режиму (`switch:true`); «Озвучити моїм голосом» | `poller.ts:54-60, 75-104`; `client.ts:64-66` |
| POST /v1/videos `{url, page_support, page}` | лише після `page_needed` і лише якщо `collectPage` знайшов `subs` | `poller.ts:88, 193, 241-251` |
| GET /v1/videos/{key}/segments?from&window=150[&paused=1]&tab | вікно фраз: поки статус не ready, кожні 3 с (`POLL_MS`); у стані ready — коли до кінця вікна менше 100 с (`needFetch`), є фрази без аудіо (`windowIncomplete`) або минуло 60 с (`HEARTBEAT_MS`), перевірка раз на 1 с; під час `held` теж раз на 1 с | `poller.ts:105-109, 169-181`; `scheduler.ts:98-100` |
| GET {audio path} (`/v1/audio/{hash}.opus`) | аудіо фраз, до 3 паралельно, найближчі спершу, після збою повтор через 5 с | `core/loader.ts:6-7, 18-44` |
| GET /v1/voiced, GET /v1/voices | перед стартом; список голосів (кеш на токен) | `ready.ts`, `ui/ui.ts:66-76` |
| GET /v1/videos/{key}/voices, /speakers, PUT …/speakers/{id} | вкладки «Голоси» і «Мовці» | `ui/settings.ts` |
| POST /v1/device/code, /v1/device/token | «Підключити» (RFC 8628) і автопідключення на «Скрипт» | `core/signin.ts`, `core/autolink.ts` |
| GET /v1/voices/{id}/sample.opus | зразки голосів | `ui/preview.ts:16-30` |

Відповідь POST містить `window` (фрази від `from` на 150 с, `OPEN_WINDOW_S`), тому окремий GET одразу після
відкриття не потрібен (`poller.ts:99-103`). Параметр `tab` — випадковий id вкладки (`client.ts:50`), щоб сервер
рахував дві вкладки як двох глядачів.

**Помилки** (`poller.ts:120-149`):

- **401**: зупинка. Якщо інша вкладка вже підключилася, скрипт стартує знову з її токеном (`main.ts:64-77`), інакше
  забуває токен і відкриває налаштування.
- **408 і 429**: стан `offline` («Сервер озвучки зайнятий, повторю за 10 с»), повтор через 10 с, утримання відео
  знімається.
- **Інші 4xx** (400, 403, 404, 413, 422): фатальна зупинка з тостом. Тост показує лише `HTTP 404`, без пояснення
  людською мовою. Зверніть увагу: 404 на `segments` (наприклад, після очищення бази) теж вимикає озвучку.
- **5xx, мережа, тайм-аут, не-JSON (статус 0)**:
  - якщо вже завантажено ≥ 15 с аудіо наперед і сервер мовчить менше 3 хв, скрипт **тихо повторює** через 2, 4,
    8, далі кожні 10 с (`quietOutage` і `quietRetry`, `scheduler.ts:253-260`; 0.10.4). Глядач нічого не бачить,
    у журналі є рядок;
  - інакше стан `offline` («Сервер озвучки недоступний, повторю за 10 с»), повтор кожні 10 с, і відео
    відпускається (`playback.release`).
- Помилки збору й надсилання сторінки скрипт лише пише в консоль (`poller.ts:249`), у журнал вони не потрапляють.
  Тому з журналу телефона не видно, що сторінку не надіслано.

## 5. Субтитри (collectPage, `page.ts:147-203`)

1. Сервер ставить `page_needed` у відповіді POST або GET segments. `sendPage` (`poller.ts:241-251`) викликає
   `collectPage` один раз за увімкнення (`s.pageSent`).
2. Без `playerResponse()` результат null. Скрипт будує `page`:
   - `video_id`, `title`, `duration`, `channel`;
   - `lang` = мова оригінальної аудіодоріжки (`originalLang`, `captions.ts:34-41`): доріжка `.4`, інакше
     стандартна, якщо вона не дубляж `.10`/`isAutoDubbed`. Для відео з однією доріжкою зазвичай **null**;
   - `caption_tracks` = список усіх доріжок (`listed`, `captions.ts:102-105`).
3. Вибір доріжки (`pickCaption(originalCaptions(...))`, `captions.ts:54-70`):
   - `originalCaptions` бере лише доріжки оригінального аудіо, коли їх кілька (AI-дубляжі);
   - `pickCaption` шукає ручну доріжку мовою оригіналу, потім її asr, потім **будь-яку ручну**, потім першу.
     Мова порівнюється за базою (`en-US` → `en`). Якщо `lang` = null (одна аудіодоріжка), береться перша ручна,
     наприклад `en-US` у wdpjv2enZLM;
   - якщо доріжок немає взагалі, сторінка повертається без `subs`, і `sendPage` її **не надсилає**.
4. Токен `pot`. `/api/timedtext` без PO-токена повертає порожню відповідь, тому скрипт бере **власний запит
   плеєра**:
   - шукає в `performance.getEntriesByType('resource')` URL з `/api/timedtext`, `pot=` і `v=ID`, а потім ловить
     нові через `PerformanceObserver` (`page.ts:166-173`);
   - якщо такого запиту ще не було, а кнопка `#movie_player .ytp-subtitles-button` є, натискає CC (якщо субтитри
     вже були ввімкнені, то двічі: вимкнути й увімкнути);
   - чекає до 20 × 400 мс = 8 с і повертає CC як було (`page.ts:175-186`);
   - **якщо кнопки немає, нічого не натискає і просто чекає 8 с.**
5. Із запиту плеєра скрипт робить URL потрібної доріжки (`trackUrl`, `page.ts:114-123`): `fmt=json3`, `lang`,
   `kind=asr`, а `tlang` прибирає, щоб YouTube не підсунув переклад (0.10.2). Запит іде через `fetch(..., credentials:
   'include')` у контексті сторінки (`json3At`, `page.ts:93-101`). Якщо відповідь порожня, скрипт бере доріжку,
   яку просив сам плеєр (`playerTrack`, `page.ts:192-197`).
6. Додаткові доріжки (`extraTracks`, `captions.ts:77-99`; `moreTracks`, `page.ts:133-142`), у межах 4,5 МБ
   (`TRACKS_ROOM`):
   - ручна доріжка мови мовлення і її asr;
   - англійська: ручна, інакше машинний переклад asr (`tlang=en`), якщо мовлення не англійське;
   - українська: ручна, інакше переклад YouTube головної доріжки (`tlang=uk`), якщо мовлення не українське (0.10.3).
7. Результат: `{..., subs: 'manual'|'asr', subs_lang, json3, tracks?}`, який іде окремим POST /v1/videos.

## 6. Аудіо

- **Завантаження**: `Loader.pump` (`loader.ts:18-44`):
  - до 3 фраз паралельно, найближчі спершу (`nextToLoad`, `scheduler.ts:159-170`);
  - `GM_xmlhttpRequest` повертає `arraybuffer`, далі `ctx.decodeAudioData`;
  - після збою пауза 5 с і новий запит, без обмеження кількості спроб.
- **Що тримається в пам'яті**: фрази від 30 с позаду до 160 с попереду (`outOfReach`, `scheduler.ts:239-241`;
  коментар там застарів: «120 s»).
- **Розклад** (кожен кадр, `Playback.tick`, `core/playback.ts:37-68`, через `requestAnimationFrame`; на паузі
  `tick` викликає poller):
  - фраза стартує від 150 мс до свого початку; до 600 мс після початку стартує завжди, далі лише якщо лишилося
    ≥ 0,7 с (`due`, `scheduler.ts:27-43`);
  - якщо попередня фраза ще звучить, нова чекає до 1 с у межах вільного місця свого слоту, а попередня затухає
    за 80 мс (`nextStart`, `roomOf`, `fadeStop`);
  - джерело: `AudioBufferSourceNode`, свій `GainNode`, далі спільний гейн гучності голосу (`playback.ts:139-160`).
- **Приглушення оригіналу**: `video.volume` плавно (0,25 с) опускається до `base × origVolume` (типово 10 %) на
  весь сеанс (`duckAlways`, типово увімкнено) або біля фраз (`shouldDuck`). Гучність, яку змінив користувач або
  YouTube, стає новою базою (`foreignVolume`, `adoptVolume`, `playback.ts:16-23`). Під час реклами (`.ad-showing`)
  і прослуховування «Оригіналу» скрипт не втручається.
- **Швидкість**: `src.playbackRate = video.playbackRate` для нових фраз і `ratechange` для тих, що вже звучать
  (`session.ts:279`). Висота тону **не зберігається**, тож на 2× голос звучить як у бурундука. Час старту
  фрази, яку вже заплановано наперед зі старою швидкістю, не перераховується.
- **Перемотка** (`seeking`, `session.ts:254-263`): усе зупиняється, скидаються `done`, вікно й `voicedUntil`,
  `gen++`. Аудіо фраз, уже відомих на новому місці, запитується одразу, а вікно нового місця — новим GET.
- **Буферизація** (`waiting`): контекст на паузі, поки не прийде `playing` або `timeupdate` з `readyState > 2`
  (`session.ts:265-284`). На паузі відео контекст теж призупиняється.
- **Утримання відео**:
  - `prepare` (`playback.ts:103-120`): для готового відео, якщо аудіо фрази на поточному місці ще немає, пауза до
    1,5 с («Готуємо озвучку…»);
  - `hold` (`playback.ts:163-180`; `holdStep`, `scheduler.ts:228-236`): з `waitForVoice` (типово увімкнено) і
    відомим вікном, якщо озвучено менше 1 с наперед, пауза («Чекаю озвучку…»). Відео відпускається, коли озвучено
    ≥ 10 с або коли після 8 с утримання ≥ 10 с озвучено далі за «застряглою» фразою. Для статусу ready, error чи
    offline не тримає ніколи (`mustWait`, `scheduler.ts:134-144`);
  - увімкнення на паузі (`startHold`): відео стартує само, коли голос готовий;
  - якщо вимкнути озвучку під час утримання, відео продовжить грати. Відео, яке поставив на паузу глядач,
    залишиться на паузі (`session.ts:316-318`).
- **Змінений хеш аудіо** (фразу переозвучено: новий текст чи голос) (`poller.ts:196-199`):
  - якщо в нової версії вже є `audio` з іншим шляхом, старий буфер видаляється, і `Loader` завантажує новий;
  - поки нового аудіо немає (`audio: null`), фраза **лишається зі старим шляхом**: краще старе, ніж тиша;
  - якщо фраза вже прозвучала (`done`), повторно вона не грає.
- **Зміна голосу** (`voicesChanged`, `session.ts:340-354`): усе, що звучить, зупиняється, буфери й фрази
  скидаються, далі новий POST із `switch`.
- **Вимкнення** (`stop`, `session.ts:296-321`): фрази й декодоване аудіо зберігаються 60 с (`PARK_MS`). Якщо за
  цей час увімкнути те саме відео тим самим голосом, скрипт лише запросить вікно.

## 7. Вкладки, вхід, налаштування

- **Налаштування** зберігаються в `GM_getValue('settings')` (`settings/store.ts`). У кожної вкладки своя копія.
  `save()` записує лише те, що змінила ця вкладка, поверх свіжого значення (`store.ts:89-95`). Зміни інших вкладок
  підтягуються на `visibilitychange` (`main.ts:108-113`); `GM_addValueChangeListener` не використовується.
  Повзунки записуються через 400 мс після зупинки, і ще раз на `pagehide`.
- Інші значення в GM: `ukDubOk` (до 300 відео) і `videoVoice` (голос, вибраний для конкретного відео, до 300).
- **Кілька вкладок**: у кожної свій `tab`-id, своя сесія й свій `AudioContext`. Якщо 401 прийшов через те, що
  інша вкладка підключилася, вкладка перепідключається з новим токеном (`main.ts:64-69`).
- **Вхід**:
  1. «Підключити» в налаштуваннях: `POST /v1/device/code`, далі `GM_openInTab(SERVER/panel/connect?code=…)`
     (`platform/gm.ts:331-334`; якщо функції немає, `window.open`), далі опитування `/v1/device/token` з
     `interval`, `slow_down` +5 с, із врахуванням `expires_in` (`signin.ts:142-164`). Назва пристрою береться з
     UA (`deviceName`).
  2. Або автоматично на сторінці «Скрипт» панелі: одноразовий код із `#script-link` (`autolink.ts:211-244`).
  3. «Відключити» лише забуває токен у скрипті.
- **UI** (лише DOM-виклики, бо YouTube вимагає Trusted Types; `check.sh` перевіряє відсутність `innerHTML`):
  - дві кнопки: перемикач і «tune». Довге натискання (600 мс) або правий клік відкриває налаштування
    (`ui/buttons.ts`);
  - швидка панель над плеєром; якщо плеєр нижчий за 320 px (портретний телефон), вона стає листом унизу
    (`ui/quick.ts:28-46`);
  - вікно налаштувань із вкладками «Основні», «Голоси», «Мовці» (`ui/settings.ts`);
  - діалоги; тости (6 або 12 с);
  - у повноекранному режимі вікна переходять в елемент на весь екран (`ui/dom.ts:152-166`);
  - «Копіювати журнал»: `GM_setClipboard`, інакше `navigator.clipboard`. Також `?vxdebug=1`.

## 8. m.youtube.com: чим відрізняється в коді

| Місце | Комп'ютер | Телефон (m.youtube.com) |
|---|---|---|
| Кнопки | `bar` у `.ytp-right-controls` | `overlay`, потім `top` у `.player-controls-top` (`mount.ts:71-86`) |
| Відповідь плеєра | `#movie_player.getPlayerResponse()` | те саме: `#movie_player.html5-video-player.ytp-mweb-player` має `getPlayerResponse` (і `toggleSubtitlesOn`, `isSubtitlesOn`, `loadModule`, `getOption`), клієнт `MWEB`; є й `ytInitialPlayerResponse`, `ytplayer.config.args.raw_player_response` |
| Кнопка CC для `pot` | `.ytp-subtitles-button` | **немає** ні `.ytp-subtitles-button`, ні іншої кнопки CC у DOM до старту відтворення (перевірено); рядок `.player-controls-top` з'являється пізніше |
| SPA-подія | `yt-navigate-finish` | **не приходить**: m.youtube.com шле `state-navigatestart` / `state-navigateend` на `window` (перевірено); спрацьовує лише опитування `watch()` (до 1 с) |
| Shorts | `#shorts-player`; сторінка не надсилається (п. 0.2) | немає `#shorts-player`; `#movie_player` — плеєр самого Short (`videoId` збігається), тож `playerResponse()` тут працює; `getVideo` бере запасний `video.html5-main-video` |
| Швидка панель | у плеєрі | лист унизу, якщо плеєр < 320 px |
| Звук | `AudioContext` створюється в `start()`; між кліком і `start()` є `await readyOffer` (мережа) | на iOS `resume()` поза жестом може не спрацювати (розділ 11) |

## 9. Випадок 2026-11-21: youtube:wdpjv2enZLM із телефона пішов у STT

**Що бачив сервер** (лог `voxarbor-api`, 2026-11-21, тільки рядки `timing`):

```
19:18:21.343  POST /v1/videos 200                       ← prepare(): page_support:true, from
19:18:21.356  GET  /v1/voiced?url=…wdpjv2enZLM 200       ← readyOffer
19:18:24.647  GET  /v1/videos/youtube:wdpjv2enZLM/segments?from=2.52&window=150&tab=is7v1d6z 200
INFO video youtube:wdpjv2enZLM: no page within 20 s, fetching with yt-dlp
19:19:40.692  GET  /v1/voiced?url=…  (друге увімкнення)
```

За 20 с після відкриття не прийшло жодного POST із `page`.

**Ланцюжок у коді**:

1. Відповідь POST мала `page_needed`, тож `sendPage` → `collectPage` (`poller.ts:88, 241-246`).
2. `playerResponse()` на m.youtube.com працює: `#movie_player` є й має `getPlayerResponse` (див. нижче). Ручна
   `en-US` є в `captionTracks`. Аудіодоріжка одна, отже `lang` = null, і `pickCaption` бере першу ручну доріжку,
   тобто `en-US` (`captions.ts:64-70`).
3. `document.querySelector('#movie_player .ytp-subtitles-button')` на m.youtube.com повертає **null**
   (`page.ts:164`). Нічого не натискається, і плеєр сам timedtext не просить (субтитри вимкнені).
4. 8 с очікування (`page.ts:182`) минають, `url` нема, і `collectPage` повертає сторінку **без `subs`**
   (`page.ts:187`).
5. `sendPage` надсилає лише сторінку з `subs` (`poller.ts:247`), тому не надсилає нічого й нічого не пише в
   журнал. Сервер чекає 20 с (`pipeline.py:765-772`) і запускає yt-dlp. Ручну `en-US` yt-dlp не знайшов
   (окреме питання, виправлено на сервері в 5631ffc), тож пішов STT.

**Емуляція** (Playwright 1.49.1 у docker `pw-local:1.49.1`, headless Chromium з профілями Pixel 7 та iPhone 14,
порівняння з Desktop Chrome; скрипт `probe.py` і `extra.py` у scratchpad сесії, не в репозиторії):

- Хост — сервер у датацентрі. **YouTube заблокував відтворення**: `playabilityStatus = LOGIN_REQUIRED`
  («Sign in to confirm you're not a bot») на m. і на www, для wdpjv2enZLM і для jNQXAC9IVRw. Тому
  `captionTracks` і запити timedtext/`pot` на справжньому відео перевірити **не вдалося**. Обхід через домашній
  IP власника вимагає його дозволу й не робився.
- Згоду на cookies (EU) показано вікном у сторінці. Натиснуто «Accept all», після чого з'явилося cookie `SOCS`.
  Свіжий контекст на `/shorts` перенаправило на `consent.youtube.com`.
- Перенаправлення: настільний UA на m.youtube.com отримує 302 на `www.youtube.com/watch?app=desktop&v=…`. Pixel
  лишається на m., iPhone теж (з доданим `&ra=m`).
- **m.youtube.com (Pixel 7 і iPhone 14 однаково)**:
  - є `#movie_player`: `div.html5-video-player.ytp-mweb-player` (єдиний `.html5-video-player`). Ланцюжок:
    `#player-container-id > #player > #movie_player > .html5-video-container > video.html5-main-video`;
  - функції плеєра: `getPlayerResponse`, `getVideoData`, `getOption`, `setOption`, `loadModule`,
    `toggleSubtitles`, `toggleSubtitlesOn`, `isSubtitlesOn`, `getAudioTrack`, `getAvailableAudioTracks`;
  - глобальні об'єкти: `ytInitialPlayerResponse`, `ytInitialData`, `ytcfg`, `ytplayer`
    (`config.args.raw_player_response`). Клієнт `MWEB` 2.20261120;
  - селектори CC **нічого не знаходять**: `.ytp-subtitles-button`, `ytm-closed-captioning-button`,
    `.ytmClosedCaptioningButtonButton`, `button[aria-label*=aption|ubtit|CC]`. Кнопки в плеєрі лише
    `ytp-unmute` і `ytp-large-play-button`; `#player-control-container .player-controls-top` також немає (на
    заблокованому плеєрі оверлей керування не будується);
  - SPA-перехід на інше відео: на `window` прийшли `state-navigatestart`, `pushState` і `state-navigateend`,
    **без `yt-navigate-finish`**. `#movie_player` залишився тим самим елементом;
  - Shorts (`/shorts/qmXFT0FjvCw`): `#movie_player` у `player-component`, `getPlayerResponse().videoDetails.videoId`
    = id цього Short (не заблоковано). `#shorts-player` і `ytm-shorts-player` немає, кнопки CC немає.
- **www.youtube.com (Desktop)**: `#movie_player` (`ytp-delhi-modern`) з тими самими функціями, клієнт `WEB`.
  `#movie_player .ytp-subtitles-button` **є** (aria «Subtitles/closed captions unavailable» на заблокованому
  відео).

**Висновок**:

- причина — розмітка, а не менеджер: на m.youtube.com немає кнопки, яку натискає `collectPage`;
- скрипт мовчки віддає сторінку без субтитрів, а `sendPage` її відкидає.

Напрямки для етапу 2 (не рішення, лише варіанти):

1. Вмикати субтитри через API плеєра (`toggleSubtitlesOn`/`loadModule('captions')`, `setOption('captions',
   'track', …)`), а не кліком по кнопці. API є і на m., і на www (у Firefox — через `wrappedJSObject`).
2. Для `MWEB` спробувати `baseUrl` доріжки з відповіді плеєра без `pot`: за вікі yt-dlp mweb не потребує pot
   для субтитрів. Зараз `readPlayer` не копіює `baseUrl` (`page.ts:61-62`). Перевірити це можна лише з
   домашнього IP або на телефоні.
3. Надсилати сторінку без `subs`: тоді сервер не чекатиме 20 с. Також писати результат `collectPage` у журнал.

## 10. Зайвий, мертвий і дубльований код

Перевірено пошуком використань у `src/` і `test/`. Невикористаних експортів у `src/` немає (крім згенерованих
`paths` і `webhooks` у `api/schema.d.ts` та `MemoryPlatform`, якою користуються лише тести).

**Дублікати**

1. `OPEN_WINDOW_S = 150` (`core/poller.ts:15`) повторює `WINDOW_S = 150` (`api/client.ts:28`). Обидві константи
   віддзеркалюють серверні значення. Досить однієї або взяти фактичний розмір із відповіді.
2. Два екземпляри `Previews`: `main.ts:140` (для питання про готові голоси) і `ui/settings.ts:31`. Обидва грають
   через один `samples` `AudioContext`, а лічильники `turn` у них окремі. `stopClip()` одного робить `suspend()`
   контексту, через який грає інший (`ui/preview.ts:40`). Досить одного спільного.
3. `VoiceoverSession.audio()` (`core/session.ts:197-199`) у `src/` ніхто не викликає, лише тести
   (`test/session.test.ts:247…770`). `main.ts` тримає власний контекст для зразків.
4. Два шляхи «підключення»: `signin.ts` (device code) і `autolink.ts`. Обидва після успіху виконують однакове
   `Object.assign(settings, {token, account: login · name}); save()`
   (`ui/settings.ts:165-166`; `autolink.ts:223-224`). Це дрібниця, але її легко винести в одну функцію.

**Застаріле або зайве**

5. `test/browser/smoke.js` і `test/browser/start.js` ні до чого не підключені: їх не викликають ні `check.sh`, ні
   CI, ні README. `smoke.js` підставляє в налаштування `server` (такого поля немає з тих пір, як адресу вшиває
   сервер, `store.ts:7`) і шукає кнопку з текстом «UK» (тепер це SVG-іконка). Їх треба або перенести в нову матрицю
   (Playwright), або видалити.
6. Міграції налаштувань 0.1–0.2: голос `male` → `Speaker_53` і гучність 0.2/0.12 → 0.1 (`store.ts:50-51`). Дані
   ще тестові («not production»), тож ці міграції можна прибрати разом із їхніми тестами (`test/settings.test.ts`).
7. Сумісність із сервером до 0.10 (`poller.ts:94`: «no phrases with it (a server before 0.10)») — гілка для
   старого сервера, якого вже немає. Сама гілка безпечна (просто ще один GET), але заважає читати код.
8. Шар `SiteAdapter`: реєстр з одним адаптером (`adapters/registry.ts`), необов'язкові методи (`inAd?`,
   `collectPage?`, `ukrainianDub?`, `wantsRemount?`, `panelAtTop?`, `getPlayer?`, `adapters/types.ts`) і перевірки
   на їхню наявність (`playback.ts:49, 110`; `poller.ts:243`; `main.ts:124, 197`; `quick.ts:30, 34`). Сьогодні
   це мертві гілки. Залишати шар чи ні, залежить від того, чи будуть інші сайти.
9. Застарілі коментарі: `client.ts:68` («phrases of the minute», насправді 150 с); `scheduler.ts:238` («120 s
   after», насправді `KEEP_AHEAD = 160`); `ui/quick.ts:1`, `ui/dom.ts:1` (там усе правильно, просто повторюють
   правило з `check.sh`).
10. `api/script-openapi.json` відстає від серверного golden `server/tests/golden/script_openapi.json`: у golden
    додано поля `mode_refused`, `voice_kept`, `voice_refused`, яких скрипт не знає. Зміни лише додають поля, тож
    нічого не ламається, але скрипт не показує цих причин глядачеві.
11. `@grant GM_registerMenuCommand` у меню «VoxArbor UA: налаштування» (`main.ts:209`) — дрібниця, але на
    телефонах меню менеджера зазвичай недоступне (див. розділ 12).

**Зайве в поведінці**

12. `collectPage` чекає 8 с запит плеєра навіть тоді, коли кнопки CC немає і запиту не буде (`page.ts:175-182`).
13. Сторінку без `subs` не надіслано (`poller.ts:247`). Сервер міг би взяти з неї хоча б `caption_tracks`, мову й
    тривалість, а головне — не чекати 20 с марно. Це не мертвий код, але через нього губиться корисне.
14. `prepare()` відкриває відео на сервері з `page_support: true` ще до відповіді глядача на питання про готові
    голоси (`main.ts:156`). Якщо глядач скасує, сервер однаково відкриє відео й 20 с чекатиме сторінку.

## 11. Що відрізняється або ламається на телефоні

1. **Субтитри не надсилаються** (розділ 9): немає `.ytp-subtitles-button` (`page.ts:164`), скрипт марно чекає 8 с,
   а `sendPage` відкидає сторінку без `subs` (`poller.ts:247`). Так буде на кожному відео з телефона, для якого
   сервер ще не має субтитрів.
2. **SPA-подія**: `yt-navigate-finish` на m. не приходить (`index.ts:41-44`), натомість приходять
   `state-navigateend`. Навігацію ловить лише `watch()` раз на 1 с (`main.ts:202-212`). Поки цього не сталося,
   стара сесія працює до 1 с на новому відео.
3. **Shorts на телефоні**: `topRow` шукає `ytd-shorts-player-controls` (`mount.ts:10-13`), а такого елемента на m.
   немає, тож кнопки йдуть у `overlay`. `getVideo` спершу шукає `#shorts-player video`, якого немає
   (`index.ts:7-8`), і бере перший `video.html5-main-video, video`. У стрічці Shorts на телефоні це може бути
   не той ролик — не перевірено.
4. **Shorts на комп'ютері**: сторінка не надсилається ніколи, бо `#movie_player` належить попередньому відео
   (`page.ts:80-86`). На телефоні, навпаки, `#movie_player` — сам Short, і `playerResponse()` спрацює.
5. **Звук, Android Chrome/Edge**: Chrome дозволяє `AudioContext` після будь-якого жесту на сторінці (sticky
   activation), тож старт після `await` проходить.
6. **Звук, iOS**: `resume()` поза жестом (`session.ts:228-229, 245`, `main.ts:157-163`) може не спрацювати. Стан
   `interrupted` після блокування екрана не обробляється. Опускання гучності `video.volume` на iOS не працює:
   `HTMLMediaElement.volume` там лише для читання, тож оригінал **не приглушиться**. Це відомо про iOS загалом, а
   не перевірено зі скриптом.
7. **Фонове відтворення й вимкнений екран (Android)**: `requestAnimationFrame` у фоні зупиняється, тож фрази
   стартує лише `timeupdate` (приблизно 4 рази на секунду), а не кадр. Точність старту падає до ±250 мс. Таймери
   в прихованій вкладці теж уповільнюються, а з ними й опитування сервера. Не перевірено.
8. **Меню менеджера**: `GM_registerMenuCommand` на телефонах зазвичай недоступне. Налаштування відкриваються
   лише довгим натисканням на кнопку (600 мс, `buttons.ts:94-100`), а на m. YouTube вона видна тільки поки видно
   керування плеєра.
9. **Перемикач для userScripts у Chromium** (Edge Android) і сторінка встановлення: README не пояснює цей крок
   (розділ 12).
10. **Швидка панель**: на портретному телефоні вона стає листом унизу сторінки, поза плеєром
    (`quick.ts:28-46`). У повноекранному режимі вона йде в елемент на весь екран (`dom.ts:152-166`).
11. **Журнал**: збій збору сторінки пишеться лише в `console.warn` (`poller.ts:249`), а консолі на телефоні
    немає. «Копіювати журнал» не покаже, що субтитрів не надіслано.

## 12. Менеджери скриптів і їхні обмеження

Що потрібно скрипту від менеджера:

- **обов'язково й синхронно**: `GM_getValue` і `GM_setValue` (уже на старті, у конструкторі `SettingsStore`,
  `main.ts:23`), а також `GM_xmlhttpRequest` з `responseType: 'arraybuffer'` і `@connect *`;
- **необов'язково, є запасний варіант**: `GM_registerMenuCommand` (без нього меню просто не буде),
  `GM_openInTab` (інакше `window.open`) і `GM_setClipboard` (інакше `navigator.clipboard`), `platform/gm.ts:328-338`;
- **від світу, де виконується скрипт**: властивість сторінки `#movie_player.getPlayerResponse`. У світі сторінки
  (MAIN) вона видна напряму, в ізольованому світі Firefox — через `wrappedJSObject`. В ізольованому світі
  Chromium або Safari її **не видно взагалі** (там немає `wrappedJSObject`), тож `collectPage` і `hasUkrainianDub`
  повернуть null чи false;
- `fetch` на timedtext з cookies сторінки, `PerformanceObserver`, Web Audio.

Скрипт не має запасного варіанту для `GM.*`: якщо `GM_getValue` немає, буде `ReferenceError` на першому рядку,
і скрипт тихо не працюватиме.

| Менеджер, платформа | Стан (2026-11) | Що з нашим скриптом |
|---|---|---|
| Tampermonkey, Chrome/Edge (MV3, `chrome.userScripts`) | 5.5.1, 2026-10 | Працює. Типовий `@sandbox raw` — світ сторінки, `getPlayerResponse` видно. **Потрібен перемикач «Allow User Scripts»** у деталях розширення (Chrome 138+) або «Режим розробника»; у нових встановлень він типово **вимкнений**, і скрипт мовчки не запускається. Для невідомого домену в `@connect *` TM питає підтвердження. [1][2][3][4] |
| Violentmonkey, Chrome (MV3) | 2.50.0, 2026-10; MV2-збірку Chrome вимкнув у 2025 | Працює (`@inject-into auto`: сторінка, а якщо CSP не пускає — content). Потрібен той самий перемикач userScripts. README радить VM для Chrome, але не каже про цей крок. [5][6] |
| Tampermonkey і Violentmonkey, Firefox (MV2) | TM 5.5.0, VM 2.50.0 | Працює через `wrappedJSObject` (`page.ts:84`): Trusted Types на YouTube не пускають ін'єкцію в сторінку, тож скрипт іде в content-світ. VM має опцію «Bypass CSP in Firefox». [5][7] |
| Greasemonkey 4, Firefox | 4.14, 2026-06 | **Не працює**: є лише асинхронний `GM.*`, а `GM_getValue`, `GM_xmlhttpRequest` і `GM_registerMenuCommand` відсутні. [8] |
| ScriptCat | 1.5.2, 2026-11; Firefox ≥ 154, без Android | API заявлено сумісним із TM; не перевірено. [9] |
| **Android**: Firefox + Violentmonkey або Tampermonkey | VM ≥ 121, TM (рекомендований на Android) | Головний робочий шлях; README називає саме його. Механіка та сама, що на комп'ютері Firefox (`wrappedJSObject`). Сайт — m.youtube.com (розділ 9). [9] |
| Android: Edge | розширення з 134 (2025-03), курований список, TM і VM у ньому | Імовірно працює як Chromium MV3; чи потрібен перемикач userScripts на Android — **не перевірено**. [10][11] |
| Android: Kiwi | **мертвий**: архів і зникнення з Google Play у 2025 | Не радити. [12][13] |
| Android: Lemur, Quetta, Yandex, Mises | Chromium із розширеннями CWS | TM ставиться (зі слів продавців); не перевірено. |
| Android: Cromite (вбудовані userscripts) | є | **Не працює**: ізольований світ, `@grant` ігнорується, немає GM_* і сховища. [14] |
| **iOS**: Safari + Userscripts (quoid) | 1.8.6 (2026-01), безкоштовний; бета 5.0 | **Не працює як є**. Є `GM_xmlhttpRequest` і `GM.getValue`, але **немає синхронного `GM_getValue`**, `GM_registerMenuCommand`, `unsafeWindow`, `@connect`. GM API доступні лише в `@inject-into content`, а там не видно `getPlayerResponse`. Потрібні асинхронне сховище і місток у сторінку (CustomEvent). [15][16] |
| iOS: Tampermonkey для Safari | 5.6.6243 (2026-10), $2.99 | Ймовірно найближчий до настільного TM (у 2026-07 додано передавання ArrayBuffer у GM_xhr). На сайтах із жорстким CSP він, з відгуків, ламається — **не перевірено**. [17] |
| iOS: Stay | живий, iOS 15+ | README заявляє `unsafeWindow`, `GM_xmlhttpRequest`, синхронні `GM_get/setValue`, меню, `GM_openInTab`. Бінарні відповіді не перевірено. [18] |
| iOS: Orion (Kagi) | бета розширень CWS/AMO; 1.4.15 «Fixed Violentmonkey» | VM частково працює, з TM звіти змішані. [19][20] |

**Звук на iOS**:

- `AudioContext` стартує `suspended`, і `resume()` спрацьовує лише всередині жесту. Наш `start()` створює контекст
  після `await readyOffer` (`main.ts:157-163`), тобто вже поза жестом.
- Після блокування екрана Safari переводить контекст у нестандартний стан `interrupted`. `resume()` може
  повідомити `running`, а звуку не буде (WebKit 273511, 276016).
- Потрібні `resume()` у самому кліку і повторний `resume()` на `visibilitychange`. [21][22]

**YouTube: CSP і Trusted Types**:

- www і m. віддають `require-trusted-types-for 'script'` і `script-src` з nonce та `'strict-dynamic'`
  (перевірено curl 2026-11-21).
- `innerHTML` без політики кидає помилку. UI скрипта будується через DOM-виклики, і `check.sh` це стереже.
- Ін'єкція тексту `<script>` у сторінку заблокована, тому в Firefox і Safari менеджери переходять у content-світ.
- Trusted Types: Chrome так, Safari 26+, Firefox 148+. [23][24]

**PO-токен для субтитрів** (вікі yt-dlp, 2026-07):

- клієнт `web` потребує `pot` для Subs і GVS, а `mweb` — **лише для GVS, не для субтитрів**;
- без `pot` timedtext з `exp=xpe` повертає порожні 200. [25][26]

Якщо це справедливо для mweb у браузері, на m.youtube.com `baseUrl` доріжки з відповіді плеєра можна брати
**без натискання CC**. Перевірка — у розділі 9.

## 13. Що тестувати

Нижче — що вже покрито `vitest` (`test/`, фейкові DOM і аудіо: `fake_dom.ts`, `fake_audio.ts`) і чого бракує
для запланованої матриці (Chromium на комп'ютері й мобільна емуляція, Playwright).

| Сценарій | Уже є в `test/` | Чого бракує |
|---|---|---|
| Старт: POST, вікно у відповіді, опитування | `session.test.ts`: «switching on opens the video…», «a server that answers the opening with the phrases…», «the video opened ahead … is not opened again» | справжній YouTube у браузері (є лише ручний `test/browser/start.js`) |
| Фікстура з ручною `en-US` | `pickCaption`, `extraTracks` на даних (`scheduler.test.ts`, `youtube_page.test.ts`; `fixtures/ZbmfYMlrlII.json`) | фікстура wdpjv2enZLM (одна аудіодоріжка, `lang` = null, ручна `en-US`) і `collectPage` повністю |
| Лише auto (asr) / жодної доріжки | `pickCaption` частково | `collectPage` без доріжок: що надсилається (зараз нічого) |
| Live | лише `pageVideoId` для `/live/` | поведінка на трансляції (немає `duration`, субтитрів timedtext) |
| Shorts | розташування кнопок (`mount.test.ts`) | `collectPage` на Shorts (зараз null, бо `#movie_player` чужий) |
| Субтитри без натискання CC | нічого: `collectPage`, `PerformanceObserver` і кнопку CC не тестовано | комп'ютер: CC вимкнено або ввімкнено; телефон: кнопки немає; запит `pot` прийшов пізно (> 8 с) |
| Пізні субтитри (сервер просить сторінку не одразу) | `sendPage` один раз за увімкнення («page data … posted once … if it has subtitles») | `page_needed` у відповіді GET segments після відкриття |
| Переклад змінився без паузи (новий хеш аудіо) | «a phrase voiced anew gets its new audio: the one fetched before is dropped» | фраза, що саме звучить, коли змінюється хеш |
| Немає аудіо (фраза без `audio`, збій завантаження) | «audio that failed … again after five seconds», «audio that cannot be had ends the wait», holdStep/STUCK | збій `decodeAudioData` (Opus у Safari), `AudioContext` у стані suspended на телефоні |
| Рестарт сервера, 503 і тихий повтор | «a server that goes away while audio is here ahead is asked again quietly», `quietOutage` | справжній 503 від проксі (HTML, не JSON → статус 0), 404 після рестарту |
| Перемотка | «a seek stops what sounds…», «a seek into the middle of a phrase» | перемотка на телефоні (жести, `seeking` без `seeked`) |
| 2× швидкість | лише `playbackRate` нового джерела («…at the video's speed») | зміна швидкості посеред фрази; висота тону |
| Кілька вкладок | `settings_store.test.ts` («two tabs…»), повторне підключення після 401 | дві вкладки з одним відео: два `tab`, два `AudioContext` |
| Вхід і вихід | `signin.test.ts`, `autolink.test.ts`, `ui.test.ts` («Підключити» / «Відключити») | `GM_openInTab` на телефоні (новий таб); 401 посеред перегляду |
| Реклама, утримання, prep | «during an ad nothing sounds…», hold/prep (кілька тестів) | — |
| Мобільна розмітка | `mount.test.ts` «a phone: … top row» | реальний m.youtube.com: плеєр, CC, навігація, Shorts (розділ 9) |

Що додати першим (за вагою):

1. юніт-тест `collectPage` із фейковим DOM для трьох випадків: є кнопка CC, кнопки немає, CC уже ввімкнено;
2. рішення й тест на сторінку без `subs`: надсилати її чи ні (зараз не надсилається, `poller.ts:247`);
3. Playwright-матриця на `pw-local:1.49.1` (Desktop Chrome, Pixel 7, iPhone 14) зі стабом GM_* (як
   `test/browser/start.js`) і фейковим сервером. Фікстури: ручна `en-US`, лише auto, жодної доріжки, live,
   Shorts.

## 14. Джерела

1. Tampermonkey у CWS: https://chromewebstore.google.com/detail/dhdgffkkebhmkfjojejmpbldmpobfkfo; журнал змін:
   https://www.tampermonkey.net/changelog.php
2. TM FAQ (userScripts, Developer mode): https://www.tampermonkey.net/faq.php?q=Q209
3. Chrome, userScripts і перемикач «Allow User Scripts»: https://developer.chrome.com/blog/chrome-userscript,
   https://developer.chrome.com/docs/extensions/reference/api/userScripts
4. TM `@sandbox`, `@connect`, `GM_xmlhttpRequest`: https://www.tampermonkey.net/documentation.php?q=sandbox,
   https://www.tampermonkey.net/documentation.php?q=connect, https://www.tampermonkey.net/documentation.php?q=GM_xmlhttpRequest
5. Violentmonkey, релізи: https://github.com/violentmonkey/violentmonkey/releases; CWS:
   https://chromewebstore.google.com/detail/violentmonkey/jinjaccalgkegednnccohejagnlnfdag
6. VM `@inject-into`: https://violentmonkey.github.io/api/metadata-block/
7. Додатки AMO (версії, Android): https://addons.mozilla.org/api/v5/addons/addon/violentmonkey/ (так само
   tampermonkey, greasemonkey, scriptcat)
8. Greasemonkey 4 для авторів скриптів: https://www.greasespot.net/2017/09/greasemonkey-4-for-script-authors.html
9. ScriptCat і TM на Android: https://addons.mozilla.org/api/v5/addons/addon/scriptcat/
10. Edge Android, розширення: https://www.windowslatest.com/2025/03/14/microsoft-edge-beats-google-chrome-gets-extensions-store-web-on-android/
11. https://itc.ua/en/news/microsoft-edge-on-android-gets-support-for-extensions-chrome-lags-behind
12. Kiwi закрито: https://www.androidauthority.com/kiwi-browser-shutting-down-3519510/
13. https://www.neowin.net/news/kiwi-browser-takes-final-breath-but-at-least-some-of-it-will-live-on-in-microsoft-edge/
14. Cromite userscripts: https://github.com/uazo/cromite/blob/master/docs/FEATURES.md, https://github.com/uazo/cromite/issues/1709
15. Userscripts (quoid): https://github.com/quoid/userscripts, https://apps.apple.com/us/app/userscripts/id1463298887
16. Релізи Userscripts: https://github.com/quoid/userscripts/releases
17. Tampermonkey для Safari iOS: https://apps.apple.com/us/app/tampermonkey/id6738342400
18. Stay: https://apps.apple.com/us/app/stay-userscripts-extension/id1591620171, https://github.com/mcpr11/Stay
19. Orion, розширення на iOS: https://help.kagi.com/orion/browser-extensions/ios-ipados-extensions.html,
    https://orionbrowser.com/updates/orion-iOS-release-notes
20. https://orionfeedback.org/d/6100-ios-extension-tampermonkey-not-working-properly
21. WebKit, AudioContext interrupted/resume: https://bugs.webkit.org/show_bug.cgi?id=273511
22. https://bugs.webkit.org/show_bug.cgi?id=276016
23. Trusted Types: https://developer.mozilla.org/en-US/docs/Web/API/Trusted_Types_API, https://caniuse.com/trusted-types
24. Firefox 148: https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/148
25. PO-токени, вікі yt-dlp: https://github.com/yt-dlp/yt-dlp/wiki/PO-Token-Guide; PR субтитрів:
    https://github.com/yt-dlp/yt-dlp/pull/13234
26. Порожні субтитри без pot: https://github.com/jdepoix/youtube-transcript-api/issues/592
