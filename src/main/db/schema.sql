-- Super Auditor — початкова схема (міграція 1).
-- Дослівно відповідає розділу 5 «Модель даних (SQLite)» в architecture.md,
-- плюс таблиця app_setting і додаткові індекси під реальні запити репозиторіїв.
--
-- PRAGMA journal_mode / foreign_keys виставляються у connection.ts,
-- бо це властивості з'єднання, а не схеми.

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

-- ─── Профіль сайту й застосовність ──────────────────────────────────────────
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

-- ─── Понад architecture.md §5 ───────────────────────────────────────────────

-- Налаштування застосунку (AppSettings із @shared/ipc). Значення — JSON.
CREATE TABLE app_setting (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Індекси під запити репозиторіїв.
CREATE INDEX idx_extraction_blob             ON extraction(blob_hash);
CREATE INDEX idx_document_version_document   ON document_version(document_id);
CREATE INDEX idx_document_version_blob       ON document_version(blob_hash);
CREATE INDEX idx_spec_version_spec           ON spec_version(specification_id);
CREATE INDEX idx_spec_version_blob           ON spec_version(blob_hash);
-- gaps()/coverage(): вибірка клаузул секції; diff(): зіставлення версій за text_hash.
CREATE INDEX idx_clause_section              ON clause(spec_version_id, section_no, sort_key);
CREATE INDEX idx_clause_text_hash            ON clause(spec_version_id, text_hash);
CREATE INDEX idx_clause_applicability_clause ON clause_applicability(clause_id);
CREATE INDEX idx_doc_profile_version         ON doc_profile(document_version_id);
CREATE INDEX idx_audit_run_document_version  ON audit_run_document(document_version_id);
CREATE INDEX idx_audit_run_spec              ON audit_run(spec_version_id);
-- findings.list(): фільтр по документу; coverage(): агрегація по (run, doc).
CREATE INDEX idx_finding_run_document        ON finding(run_id, document_version_id);
CREATE INDEX idx_finding_clause              ON finding(clause_id);
CREATE INDEX idx_finding_evidence_finding    ON finding_evidence(finding_id);
CREATE INDEX idx_llm_call_stage              ON llm_call(stage, created_at);
