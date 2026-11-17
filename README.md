# VoxArbor UA: скрипт для браузера

Українська озвучка відео на YouTube просто в браузері. Скрипт бере переклад і озвучку із сервера VoxArbor UA, грає
їх поверх відео й приглушує оригінал під час фраз. Працює в Chrome, Firefox і Firefox для Android.

Частина проєкту **VoxArbor UA**. Ліцензія Apache 2.0 (див. `LICENSE`).

## Встановлення

1. Поставте менеджер скриптів: [Violentmonkey](https://violentmonkey.github.io/) (Chrome, Firefox, Firefox для
   Android) або Tampermonkey.
2. Відкрийте **https://my.voxarbor.com/voxarbor.user.js** і погодьтеся встановити скрипт. Менеджер сам
   оновлюватиме його з цієї ж адреси.
3. Відкрийте відео на YouTube, у налаштуваннях скрипта натисніть **«Підключити»**, увійдіть на сайті й підтвердьте
   підключення. Токен ніхто не копіює вручну: сайт віддає його скрипту сам, і в профілі на сайті його можна
   відкликати.

Інший сервер VoxArbor UA віддає скрипт за своєю адресою `/voxarbor.user.js` і сам підставляє в нього свою адресу.
Тому встановлюйте скрипт із сервера, а не з релізів цього репозиторію.

## Що потрібно скрипту

- `GM_xmlhttpRequest`: запити до сервера VoxArbor UA, з якого скрипт встановлено;
- `GM_getValue` / `GM_setValue`: налаштування й токен підключення;
- `GM_openInTab`: сторінка підключення на сайті;
- `GM_registerMenuCommand`: налаштування з меню менеджера скриптів.

Скрипт працює лише на сторінках YouTube і вставляє інтерфейс викликами DOM, без HTML із рядків (YouTube вимагає
Trusted Types).

## Розробка

Потрібен Node.js 18 або новіший.

```sh
npm ci            # esbuild, TypeScript, vitest, openapi-typescript
./check.sh        # усе, що перевіряє CI: типи API, типи, збірка, тести
node build.mjs    # dist/voxarbor.user.js
```

- `src/` — код на TypeScript, `src/meta.ts` — заголовок скрипта і його версія.
- `test/` — тести (vitest).
- `api/script-openapi.json` — API сервера для скрипта. Його бере сервер VoxArbor UA (`python -m tools.script_openapi`);
  `npm run schema` робить із нього `src/api/schema.d.ts`. Нове поле в API спершу з'являється на сервері, потім тут.
- Адреса сервера в коді — `__VOXARBOR_SERVER__`: сервер підставляє її, коли віддає файл.

## Випуск

Версія записана в `src/meta.ts` (`VERSION`). Тег `vX.Y.Z` з тією самою версією запускає збірку й перевірки, а
реліз отримує файл `voxarbor.user.js`. Сервер VoxArbor UA бере скрипт із релізу за тегом.
