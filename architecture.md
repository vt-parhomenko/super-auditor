# Super Auditor — архітектура

Десктопний застосунок для аудиту виробничої документації на відповідність стандартам
(Tesco Ornamental Plant Standard, BRC, GlobalG.A.P. тощо). Все локально, AI — через
змінних провайдерів.

Документ описує цільову архітектуру. Порядок реалізації — у розділі [15. Roadmap](#15-roadmap).

---

## 1. Терміни

| Термін | Значення |
|---|---|
| **Specification / Spec** | Стандарт замовника (Tesco 20405 V5.0). Має версії. |
| **Clause** | Атомарна вимога стандарту (`10.3 Pest management programme specification`). |
| **Document** | Внутрішній документ виробництва (SOP, політика, форма). Має версії (`0068 / Versie: 002`). |
| **Site Profile** | Профіль виробництва: продукти, процеси, сертифікати. Визначає, які clause застосовні. |
| **Audit Run** | Один прогін: набір версій документів × версія специфікації × профіль виробництва. |
| **Finding** | Результат по одній парі (clause × document_version). Одиниця результату. |
| **Evidence** | Дослівна цитата з документа з прив'язкою до сторінки й офсету. |

---

## 2. Ключові архітектурні рішення

| # | Рішення | Чому |
|---|---|---|
| ADR-1 | **Одиниця перевірки — clause, а не документ** | `Pest Management 0068` покриває 6 вимог зі 180. Порівняння «документ vs весь стандарт» дає ~170 хибних NC. |
| ADR-2 | **Аудит = набір документів × spec_version** | Головна цінність — gap-аналіз: які вимоги не покриті *жодним* документом. Аудити валяться на відсутніх доказах. |
| ADR-3 | **Без RAG/ембедингів на старті** | Спека = 42k токенів, документ = 2–4k. Все влазить у контекст 1M. Векторна база — передчасна оптимізація. |
| ADR-4 | **Applicability — детермінований фільтр, не рішення AI** | Колонки P/R/O + сертифікати виробництва (ISO 14001 → пропустити секцію) дають N/A за правилом. Ріже набір і прибирає хибні NC. |
| ADR-5 | **Кожен вердикт має верифіковану цитату** | Citations API + пост-перевірка. Без доказу вердикт → `needs_human_review`. |
| ADR-6 | **AI-вердикт і human-вердикт зберігаються окремо** | Людські правки = eval-набір для регресійного тестування промптів і моделей. |
| ADR-7 | **Кеш за `hash(контент) + prompt_version + model_id`** | Дешеві переприганяння + можливість відповісти «чому результат змінився». |
| ADR-8 | **Cloud/local прапорець на рівні специфікації** | Стандарт Tesco: *«supplied for use of the immediate recipient»*. Відправка в хмарний API — свідоме рішення користувача. |

---

## 3. Стек

```
Electron 3x + electron-vite + React 19 + TypeScript
├── main process        — файли, БД, AI-конвеєр, ключі
├── preload             — типізований IPC-міст (contextIsolation: true)
├── renderer            — React UI, без доступу до fs/net
└── utilityProcess      — воркер конвеєра (щоб UI не блокувався)

better-sqlite3          — БД (синхронна, швидка, в main)
pdfjs-dist              — витяг тексту з PDF + координати
mammoth                 — DOCX → HTML → Markdown
tesseract.js            — OCR fallback (або vision-модель)
@anthropic-ai/sdk       — Anthropic-провайдер
zod                     — схеми валідації + structured output
```

> `React` і `Vite` — не альтернативи: Vite це бандлер, React — UI-бібліотека.
> Беремо `electron-vite` (обгортка Vite під Electron) + React.

**Альтернатива:** Tauri (менший бандл, Rust-бекенд). Не беремо: PDF/DOCX екосистема
в Node значно багатша, а для пет-проекту швидкість розробки важливіша за 80 МБ бандлу.

---

## 4. Файлове сховище

Content-addressed, імена файлів не несуть змісту:

```
%APPDATA%/super-auditor/
├── auditor.db                       # SQLite (WAL)
├── blobs/
│   └── ab/cd/abcd1234...ef.pdf      # SHA-256, шардинг по 2+2 символи
├── extracted/
│   └── ab/cd/abcd1234...ef.json     # кеш екстракції тексту
└── exports/
```

Правила:
- Ім'я блоба = SHA-256 вмісту → дедуплікація безкоштовно, повторний імпорт того самого файлу не створює нову версію.
- Оригінал ніколи не мутується.
- Метадані (назва, номер, версія, автор) — тільки в БД.

---

## 5. Модель даних (SQLite)

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ─── Сховище ────────────────────────────────────────────────────────────────
CREATE TABLE blob (
  hash          TEXT PRIMARY KEY,          -- sha256 hex
  rel_path      TEXT NOT NULL,
  byte_size     INTEGER NOT NULL,
  mime          TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE TABLE extraction (
  id            INTEGER PRIMARY KEY,
  blob_hash     TEXT NOT NULL REFERENCES blob(hash),
  method        TEXT NOT NULL CHECK (method IN ('pdfjs','mammoth','ocr','vision')),
  tool_version  TEXT NOT NULL,
  text          TEXT NOT NULL,
  page_count    INTEGER,
  char_count    INTEGER,
  quality       REAL,                      -- 0..1, щільність тексту / впевненість OCR
  created_at    TEXT NOT NULL,
  UNIQUE (blob_hash, method, tool_version)
);

-- Прив'язка офсетів до сторінок — без неї немає клікабельних цитат.
CREATE TABLE extraction_page (
  extraction_id INTEGER NOT NULL REFERENCES extraction(id) ON DELETE CASCADE,
  page_no       INTEGER NOT NULL,
  char_start    INTEGER NOT NULL,
  char_end      INTEGER NOT NULL,
  PRIMARY KEY (extraction_id, page_no)
);

-- ─── Документи ──────────────────────────────────────────────────────────────
CREATE TABLE document (
  id            INTEGER PRIMARY KEY,
  title         TEXT NOT NULL,
  doc_number    TEXT,                      -- '0068'
  process_owner TEXT,                      -- 'Warehouse & Production Manager'
  kind          TEXT CHECK (kind IN ('sop','policy','form','record','manual','other')),
  created_at    TEXT NOT NULL
);

CREATE TABLE document_version (
  id            INTEGER PRIMARY KEY,
  document_id   INTEGER NOT NULL REFERENCES document(id) ON DELETE CASCADE,
  version_label TEXT NOT NULL,             -- '002'
  blob_hash     TEXT NOT NULL REFERENCES blob(hash),
  extraction_id INTEGER REFERENCES extraction(id),
  lang          TEXT,                      -- 'en', 'nl'
  effective_from TEXT,
  imported_at   TEXT NOT NULL,
  UNIQUE (document_id, version_label)
);

-- ─── Специфікації ───────────────────────────────────────────────────────────
CREATE TABLE specification (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,             -- 'Tesco Ornamental Plant Standard'
  issuer        TEXT,                      -- 'Tesco Stores Ltd.'
  code          TEXT,                      -- '20405'
  cloud_allowed INTEGER NOT NULL DEFAULT 0 -- ADR-8: чи можна слати в хмарний API
);

CREATE TABLE spec_version (
  id            INTEGER PRIMARY KEY,
  specification_id INTEGER NOT NULL REFERENCES specification(id) ON DELETE CASCADE,
  version_label TEXT NOT NULL,             -- '5.0'
  blob_hash     TEXT NOT NULL REFERENCES blob(hash),
  extraction_id INTEGER REFERENCES extraction(id),
  effective_from TEXT,
  clauses_status TEXT NOT NULL DEFAULT 'pending'
                 CHECK (clauses_status IN ('pending','extracted','reviewed')),
  UNIQUE (specification_id, version_label)
);

CREATE TABLE clause (
  id              INTEGER PRIMARY KEY,
  spec_version_id INTEGER NOT NULL REFERENCES spec_version(id) ON DELETE CASCADE,
  clause_no       TEXT NOT NULL,           -- '10.3'
  sort_key        TEXT NOT NULL,           -- '010.003' для коректного сортування
  section_no      TEXT,                    -- '10'
  section_title   TEXT,                    -- 'Pest management'
  topic           TEXT,                    -- 'Pest management programme specification'
  requirement_text TEXT NOT NULL,
  modules         TEXT NOT NULL DEFAULT '[]',  -- JSON: ["P","R"]  (Product/Responsible/Operational)
  obligation      TEXT CHECK (obligation IN ('must','should','may')),
  page_from       INTEGER,
  page_to         INTEGER,
  text_hash       TEXT NOT NULL,           -- для діфу між версіями спеки
  review_status   TEXT NOT NULL DEFAULT 'auto'
                  CHECK (review_status IN ('auto','confirmed','edited','flagged')),
  UNIQUE (spec_version_id, clause_no)
);
CREATE INDEX idx_clause_spec ON clause(spec_version_id, sort_key);

CREATE TABLE spec_summary (
  spec_version_id INTEGER PRIMARY KEY REFERENCES spec_version(id) ON DELETE CASCADE,
  summary         TEXT NOT NULL,
  scope           TEXT,
  grading_rules   TEXT,                    -- витяг розділу 'Auditing of Standard'
  section_summaries TEXT NOT NULL DEFAULT '{}',  -- JSON: {"10": "..."}
  model           TEXT, prompt_version TEXT, created_at TEXT
);

-- ─── Профіль виробництва й застосовність ──────────────────────────────────────────
CREATE TABLE site_profile (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  modules       TEXT NOT NULL DEFAULT '[]',  -- JSON: ["P","R","O"]
  certifications TEXT NOT NULL DEFAULT '[]', -- JSON: ["ISO14001","SMETA"]
  products      TEXT NOT NULL DEFAULT '[]',
  processes     TEXT NOT NULL DEFAULT '[]',
  notes         TEXT
);

-- Матеріалізований результат детермінованих правил (ADR-4).
CREATE TABLE clause_applicability (
  site_profile_id INTEGER NOT NULL REFERENCES site_profile(id) ON DELETE CASCADE,
  clause_id       INTEGER NOT NULL REFERENCES clause(id) ON DELETE CASCADE,
  applicable      INTEGER NOT NULL,
  reason          TEXT NOT NULL,           -- 'module P not in site scope'
  overridden_by_user INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (site_profile_id, clause_id)
);

-- ─── Профілі документів ─────────────────────────────────────────────────────
CREATE TABLE doc_profile (
  id                  INTEGER PRIMARY KEY,
  document_version_id INTEGER NOT NULL REFERENCES document_version(id) ON DELETE CASCADE,
  summary             TEXT NOT NULL,
  doc_type            TEXT,
  processes           TEXT NOT NULL DEFAULT '[]',  -- JSON
  candidate_clauses   TEXT NOT NULL DEFAULT '[]',  -- JSON: ["10.1","10.3",...]
  model               TEXT NOT NULL,
  prompt_version      TEXT NOT NULL,
  created_at          TEXT NOT NULL,
  UNIQUE (document_version_id, model, prompt_version)
);

-- ─── Прогони й результати ───────────────────────────────────────────────────
CREATE TABLE audit_run (
  id              INTEGER PRIMARY KEY,
  label           TEXT,
  spec_version_id INTEGER NOT NULL REFERENCES spec_version(id),
  site_profile_id INTEGER REFERENCES site_profile(id),
  status          TEXT NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued','running','paused','done','failed','cancelled')),
  model_judge     TEXT NOT NULL,
  model_critic    TEXT,
  prompt_version  TEXT NOT NULL,
  started_at      TEXT, finished_at TEXT,
  input_tokens    INTEGER NOT NULL DEFAULT 0,
  cached_tokens   INTEGER NOT NULL DEFAULT 0,
  output_tokens   INTEGER NOT NULL DEFAULT 0,
  cost_usd        REAL    NOT NULL DEFAULT 0,
  error           TEXT
);

CREATE TABLE audit_run_document (
  run_id              INTEGER NOT NULL REFERENCES audit_run(id) ON DELETE CASCADE,
  document_version_id INTEGER NOT NULL REFERENCES document_version(id),
  PRIMARY KEY (run_id, document_version_id)
);

-- Черга завдань — робить прогін відновлюваним після падіння/закриття застосунку.
CREATE TABLE run_task (
  id            INTEGER PRIMARY KEY,
  run_id        INTEGER NOT NULL REFERENCES audit_run(id) ON DELETE CASCADE,
  stage         TEXT NOT NULL,             -- 'profile' | 'judge' | 'critic'
  payload       TEXT NOT NULL,             -- JSON: {documentVersionId, clauseIds:[...]}
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','running','done','failed','skipped')),
  attempts      INTEGER NOT NULL DEFAULT 0,
  last_error    TEXT,
  updated_at    TEXT NOT NULL
);
CREATE INDEX idx_run_task_pending ON run_task(run_id, status);

CREATE TABLE finding (
  id                  INTEGER PRIMARY KEY,
  run_id              INTEGER NOT NULL REFERENCES audit_run(id) ON DELETE CASCADE,
  clause_id           INTEGER NOT NULL REFERENCES clause(id),
  document_version_id INTEGER REFERENCES document_version(id),  -- NULL = зведений по всьому набору
  verdict             TEXT NOT NULL CHECK (verdict IN
                        ('compliant','partial','non_compliant',
                         'not_applicable','not_addressed','needs_human_review')),
  severity            TEXT CHECK (severity IN ('critical','major','minor','recommendation')),
  confidence          REAL,
  rationale           TEXT NOT NULL,
  gap                 TEXT,                -- чого саме бракує
  recommendation      TEXT,
  created_at          TEXT NOT NULL,
  UNIQUE (run_id, clause_id, document_version_id)
);
CREATE INDEX idx_finding_run ON finding(run_id, verdict);

CREATE TABLE finding_evidence (
  id                  INTEGER PRIMARY KEY,
  finding_id          INTEGER NOT NULL REFERENCES finding(id) ON DELETE CASCADE,
  document_version_id INTEGER NOT NULL REFERENCES document_version(id),
  quote               TEXT NOT NULL,
  page_no             INTEGER,
  char_start          INTEGER,
  char_end            INTEGER,
  source              TEXT NOT NULL CHECK (source IN ('citations_api','model_quote')),
  verified            INTEGER NOT NULL DEFAULT 0   -- цитата знайдена у вихідному тексті
);

CREATE TABLE finding_review (
  finding_id     INTEGER PRIMARY KEY REFERENCES finding(id) ON DELETE CASCADE,
  human_verdict  TEXT, human_severity TEXT,
  note           TEXT,
  reviewed_at    TEXT NOT NULL
);

-- ─── Кеш LLM-викликів і облік вартості ──────────────────────────────────────
CREATE TABLE llm_call (
  cache_key      TEXT PRIMARY KEY,         -- sha256(stage|prompt_version|model|input_hash)
  stage          TEXT NOT NULL,
  provider       TEXT NOT NULL,
  model          TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  response_json  TEXT NOT NULL,
  input_tokens   INTEGER, cached_tokens INTEGER, output_tokens INTEGER,
  cost_usd       REAL, latency_ms INTEGER,
  created_at     TEXT NOT NULL
);
```

---

## 6. Конвеєр обробки

```
                       ┌──────────────────────────────────────────┐
Stage 0  Ingest        │ blob → extraction → extraction_page      │  без AI
                       └──────────────────────────────────────────┘
                                      │
        ┌─────────────────────────────┴─────────────────────────────┐
        ▼                                                           ▼
Stage 1 Spec → clause[]  (1× на версію спеки, з ручною вичиткою)   Stage 2 Doc → doc_profile
        │                                                           │
        └─────────────────────────────┬─────────────────────────────┘
                                      ▼
Stage 3  Applicability filter (детермінований, без AI)  →  робочий набір clause
                                      ▼
Stage 4  Judge: (document_version × clause batch) → finding[] + evidence[]
                                      ▼
Stage 5  Critic: перепровірка тільки `compliant` + верифікація цитат
                                      ▼
Stage 6  Aggregate: матриця покриття, gap-аналіз, оцінка за шкалою стандарту
```

### Stage 0 — Ingest & extraction

1. SHA-256 → якщо блоб уже є, версія не створюється (питаємо користувача).
2. PDF: `pdfjs-dist`, збираємо текст **зі збереженням `char_start/char_end` кожної сторінки**.
3. Оцінка якості: `chars / page`. Якщо < 200 → скан → OCR fallback.
4. **Нормалізація обов'язкова.** У прикладах уже видно артефакти: буліт `•` витягується як
   `�`. Без нормалізації буліт-списки вимог (а вони в Tesco всюди — `10.3` це список
   з 9 пунктів) поїдуть у промпт зіпсованими.
   ```ts
   const normalize = (s: string) => s
     .replace(/�/g, '•')
     .replace(/\r\n/g, '\n')
     .replace(/[ \t]+/g, ' ')
     .replace(/\n{3,}/g, '\n\n')
     .normalize('NFC');
   ```
   Нормалізацію робимо **після** побудови `extraction_page`, або перераховуємо офсети —
   інакше зламаються прив'язки цитат.
5. DOCX: `mammoth` → HTML → Markdown; сторінок немає, прив'язка тільки за офсетами.

### Stage 1 — Реєстр вимог (найкритичніший етап)

Стандарт Tesco — таблиця з колонками `P R O | Clause number | Topic | Requirements`.
Плоска екстракція зливає колонки: рядок `P R  1.3 Management review  Site management must...`
треба розібрати на 4 поля. Робимо посторінковим LLM-екстрактом у strict-схему.

```
для кожної сторінки p у діапазоні clause-таблиць:
    вхід: text(p-1) хвіст 500 символів + text(p) + text(p+1) голова 500 символів
    вихід: clause[] у strict JSON-схемі
```

Валідація після екстракції (без AI):
- нумерація монотонна, немає дірок у межах секції → інакше `review_status='flagged'`;
- `requirement_text` не порожній і довший за `topic`;
- `modules ⊆ {P,R,O}`;
- дублікати `clause_no` → flagged.

**Обов'язковий UI ручної вичитки реєстру.** Це не опція. Якщо реєстр кривий — усе далі
безглузде, і помітити це на етапі findings неможливо. Екран: список вимог поруч зі
сторінкою PDF, `Confirm / Edit / Flag`, лічильник «вичитано 47/183».
Поки `clauses_status != 'reviewed'` — прогін аудиту заблокований.

Окремо витягуємо розділ **«Auditing of Standard»** (стор. 7–9) у `spec_summary.grading_rules`:
означення Critical / Major / Minor / Recommendation і таблицю рейтингів
(`0 Critical + 1 Major → 3 Improvement needed`, `≥4 Major → 1 Unsatisfactory` тощо).
Ці правила підставляються в промпт судження — тоді severity збігається зі шкалою
реального аудитора, а не з абстрактним «є зауваження».

### Stage 2 — Профіль документа

Один виклик на версію документа. Дешева модель (`claude-haiku-4-5`).
Витягуємо: summary, тип, номер і версію з шапки, процеси, мову, і **список
вимог-кандидатів** (модель бачить перелік `clause_no + topic`, не повні тексти).

Кандидати — не фільтр, а пріоритезація: спершу перевіряємо їх, потім решту.
Скорочувати набір за кандидатами не можна — інакше пропустимо невідповідність там,
де модель не здогадалась подивитись.

### Stage 3 — Фільтр застосовності (без AI)

```ts
function isApplicable(clause: Clause, site: SiteProfile): Applicability {
  const modules = JSON.parse(clause.modules) as string[];
  if (modules.length && !modules.some(m => site.modules.includes(m)))
    return { applicable: false, reason: `module ${modules.join('/')} поза scope виробництва` };

  // Стандарт прямо дозволяє пропуски за сертифікацією
  if (clause.section_no === '14' && site.certifications.includes('ISO14001'))
    return { applicable: false, reason: 'ISO 14001 покриває Environment/water/waste' };
  if (clause.section_no === '3' && site.certifications.some(c => ['SMETA','SIZA'].includes(c)))
    return { applicable: false, reason: 'Responsible Sourcing покрито third-party ethical cert' };

  return { applicable: true, reason: 'in scope' };
}
```

Результат матеріалізується в `clause_applicability` і **редагується користувачем**
(`overridden_by_user`). N/A ніколи не вирішує модель.

### Stage 4 — Судження

Батчимо **по секціях**: секція 10 «Pest management» = 6 вимог за один виклик.
Одна вимога на виклик — дорого і втрачається контекст сусідніх вимог; уся спека
одним промптом — модель розмазує увагу.

**Кешування (це головна економія):**

```
[cache_control] system + grading_rules + повний текст документа   ← стабільний префікс
                ─────────────────────────────────────────────────
                messages: батч вимог секції N                   ← змінна частина
```

Порядок рендерингу — `tools → system → messages`, кеш працює як префіксний матч,
тому документ кладемо в `system`, вимоги — в `messages`. Кешоване читання ~90% дешевше.
Максимум 4 breakpoint'и на запит. Перевіряти по `usage.cache_read_input_tokens` —
якщо нуль на повторних запитах, десь у префіксі змінюється байт (типово: таймстемп
або несортований JSON).

**Докази — через Citations API.** Документ передаємо як `document`-блок із
`citations: {enabled: true}`; відповідь повертає `cited_text` + `page_location`
(1-індексовані номери сторінок) — цитати гарантовано з документа, не вигадані.

> ⚠️ Citations **несумісні з `output_config.format`** (400). Тому structured output
> робимо через **strict tool use** — інструмент `report_finding` із `strict: true`.
> Цю сумісність перевірити на першому ж прототипі; якщо не працює — план Б:
> два проходи (citations-прохід за доказами → structured-прохід за вердиктом),
> або model_quote + пост-верифікація string-match.

### Stage 5 — Критик

Перепровіряємо **тільки `compliant`**. Найдорожча помилка — пропущена невідповідність,
а не зайва: зайву людина зніме за 10 секунд, пропущену не побачить ніколи.

Критик отримує: текст вимоги + цитати-докази (не весь документ) + вердикт.
Завдання: «знайди причину, чому цього недостатньо». Незгода → `needs_human_review`.

Плюс механічна верифікація кожної цитати:

```ts
function verifyEvidence(ev: Evidence, text: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  return norm(text).includes(norm(ev.quote));
}
```
Не знайшлася → `verified = 0`; якщо у finding немає жодного verified-доказу,
а вердикт `compliant` → примусово `needs_human_review`.

### Stage 6 — Агрегація

- **Матриця покриття:** документи × секції, колір за найгіршим вердиктом.
- **Gap-аналіз:** застосовні вимоги, де по всіх документах тільки `not_addressed`.
  Це головний вихід продукту.
- **Оцінка:** підрахунок NC за `grading_rules` → рейтинг 5..0 за шкалою стандарту.
- Експорт: XLSX (для CAP — corrective action plan), Markdown, PDF.

---

## 7. Абстракція провайдерів

```ts
// src/main/llm/types.ts
export type Stage = 'clause_extract' | 'spec_summary' | 'doc_profile' | 'judge' | 'critic';

export interface ProviderCaps {
  contextWindow: number;
  promptCaching: boolean;
  structuredOutput: 'schema' | 'tool' | 'json_mode' | 'none';
  citations: boolean;
  documentInput: ('pdf' | 'text')[];
}

export interface CompleteRequest<T> {
  stage: Stage;
  system: string;
  /** Великий стабільний блок (текст документа / реєстр вимог) — кешується. */
  cachedPrefix?: string;
  /** Вихідний PDF для Citations API, якщо провайдер уміє. */
  documents?: Array<{ name: string; base64: string; mime: string; citations: boolean }>;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  schema: z.ZodType<T>;
  maxOutputTokens: number;
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
}

export interface CompleteResult<T> {
  data: T;
  citations: Citation[];
  usage: { input: number; cachedInput: number; output: number };
  costUsd: number;
  modelId: string;
  raw: unknown;
}

export interface LlmProvider {
  readonly id: string;
  readonly caps: ProviderCaps;
  complete<T>(req: CompleteRequest<T>, signal: AbortSignal): Promise<CompleteResult<T>>;
}
```

Три адаптери покривають усе:

| Адаптер | Покриває |
|---|---|
| `AnthropicProvider` | Claude напряму через `@anthropic-ai/sdk`, з Citations API |
| `OpenRouterProvider` | Один ключ на моделі різних розробників (Claude, GPT-6, DeepSeek V4, Gemini, Qwen, Kimi, GLM, Grok): `/chat/completions` зі стрімінгом SSE, strict `json_schema`, `reasoning.effort`, облік вартості з `usage.cost` |
| `OpenAiCompatibleProvider` | Ollama, LM Studio, vLLM, llama.cpp — один код на всіх |

**OpenRouter — особливості, закладені в адаптер:**
- Citations API немає → докази тільки `model_quote` + механічна верифікація (§10).
- Structured output: strict `json_schema` + `provider.require_parameters`; якщо модель
  схему не приймає — один повтор у `json_object` зі схемою в промпті й zod-repair.
- Кеш: `cache_control` на блоці з документом (OpenRouter транслює його в Anthropic/Gemini
  breakpoint або OpenAI `prompt_cache_breakpoint`) + `session_id` від префікса, щоб усі батчі
  одного документа йшли до того самого постачальника.
- `provider.data_collection: 'deny'` за замовчуванням (ADR-8); `caps.cloud = true`, тож
  `cloudAllowed` і `localOnly` діють так само, як для Anthropic.
- Каталог моделей (ціни, контекст, допустимі effort) — вбудований знімок + живий `GET /models`
  раз на добу; баланс — `GET /key` (витрати ключа) і `GET /credits` (лише з management-ключем).

**Привʼязка моделі.** `resolveProvider()` повертає провайдер, привʼязаний до маршруту етапу:
`models = [routedModel]`, а effort із маршрутизації перекриває типовий effort промпта.
Прогін зберігає свій маршрут (`audit_run.routing`), і resume продовжує тією ж моделлю.

### Маршрутизація по етапах

```ts
export const DEFAULT_ROUTING: Record<Stage, ModelRef> = {
  clause_extract: { provider: 'anthropic', model: 'claude-sonnet-5', effort: 'medium' },
  spec_summary:   { provider: 'anthropic', model: 'claude-sonnet-5', effort: 'medium' },
  doc_profile:    { provider: 'anthropic', model: 'claude-haiku-4-5' },
  judge:          { provider: 'anthropic', model: 'claude-opus-5',   effort: 'high' },
  critic:         { provider: 'anthropic', model: 'claude-opus-5',   effort: 'high' },
};
```

Ціни (Anthropic first-party, вхід/вихід за 1M токенів), для лічильника вартості:

| Модель | ID | Контекст | Input | Output |
|---|---|---|---|---|
| Claude Opus 5 | `claude-opus-5` | 1M | $5 | $25 |
| Claude Sonnet 5 | `claude-sonnet-5` | 1M | $2 | $10 |
| Claude Haiku 4.5 | `claude-haiku-4-5` | 200K | $1 | $5 |

Прикидка на один повний аудит (183 вимоги × 10 документів, з кешуванням документа):
~30 викликів judge на документ-секцію, ≈300 викликів, вхід переважно кешований →
одиниці доларів на Opus 5. Точний облік — у `llm_call.cost_usd`, показувати в UI.

### Нотатки по API (актуально на 2026-06)

- Thinking: `thinking: {type: 'adaptive'}`; `budget_tokens` **видалено** (400 на Opus 5/Sonnet 5).
- `temperature` / `top_p` на Opus 5 і Sonnet 5 **видалені** (400). Детермінізм досягається
  строгою схемою + низьким effort, не температурою.
- Assistant prefill **видалено** (400). Формат відповіді — тільки через structured output.
- Structured output: `output_config: { format: zodOutputFormat(Schema) }` + `messages.parse()`.
  Застарілий `output_format` не використовувати.
- Стрімінг обов'язковий при великому `max_tokens` (інакше HTTP-таймаут).
- `stop_reason: 'refusal'` — перевіряти перед читанням `content`.

### Локальні моделі

Обмеження, які треба закласти в адаптер, а не в кожен виклик:
- **Мале вікно** (8–32k) → документ не влазить разом зі спекою. Fallback: чанкування
  документа + ретрив по вимозі. Ось тут ембединги стануть потрібні — але тільки тут.
- **Слабкий structured output** → `json_mode` + retry-repair (до 3 спроб з поверненням
  помилки валідації Zod у промпт).
- **Немає citations** → тільки `model_quote` + обов'язкова пост-верифікація.
- Позначати в UI, що результат від локальної моделі — інша планка довіри.

---

## 8. Промпти

Промпти зберігаються у `src/main/llm/prompts/{stage}.{version}.ts`, версія
(`prompt_version`) записується в кожен `finding` і `llm_call`. Зміна промпта = нова
версія = інвалідований кеш. Промпти англійською — документи і стандарти англомовні.

### `judge.v1`

**System (кешується):**
```
You are a compliance auditor. You assess whether a supplier's internal document
satisfies specific clauses of a customer standard.

You do NOT make things up. Every verdict about compliance must be grounded in an
exact quote from the supplied document. If the document does not mention the subject
of a clause at all, the verdict is `not_addressed` — this is NOT the same as
`non_compliant`.

Verdicts:
- compliant        — the document explicitly satisfies every element of the requirement
- partial          — the subject is covered but one or more required elements are missing
- non_compliant    — the document addresses the subject but contradicts the requirement
- not_addressed    — the document does not cover the subject of this clause
- needs_human_review — the text is ambiguous, illegible, or you cannot decide

Severity — use the customer's own grading rules:
<grading_rules>
{{spec.grading_rules}}
</grading_rules>

Requirement wording matters: "must" is mandatory, "should" is a recommendation.
A missing element of a "must" clause is at least Minor. A failure affecting product
safety, legality or the customer's brand is Critical.

Clauses often contain bulleted lists of minimum required elements. Check EVERY bullet
separately. A document covering 7 of 9 bullets is `partial`, not `compliant`.

<document name="{{doc.title}}" version="{{doc.version}}">
{{doc.text}}
</document>
```

**User (змінна частина, батч секції):**
```
Assess the document above against the following clauses from
{{spec.name}} v{{spec.version}}, section {{section.no}} — {{section.title}}.

<clauses>
{{#each clauses}}
<clause no="{{clause_no}}" topic="{{topic}}" obligation="{{obligation}}">
{{requirement_text}}
</clause>
{{/each}}
</clauses>

For each clause call `report_finding` exactly once.
```

**Tool (`strict: true`):**
```jsonc
{
  "name": "report_finding",
  "strict": true,
  "input_schema": {
    "type": "object",
    "additionalProperties": false,
    "required": ["clause_no","verdict","rationale","evidence","confidence"],
    "properties": {
      "clause_no": { "type": "string" },
      "verdict":   { "enum": ["compliant","partial","non_compliant",
                              "not_addressed","needs_human_review"] },
      "severity":  { "enum": ["critical","major","minor","recommendation","none"] },
      "confidence":{ "type": "number", "minimum": 0, "maximum": 1 },
      "rationale": { "type": "string",
                     "description": "2-4 sentences. Name the specific elements met and missing." },
      "evidence":  { "type": "array",
                     "items": { "type": "object", "additionalProperties": false,
                                "required": ["quote"],
                                "properties": { "quote": {"type":"string"},
                                                "page":  {"type":"integer"} } },
                     "description": "Verbatim quotes from the document. Required unless verdict is not_addressed." },
      "gap":            { "type": "string", "description": "What is missing, concretely." },
      "recommendation": { "type": "string", "description": "What the site should add or change." }
    }
  }
}
```

### `critic.v1`

```
You are reviewing another auditor's finding. The finding claims COMPLIANT.
Your job is to find the strongest reason why it might not be.

<clause>{{clause.requirement_text}}</clause>
<claimed_evidence>{{#each evidence}}"{{quote}}" (p.{{page}}){{/each}}</claimed_evidence>

Check specifically:
1. Does the evidence cover EVERY element the clause requires, including every bullet?
2. Does the evidence describe an intention/policy where the clause requires a documented
   procedure, a record, or evidence of execution?
3. Is the evidence about a different process that merely sounds similar?

Return `agree` only if you can defend COMPLIANT against all three.
```

### `clause_extract.v1`

```
Extract clause definitions from one page of a customer standard.

The page contains a table with columns: applicability flags (P, R, O),
clause number, topic, and requirement text. Column boundaries are lost in the
extracted text — reconstruct them.

Rules:
- Requirement text is verbatim. Preserve bullet lists as "- " lines. Do not summarise.
- Flags appear before the clause number: "P R  1.3" → modules ["P","R"].
  A blank position means that module does not apply.
- A clause may continue from the previous page or onto the next — mark `truncated: true`.
- Ignore page headers, footers, and copyright notices.
- If the page contains no clause table, return an empty array.
```

---

## 9. Кешування й детермінізм

**Ключ кешу:**
```ts
const cacheKey = sha256([
  stage,
  promptVersion,
  modelId,
  sha256(canonicalJson(input)),   // ключі відсортовані!
].join('|'));
```

Правила:
- Несортований JSON у ключі або в кешованому префіксі — типова причина промахів кешу.
- `Date.now()` у промпті — заборонено.
- Перед прогоном: `count_tokens` для оцінки вартості, показати користувачу перед стартом.
- Кеш інвалідується зміною будь-якого компонента ключа — це фіча: користувач завжди
  може відповісти на питання «чому результат змінився».

---

## 10. Верифікація і контроль якості

| Механізм | Що ловить |
|---|---|
| Citations API | Вигадані цитати — унеможливлені на рівні API |
| Пост-верифікація `verifyEvidence` | Вигадані цитати у провайдерів без citations |
| Правило «compliant без verified-доказу → needs_human_review» | Оптимістичні вердикти |
| Прохід критика по `compliant` | Пропущені невідповідності (найдорожча помилка) |
| Перевірка повноти буліт-списків у промпті | «7 з 9 пунктів = compliant» |
| Детермінований N/A | Хибні NC по незастосовних вимогах |
| Валідація реєстру вимог | Зіпсована екстракція таблиці |
| Self-consistency (опція) | Прогін критичних вимог 2–3×, розбіжність → flag |

---

## 11. Версіонування і діфи

**Діф специфікацій.** `clause.text_hash` дозволяє зіставити `v5.0` і `v5.1`:

```ts
type ClauseDiff =
  | { kind: 'added';    clause: Clause }
  | { kind: 'removed';  clause: Clause }
  | { kind: 'modified'; from: Clause; to: Clause }
  | { kind: 'renumbered'; from: Clause; to: Clause };
```

Наслідок: при оновленні стандарту переганяємо **тільки зачеплені** findings, решту
переносимо з попереднього прогону з поміткою `carried_over`. У стандарті є розділ
«Revision history and key changes» — використовуємо як перехресну перевірку діфу.

**Діф документів.** `002 → 003`: зіставляємо findings по `clause_id`:

| Перехід | Мітка |
|---|---|
| `non_compliant` → `compliant` | ✅ fixed |
| `compliant` → `non_compliant` \| `partial` | ⚠️ regressed |
| немає → будь-який NC | 🆕 new |
| без змін | unchanged |

Це і є те, за що продукт варто було б продавати.

---

## 12. Процесна архітектура Electron

```
main process
├── db/            better-sqlite3, міграції
├── ingest/        pdfjs, mammoth, ocr, normalize
├── llm/           providers, prompts, cache, cost
├── pipeline/      stages, run_task queue, orchestrator
├── ipc/           типізовані хендлери
└── secrets/       safeStorage → ключі API

utilityProcess (worker)
└── виконує run_task; шле прогрес у main, main → renderer

renderer
└── React, zustand/tanstack-query, без node integration
```

IPC — типізований контракт, жодного `ipcRenderer.invoke('any-string')` у компонентах:

```ts
// shared/ipc.ts — один контракт на обидві сторони
export interface IpcApi {
  'documents:list':      (q: DocQuery) => Promise<DocumentDto[]>;
  'documents:import':    (paths: string[]) => Promise<ImportResult>;
  'spec:clauses':        (specVersionId: number) => Promise<ClauseDto[]>;
  'spec:confirmClause':  (id: number, patch: ClausePatch) => Promise<void>;
  'run:start':           (cfg: RunConfig) => Promise<number>;
  'run:cancel':          (runId: number) => Promise<void>;
  'run:progress':        (runId: number) => AsyncIterable<RunProgress>;
  'findings:list':       (q: FindingQuery) => Promise<FindingDto[]>;
  'findings:review':     (id: number, review: HumanReview) => Promise<void>;
}
```

Безпека: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`,
CSP без `unsafe-eval`, ключі API — тільки в main через `safeStorage`,
у renderer не потрапляють ніколи.

---

## 13. UI

**Головні екрани:**

1. **Бібліотека** — документи з версіями, специфікації з версіями, імпорт drag&drop.
2. **Реєстр вимог** (Stage 1 review) — обов'язковий етап, блокує аудит.
3. **Профіль виробництва** — модулі, сертифікати, продукти; прев'ю «застосовно 147 зі 183».
4. **Аудит** — головний екран:
   - **Матриця покриття** (документи × секції) як стартовий вигляд;
   - **Список findings** із фільтрами verdict / severity / secton / reviewed;
   - **Gap-панель** — вимоги без жодного доказу.
5. **Деталь finding** — три панелі:
   ```
   ┌───────────────┬──────────────────────┬──────────────────────┐
   │ Дерево вимог│ Текст вимоги         │ PDF з підсвіченою    │
   │ (кольори      │ + rationale          │ цитатою, клік →      │
   │  вердиктів)   │ + gap/recommendation │ стрибок на сторінку  │
   └───────────────┴──────────────────────┴──────────────────────┘
   ```
6. **Діфи** — версія↔версія для документів і специфікацій.

**Режим рев'ю — клавіатурний.** Людина обробляє сотні findings; миша вб'є UX.
`A` accept · `R` reject · `E` edit · `J/K` навігація · `Space` наступний неопрацьований.

**Прогін:** прогрес по етапах і вимогах, поточна вартість у $, кнопки
Pause / Cancel / Resume. Часткові результати пишуться в БД одразу — прогін на 183
вимоги × 10 документів гарантовано десь обірветься.

---

## 14. Eval

Будується з людських правок — саме тому `ai_verdict` і `human_verdict` розділені (ADR-6).

```
eval/
├── cases.jsonl        # {docVersionId, clauseId, expectedVerdict, expectedSeverity, note}
└── report.md
```

Наповнення: кожен `finding_review`, де `human_verdict != verdict`, автоматично
пропонується як eval-кейс. Кнопка «додати в eval» прямо в UI рев'ю.

Прогін eval: `npm run eval -- --model claude-opus-5 --prompt judge.v2` →
матриця плутанини по вердиктах + список регресій відносно baseline.
Метрики: **recall по `non_compliant`** (головна — пропущена невідповідність
найдорожча), precision, точність severity ±1.

Без цього неможливо відповісти на питання «чи стало краще після зміни промпта» —
а це питання виникне на другому тижні.

---

## 15. Roadmap

| Етап | Обсяг | Готовність означає |
|---|---|---|
| **M0** Фундамент | Electron+React каркас, SQLite+міграції, імпорт PDF/DOCX, витяг тексту, версії, вбудований вьювер. **Без AI.** | Можна завантажити документ, побачити його текст і сторінки, додати нову версію |
| **M1** Реєстр вимог | Stage 1 + валідація + UI вичитки + `spec_summary` з grading_rules | 183 вимоги Tesco вичитані й підтверджені вручну |
| **M2** Перше судження | Провайдер Anthropic, Stage 4 на одній секції × одному документі, докази з citations | `Pest Management 0068` перевірено проти секції 10, докази клікабельні |
| **M3** Повний аудит | Профіль виробництва, Stage 2/3/5, черга `run_task`, resume, матриця покриття, gap-аналіз, лічильник вартості | Повний прогін 10 документів × Tesco v5.0 із відновленням після перезапуску |
| **M4** Рев'ю та експорт | Клавіатурне рев'ю, `finding_review`, експорт XLSX/PDF | Можна віддати CAP реальному аудитору |
| **M5** Зрілість | Діфи версій, мульти-провайдер (OpenAI + локальні), eval-харнес | Оновлення спеки до v5.1 переганяє тільки зачеплені вимоги |

**Не робити на старті:** ембединги, векторну БД, мульти-провайдер, хмарну синхронізацію,
багатокористувацький режим, автоматичний CAP-воркфлоу. Все це — після M4, і тільки
якщо буде реальна потреба.

---

## 16. Відкриті питання

1. **Citations + strict tool use** — чи працюють разом? Перевірити першим ділом у M2;
   від цього залежить конструкція Stage 4 (див. план Б у §6).
2. **Багатомовність.** Документи можуть бути нідерландською (приклади — англійські,
   але шапки `Versie`, `Proceseigenaar` нідерландські). Перекладати перед аналізом
   чи покластися на багатомовність моделі? Схиляюсь до другого + фіксувати `lang`.
   *Вирішено частково:* мова висновків задається в налаштуваннях (`en`/`nl`/`uk` або
   мовою стандарту), входить у ключ кешу й фіксується на старті прогону; цитати не
   перекладаються ніколи. Інтерфейс — `en`/`nl`/`uk`.
3. **Гранулярність `not_addressed`.** Для зведеного finding по всьому набору документів
   потрібен окремий рядок (`document_version_id IS NULL`) — чи рахувати на льоту?
   Поки закладено окремий рядок; переглянути на M3.
4. **Записи vs процедури.** Багато вимог Tesco вимагають *записів виконання*
   (`activity/action reports must be completed`), а не процедури. Документ-SOP такого
   ніколи не доведе. Можливо, потрібен окремий тип вердикту
   `procedure_ok_records_required` — вирішити після перших реальних прогонів.
5. **Юридичний статус.** Стандарт постачається «for use of the immediate recipient».
   Для пет-проекту неважливо; при будь-якому виході назовні — питання до вирішення
   до, а не після.

---

## Додаток: приклади даних проекту

**Специфікація:** `20405V5.0EN - Tesco Ornamental Plant Standard 2026.pdf`
— 101 стор., ~42k токенів, ~183 вимоги, 24 секції,
модулі Core / Supplier Assurance / Product Assurance, колонки P/R/O.

**Документи:** SOP нідерландського пакувальника цибулин квітів, 2–6 стор.:
- `0e443916…` — Receiving (BIO, Global G.A.P. CoC) Flowerbulbs, 0045, v003 → вимоги секцій 8, 15, 17
- `11c22d29…` — Pest Management, 0068, v002 → секція 10
- `f5e7e0c4…` — Damaged Products, 0072, v002 → секції 12, 18

Ці три документи + Tesco v5.0 — робочий набір для M2/M3.
