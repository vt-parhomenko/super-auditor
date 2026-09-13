# Розробка

## Запуск

```bash
npm install
npm run rebuild:electron   # зібрати better-sqlite3 під ABI Electron
npm run dev
```

## Тести

```bash
npm run rebuild:node       # повернути better-sqlite3 під ABI Node
npm test
```

## ⚠️ Нативний модуль і два ABI

`better-sqlite3` — нативний модуль. Він компілюється **або** під Node ABI, **або** під
Electron ABI, і два бінарники не співіснують у `node_modules`.

| Що робиш | Команда перед цим |
|---|---|
| `npm run dev`, `npm run build`, `npm start` | `npm run rebuild:electron` |
| `npm test`, `npm run test:watch` | `npm run rebuild:node` |

Симптом переплутаного ABI:

```
Error: The module '…better_sqlite3.node' was compiled against a different
Node.js version using NODE_MODULE_VERSION xxx. This version requires yyy.
```

Це не поломка — просто перезбери під потрібний бік.

`postinstall`-хука навмисно **немає**: вона автоматично збирала б під Electron після
кожного `npm install` і тихо ламала тести. Перезбірка — свідома явна дія.

> Якщо це почне заважати щодня — варіант винести тести БД у окремий раннер на
> `electron-vitest`, або тримати два скопійовані `.node`-бінарники й підміняти шлях.
> Поки проект малий, ручного перемикача достатньо.

## Перевірка типів

```bash
npm run typecheck        # обидва проекти
npm run typecheck:node   # main + preload + shared
npm run typecheck:web    # renderer + shared
```

`main`/`preload` і `renderer` — два різні TS-проекти з різними `lib` (Node vs DOM).
`src/shared/**` входить в обидва, тому туди не можна імпортувати ні `electron`,
ні `node:*`, ні DOM-типи.

## Аліаси шляхів

| Аліас | Куди | Де налаштовано |
|---|---|---|
| `@shared/*` | `src/shared/*` | tsconfig.node, tsconfig.web, electron.vite.config, vitest.config |
| `@main/*` | `src/main/*` | tsconfig.node, electron.vite.config, vitest.config |
| `@renderer/*` | `src/renderer/src/*` | tsconfig.web, electron.vite.config |

## Розкладка модулів

```
src/
├── shared/          ізоморфні контракти — domain.ts, ipc.ts
├── main/
│   ├── index.ts     вхідна точка, вікно
│   ├── paths.ts     розкладка сховища
│   ├── db/          SQLite, міграції, репозиторії
│   ├── ingest/      PDF/DOCX → текст + офсети сторінок
│   ├── llm/         провайдери, промпти, кеш, вартість
│   ├── pipeline/    оркестрація етапів, правила застосовності
│   └── ipc/         хендлери каналів
├── preload/         міст contextBridge
└── renderer/src/    React UI
```

## Сховище під час розробки

`app.getPath('userData')/dev/` — окремо від продакшн-даних. Побачити фактичний шлях:
він друкується в консоль при старті (`[super-auditor] сховище: …`).

Щоб скинути стан — просто видали цю теку.

## Дані для тестів

У репозиторії лежать реальні файли, тести спираються саме на них:

| Файл | Що це |
|---|---|
| `specifications/20405V5.0EN - Tesco Ornamental Plant Standard 2026.pdf` | стандарт, 101 стор., ~183 клаузули |
| `documents/0e443916-….pdf` | Receiving (BIO, Global G.A.P. CoC) Flowerbulbs, 0045 v003, 6 стор. |
| `documents/11c22d29-….pdf` | Pest Management, 0068 v002, 3 стор. |
| `documents/f5e7e0c4-….pdf` | Damaged Products, 0072 v002, 2 стор. |

## Ключі API

Зберігаються через `safeStorage` Electron, у renderer не потрапляють ніколи.
У коді й тестах ключів бути не повинно. Для локального прогону проти реального API —
змінна оточення, не файл у репозиторії.
