/**
 * Прогони аудиту: `audit_run`, `audit_run_document`, черга `run_task`
 * і агрегації Stage 6 — матриця покриття, gap-аналіз, зведення.
 *
 * Скрізь в агрегаціях використовується ЕФЕКТИВНИЙ вердикт
 * `COALESCE(finding_review.human_verdict, finding.verdict)`: якщо аудитор зняв
 * невідповідність вручну, вона не має світитися червоним у матриці. Сирий
 * вердикт моделі при цьому лишається недоторканим (ADR-6).
 */

import {
  STAGES,
  emptyUsage,
  emptyVerdictCounts,
  worstVerdict,
  type AuditRunDto,
  type CoverageCell,
  type CoverageMatrix,
  type DocumentRunStats,
  type GapItem,
  type Obligation,
  type RunProgress,
  type RunStatus,
  type RunSummary,
  type Severity,
  type Stage,
  type UsageTotals,
  type Verdict,
} from '@shared/domain';
import {
  nowIso,
  toAuditRunDto,
  toRunTaskDto,
  toUsageTotals,
  type AuditRunRow,
  type RunTaskDto,
  type RunTaskRow,
} from '../mappers';
import { BaseRepo, toId, type SqliteDb } from '../types';

export interface RunInput {
  label?: string | null;
  specVersionId: number;
  siteProfileId: number | null;
  documentVersionIds: readonly number[];
  modelJudge: string;
  modelCritic?: string | null;
  promptVersion: string;
  status?: RunStatus;
}

export interface RunTaskInput {
  stage: string;
  payload: unknown;
}

export interface TaskCounts {
  pending: number;
  running: number;
  done: number;
  failed: number;
  skipped: number;
  total: number;
}

const SEVERITY_RANK: Record<Severity, number> = {
  recommendation: 0,
  minor: 1,
  major: 2,
  critical: 3,
};

/** Ефективний вердикт/severity — людська правка накриває модельну. */
const EFFECTIVE_VERDICT = 'COALESCE(fr.human_verdict, f.verdict)';
const EFFECTIVE_SEVERITY = 'COALESCE(fr.human_severity, f.severity)';

export class RunsRepo extends BaseRepo {
  constructor(db: SqliteDb) {
    super(db);
  }

  // ─── CRUD ──────────────────────────────────────────────────────────────────

  create(input: RunInput): AuditRunDto {
    const write = this.db.transaction((): number => {
      const res = this.stmt(
        `INSERT INTO audit_run
           (label, spec_version_id, site_profile_id, status, model_judge, model_critic, prompt_version)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        input.label ?? null,
        input.specVersionId,
        input.siteProfileId,
        input.status ?? 'queued',
        input.modelJudge,
        input.modelCritic ?? null,
        input.promptVersion,
      );
      const runId = toId(res);
      const link = this.stmt(
        'INSERT OR IGNORE INTO audit_run_document (run_id, document_version_id) VALUES (?, ?)',
      );
      for (const dvId of input.documentVersionIds) link.run(runId, dvId);
      return runId;
    });

    const dto = this.get(write());
    if (!dto) throw new Error('Не вдалося прочитати щойно створений прогін');
    return dto;
  }

  get(id: number): AuditRunDto | null {
    const row = this.stmt<AuditRunRow>('SELECT * FROM audit_run WHERE id = ?').get(id);
    if (!row) return null;
    return toAuditRunDto(row, this.documentVersionIds(id));
  }

  list(): AuditRunDto[] {
    const rows = this.stmt<AuditRunRow>(
      "SELECT * FROM audit_run ORDER BY COALESCE(started_at, '') DESC, id DESC",
    ).all();
    if (rows.length === 0) return [];

    const links = this.stmt<{ run_id: number; document_version_id: number }>(
      `SELECT run_id, document_version_id FROM audit_run_document
       WHERE run_id IN (${this.placeholders(rows.length)}) ORDER BY run_id, document_version_id`,
    ).all(...rows.map((r) => r.id));

    const byRun = new Map<number, number[]>();
    for (const link of links) {
      const list = byRun.get(link.run_id);
      if (list) list.push(link.document_version_id);
      else byRun.set(link.run_id, [link.document_version_id]);
    }

    return rows.map((row) => toAuditRunDto(row, byRun.get(row.id) ?? []));
  }

  documentVersionIds(runId: number): number[] {
    return this.stmt<{ document_version_id: number }>(
      'SELECT document_version_id FROM audit_run_document WHERE run_id = ? ORDER BY document_version_id',
    )
      .all(runId)
      .map((r) => r.document_version_id);
  }

  addDocument(runId: number, documentVersionId: number): void {
    this.stmt(
      'INSERT OR IGNORE INTO audit_run_document (run_id, document_version_id) VALUES (?, ?)',
    ).run(runId, documentVersionId);
  }

  removeDocument(runId: number, documentVersionId: number): boolean {
    return (
      this.stmt('DELETE FROM audit_run_document WHERE run_id = ? AND document_version_id = ?').run(
        runId,
        documentVersionId,
      ).changes > 0
    );
  }

  setStatus(runId: number, status: RunStatus, error: string | null = null): void {
    this.stmt('UPDATE audit_run SET status = ?, error = ? WHERE id = ?').run(status, error, runId);
  }

  markStarted(runId: number, at: string = nowIso()): void {
    this.stmt(
      "UPDATE audit_run SET status = 'running', started_at = COALESCE(started_at, ?), error = NULL WHERE id = ?",
    ).run(at, runId);
  }

  markFinished(runId: number, status: RunStatus, error: string | null = null, at: string = nowIso()): void {
    this.stmt('UPDATE audit_run SET status = ?, finished_at = ?, error = ? WHERE id = ?').run(
      status,
      at,
      error,
      runId,
    );
  }

  /** Інкрементальний облік вартості — воркер додає usage після кожного виклику. */
  addUsage(runId: number, delta: Partial<UsageTotals>): UsageTotals {
    this.stmt(
      `UPDATE audit_run
          SET input_tokens = input_tokens + ?,
              cached_tokens = cached_tokens + ?,
              output_tokens = output_tokens + ?,
              cost_usd = cost_usd + ?
        WHERE id = ?`,
    ).run(
      delta.inputTokens ?? 0,
      delta.cachedTokens ?? 0,
      delta.outputTokens ?? 0,
      delta.costUsd ?? 0,
      runId,
    );
    return this.usage(runId);
  }

  usage(runId: number): UsageTotals {
    const row = this.stmt<AuditRunRow>(
      'SELECT input_tokens, cached_tokens, output_tokens, cost_usd FROM audit_run WHERE id = ?',
    ).get(runId);
    return row ? toUsageTotals(row) : emptyUsage();
  }

  delete(runId: number): boolean {
    return this.stmt('DELETE FROM audit_run WHERE id = ?').run(runId).changes > 0;
  }

  // ─── Прогрес ───────────────────────────────────────────────────────────────

  progress(runId: number): RunProgress {
    const run = this.get(runId);
    const counts = this.taskCounts(runId);
    const currentRow = this.stmt<{ stage: string }>(
      `SELECT stage FROM run_task WHERE run_id = ? AND status IN ('running','pending')
       ORDER BY status = 'running' DESC, id LIMIT 1`,
    ).get(runId);

    const stageRaw = currentRow?.stage;
    const known: readonly string[] = STAGES;
    const stage: Stage | null = stageRaw !== undefined && known.includes(stageRaw) ? (stageRaw as Stage) : null;

    return {
      runId,
      status: run?.status ?? 'queued',
      stage,
      tasksTotal: counts.total,
      tasksDone: counts.done + counts.skipped,
      tasksFailed: counts.failed,
      currentLabel: null,
      usage: run?.usage ?? emptyUsage(),
    };
  }

  taskCounts(runId: number): TaskCounts {
    const rows = this.stmt<{ status: string; n: number }>(
      'SELECT status, COUNT(*) AS n FROM run_task WHERE run_id = ? GROUP BY status',
    ).all(runId);
    const counts: TaskCounts = { pending: 0, running: 0, done: 0, failed: 0, skipped: 0, total: 0 };
    for (const row of rows) {
      if (row.status === 'pending') counts.pending = row.n;
      else if (row.status === 'running') counts.running = row.n;
      else if (row.status === 'done') counts.done = row.n;
      else if (row.status === 'failed') counts.failed = row.n;
      else if (row.status === 'skipped') counts.skipped = row.n;
      counts.total += row.n;
    }
    return counts;
  }

  // ─── Stage 6: матриця покриття ─────────────────────────────────────────────

  /**
   * Документи × секції, у клітинці — найгірший вердикт і розклад по вердиктах.
   * Клітинки без жодного finding не створюються: UI малює їх як «немає даних».
   */
  coverage(runId: number): CoverageMatrix {
    const run = this.stmt<{ spec_version_id: number }>(
      'SELECT spec_version_id FROM audit_run WHERE id = ?',
    ).get(runId);
    if (!run) return { runId, sections: [], documents: [], cells: [] };

    const sections = this.stmt<{ section_no: string; section_title: string | null; n: number }>(
      `SELECT c.section_no,
              (SELECT c2.section_title FROM clause c2
                WHERE c2.spec_version_id = c.spec_version_id AND c2.section_no = c.section_no
                  AND c2.section_title IS NOT NULL
                ORDER BY c2.sort_key LIMIT 1) AS section_title,
              COUNT(*) AS n
       FROM clause c
       WHERE c.spec_version_id = ? AND c.section_no IS NOT NULL
       GROUP BY c.section_no
       ORDER BY MIN(c.sort_key)`,
    ).all(run.spec_version_id);

    const documents = this.stmt<{ id: number; title: string; version_label: string }>(
      `SELECT dv.id, d.title, dv.version_label
       FROM audit_run_document ard
       JOIN document_version dv ON dv.id = ard.document_version_id
       JOIN document d ON d.id = dv.document_id
       WHERE ard.run_id = ?
       ORDER BY d.doc_number IS NULL, d.doc_number, d.title, dv.id`,
    ).all(runId);

    // Псевдонім навмисно НЕ `verdict`: у SQLite GROUP BY спершу шукає однойменну
    // колонку таблиці (f.verdict) і мовчки згрупує не за тим виразом.
    const cellRows = this.stmt<{
      section_no: string;
      document_version_id: number;
      eff_verdict: string;
      n: number;
    }>(
      `SELECT c.section_no AS section_no,
              f.document_version_id AS document_version_id,
              ${EFFECTIVE_VERDICT} AS eff_verdict,
              COUNT(*) AS n
       FROM finding f
       JOIN clause c ON c.id = f.clause_id
       LEFT JOIN finding_review fr ON fr.finding_id = f.id
       WHERE f.run_id = ? AND f.document_version_id IS NOT NULL AND c.section_no IS NOT NULL
       GROUP BY c.section_no, f.document_version_id, eff_verdict`,
    ).all(runId);

    const cellMap = new Map<string, CoverageCell>();
    for (const row of cellRows) {
      const key = `${row.section_no}\u0000${row.document_version_id}`;
      let cell = cellMap.get(key);
      if (!cell) {
        cell = {
          sectionNo: row.section_no,
          documentVersionId: row.document_version_id,
          worstVerdict: 'not_addressed',
          counts: emptyVerdictCounts(),
        };
        cellMap.set(key, cell);
      }
      cell.counts[row.eff_verdict as Verdict] += row.n;
    }

    for (const cell of cellMap.values()) {
      const present = (Object.keys(cell.counts) as Verdict[]).filter((v) => cell.counts[v] > 0);
      cell.worstVerdict = worstVerdict(present);
    }

    // Порядок клітинок — за порядком секцій, потім документів: UI малює рядки як є.
    const sectionOrder = new Map(sections.map((s, i) => [s.section_no, i]));
    const documentOrder = new Map(documents.map((d, i) => [d.id, i]));
    const cells = [...cellMap.values()].sort((a, b) => {
      const sa = sectionOrder.get(a.sectionNo) ?? Number.MAX_SAFE_INTEGER;
      const sb = sectionOrder.get(b.sectionNo) ?? Number.MAX_SAFE_INTEGER;
      if (sa !== sb) return sa - sb;
      const da = documentOrder.get(a.documentVersionId) ?? Number.MAX_SAFE_INTEGER;
      const db = documentOrder.get(b.documentVersionId) ?? Number.MAX_SAFE_INTEGER;
      return da - db;
    });

    return {
      runId,
      sections: sections.map((s) => ({
        sectionNo: s.section_no,
        sectionTitle: s.section_title,
        clauseCount: s.n,
      })),
      documents: documents.map((d) => ({
        documentVersionId: d.id,
        title: d.title,
        versionLabel: d.version_label,
      })),
      cells,
    };
  }

  // ─── Stage 6: gap-аналіз ───────────────────────────────────────────────────

  /**
   * Застосовні вимоги, які не покрив ЖОДЕН документ прогону:
   * по всіх документах вердикт лише `not_addressed`, або finding немає взагалі.
   *
   * `severityIfMissing` — найвища severity серед not_addressed-findings цієї
   * вимоги; якщо findings немає, severity невідома → null.
   */
  gaps(runId: number): GapItem[] {
    const rows = this.stmt<{
      id: number;
      clause_no: string;
      section_no: string | null;
      section_title: string | null;
      topic: string | null;
      obligation: string | null;
      requirement_text: string;
      page_from: number | null;
      page_to: number | null;
      severities: string | null;
    }>(
      `SELECT c.id, c.clause_no, c.section_no, c.section_title, c.topic, c.obligation,
              c.requirement_text, c.page_from, c.page_to,
              (SELECT GROUP_CONCAT(DISTINCT ${EFFECTIVE_SEVERITY})
                 FROM finding f
                 LEFT JOIN finding_review fr ON fr.finding_id = f.id
                WHERE f.run_id = r.id AND f.clause_id = c.id) AS severities
       FROM audit_run r
       JOIN clause c ON c.spec_version_id = r.spec_version_id
       LEFT JOIN clause_applicability ca
              ON ca.clause_id = c.id AND ca.site_profile_id = r.site_profile_id
       WHERE r.id = ?
         AND COALESCE(ca.applicable, 1) = 1
         AND NOT EXISTS (
               SELECT 1 FROM finding f
               LEFT JOIN finding_review fr ON fr.finding_id = f.id
               WHERE f.run_id = r.id AND f.clause_id = c.id
                 AND ${EFFECTIVE_VERDICT} <> 'not_addressed'
             )
       ORDER BY c.sort_key`,
    ).all(runId);

    return rows.map((row) => ({
      clauseId: row.id,
      clauseNo: row.clause_no,
      sectionNo: row.section_no,
      sectionTitle: row.section_title,
      topic: row.topic,
      obligation: row.obligation === null ? null : (row.obligation as Obligation),
      requirementText: row.requirement_text,
      severityIfMissing: worstSeverity(row.severities),
      pageFrom: row.page_from,
      pageTo: row.page_to,
    }));
  }


  /**
   * Прогони, що торкались цього документа, від найновішого.
   *
   * Лічильники — ЛИШЕ по findings відповідної версії документа: прогін може
   * охоплювати десяток файлів, але користувач дивиться на свій один.
   */
  forDocument(documentId: number): DocumentRunStats[] {
    const heads = this.stmt<{
      run_id: number;
      label: string | null;
      status: string;
      started_at: string | null;
      finished_at: string | null;
      dv_id: number;
      dv_label: string;
      spec_name: string;
      spec_label: string;
    }>(
      `SELECT r.id AS run_id, r.label, r.status, r.started_at, r.finished_at,
              dv.id AS dv_id, dv.version_label AS dv_label,
              sp.name AS spec_name, sv.version_label AS spec_label
         FROM audit_run r
         JOIN audit_run_document ard ON ard.run_id = r.id
         JOIN document_version dv ON dv.id = ard.document_version_id
         JOIN spec_version sv ON sv.id = r.spec_version_id
         JOIN specification sp ON sp.id = sv.specification_id
        WHERE dv.document_id = ?
        ORDER BY r.id DESC`,
    ).all(documentId);

    if (heads.length === 0) return [];

    const keys = heads.map((h) => `${h.run_id}:${h.dv_id}`);
    const placeholders = heads.map(() => '(?, ?)').join(', ');
    const params = heads.flatMap((h) => [h.run_id, h.dv_id]);

    const agg = this.stmt<{
      run_id: number;
      document_version_id: number;
      eff_verdict: string;
      eff_severity: string | null;
      reviewed: number;
      n: number;
    }>(
      `SELECT f.run_id, f.document_version_id,
              ${EFFECTIVE_VERDICT} AS eff_verdict,
              ${EFFECTIVE_SEVERITY} AS eff_severity,
              SUM(CASE WHEN fr.finding_id IS NULL THEN 0 ELSE 1 END) AS reviewed,
              COUNT(*) AS n
         FROM finding f
         LEFT JOIN finding_review fr ON fr.finding_id = f.id
        WHERE (f.run_id, f.document_version_id) IN (VALUES ${placeholders})
        GROUP BY f.run_id, f.document_version_id, eff_verdict, eff_severity`,
    ).all(...params);

    const buckets = new Map<string, DocumentRunStats>();
    for (const h of heads) {
      buckets.set(`${h.run_id}:${h.dv_id}`, {
        runId: h.run_id,
        label: h.label,
        status: h.status as RunStatus,
        startedAt: h.started_at,
        finishedAt: h.finished_at,
        specName: h.spec_name,
        specVersionLabel: h.spec_label,
        documentVersionId: h.dv_id,
        documentVersionLabel: h.dv_label,
        counts: emptyVerdictCounts(),
        severityCounts: emptySeverityCounts(),
        assessed: 0,
        relevant: 0,
        reviewed: 0,
      });
    }

    for (const row of agg) {
      const stats = buckets.get(`${row.run_id}:${row.document_version_id}`);
      if (!stats) continue;

      const verdict = row.eff_verdict as Verdict;
      stats.counts[verdict] += row.n;
      stats.assessed += row.n;
      if (verdict !== 'not_addressed' && verdict !== 'not_applicable') stats.relevant += row.n;
      stats.reviewed += row.reviewed;

      // Severity — лише по справжніх невідповідностях, як і у зведенні прогону.
      if (
        row.eff_severity !== null &&
        (verdict === 'partial' || verdict === 'non_compliant') &&
        row.eff_severity in stats.severityCounts
      ) {
        stats.severityCounts[row.eff_severity as Severity] += row.n;
      }
    }

    return keys.map((k) => buckets.get(k)!).filter(Boolean);
  }

  /** Останній прогін для кожного документа — для карток у бібліотеці. */
  latestForDocuments(documentIds: readonly number[]): Map<number, DocumentRunStats> {
    const out = new Map<number, DocumentRunStats>();
    for (const id of documentIds) {
      const first = this.forDocument(id)[0];
      if (first) out.set(id, first);
    }
    return out;
  }

  // ─── Stage 6: зведення ─────────────────────────────────────────────────────

  /**
   * Лічильники прогону. `grade` поки завжди null — рейтинг за шкалою стандарту
   * рахується з `spec_summary.grading_rules`, а їхній розбір ще не реалізовано.
   */
  summary(runId: number): RunSummary {
    const run = this.stmt<AuditRunRow>('SELECT * FROM audit_run WHERE id = ?').get(runId);
    if (!run) {
      return {
        runId,
        clausesApplicable: 0,
        clausesAssessed: 0,
        counts: emptyVerdictCounts(),
        severityCounts: emptySeverityCounts(),
        gaps: 0,
        grade: null,
        usage: emptyUsage(),
      };
    }

    const applicableRow = this.stmt<{ n: number }>(
      `SELECT COUNT(*) AS n
         FROM clause c
         LEFT JOIN clause_applicability ca
                ON ca.clause_id = c.id AND ca.site_profile_id = ?
        WHERE c.spec_version_id = ? AND COALESCE(ca.applicable, 1) = 1`,
    ).get(run.site_profile_id, run.spec_version_id);

    const assessedRow = this.stmt<{ n: number }>(
      'SELECT COUNT(DISTINCT clause_id) AS n FROM finding WHERE run_id = ?',
    ).get(runId);

    // `eff_*`, а не `verdict`/`severity`: GROUP BY по псевдоніму, що збігається
    // з іменем колонки таблиці, у SQLite групує по колонці, а не по виразу.
    const counts = emptyVerdictCounts();
    for (const row of this.stmt<{ eff_verdict: string; n: number }>(
      `SELECT ${EFFECTIVE_VERDICT} AS eff_verdict, COUNT(*) AS n
         FROM finding f LEFT JOIN finding_review fr ON fr.finding_id = f.id
        WHERE f.run_id = ? GROUP BY eff_verdict`,
    ).all(runId)) {
      counts[row.eff_verdict as Verdict] += row.n;
    }

    // Severity рахуємо ТІЛЬКИ по справжніх невідповідностях.
    //
    // Модель проставляє severity і вимогам із вердиктом `not_addressed` — у сенсі
    // «наскільки погано, якби цього не було ніде». Для одного документа таких
    // вердиктів більшість (у реальному прогоні 140 зі 183), і якщо їх порахувати,
    // за шкалою Tesco (1 critical АБО 4+ major → Unsatisfactory) будь-яка окрема
    // інструкція автоматично провалює аудит. Непокриті вимоги рахуються окремо —
    // як `gaps`, зі своїм `severityIfMissing`.
    const severityCounts = emptySeverityCounts();
    for (const row of this.stmt<{ eff_severity: string | null; n: number }>(
      `SELECT ${EFFECTIVE_SEVERITY} AS eff_severity, COUNT(*) AS n
         FROM finding f LEFT JOIN finding_review fr ON fr.finding_id = f.id
        WHERE f.run_id = ?
          AND ${EFFECTIVE_VERDICT} IN ('non_compliant', 'partial')
        GROUP BY eff_severity`,
    ).all(runId)) {
      if (row.eff_severity !== null && row.eff_severity in severityCounts) {
        severityCounts[row.eff_severity as Severity] += row.n;
      }
    }

    return {
      runId,
      clausesApplicable: applicableRow?.n ?? 0,
      clausesAssessed: assessedRow?.n ?? 0,
      counts,
      severityCounts,
      gaps: this.gaps(runId).length,
      // TODO: рейтинг 5..0 за spec_summary.grading_rules — правила розбираємо пізніше.
      grade: null,
      usage: toUsageTotals(run),
    };
  }
}

/**
 * Черга завдань прогону — те, що робить прогін відновлюваним.
 * Живе поруч із RunsRepo, бо `run_task` не має сенсу без `audit_run`.
 */
export class RunTasksRepo extends BaseRepo {
  constructor(db: SqliteDb) {
    super(db);
  }

  enqueue(runId: number, task: RunTaskInput): RunTaskDto {
    const res = this.stmt(
      'INSERT INTO run_task (run_id, stage, payload, status, updated_at) VALUES (?, ?, ?, \'pending\', ?)',
    ).run(runId, task.stage, JSON.stringify(task.payload ?? null), nowIso());
    const dto = this.get(toId(res));
    if (!dto) throw new Error('Не вдалося прочитати щойно створене завдання');
    return dto;
  }

  enqueueMany(runId: number, tasks: readonly RunTaskInput[]): number {
    const write = this.db.transaction((items: readonly RunTaskInput[]): number => {
      const insert = this.stmt(
        'INSERT INTO run_task (run_id, stage, payload, status, updated_at) VALUES (?, ?, ?, \'pending\', ?)',
      );
      const at = nowIso();
      for (const task of items) insert.run(runId, task.stage, JSON.stringify(task.payload ?? null), at);
      return items.length;
    });
    return write(tasks);
  }

  get(id: number): RunTaskDto | null {
    const row = this.stmt<RunTaskRow>('SELECT * FROM run_task WHERE id = ?').get(id);
    return row ? toRunTaskDto(row) : null;
  }

  list(runId: number, status?: RunTaskDto['status']): RunTaskDto[] {
    const rows =
      status === undefined
        ? this.stmt<RunTaskRow>('SELECT * FROM run_task WHERE run_id = ? ORDER BY id').all(runId)
        : this.stmt<RunTaskRow>(
            'SELECT * FROM run_task WHERE run_id = ? AND status = ? ORDER BY id',
          ).all(runId, status);
    return rows.map(toRunTaskDto);
  }

  /**
   * Атомарно забирає наступне завдання: `pending → running`, `attempts += 1`.
   *
   * UPDATE ... WHERE id = (SELECT ... LIMIT 1) RETURNING * — один стейтмент,
   * тому двоє воркерів фізично не можуть отримати те саме завдання.
   * `.immediate()` бере write-lock одразу, а не після першої спроби запису:
   * без цього два процеси в WAL можуть впертися в SQLITE_BUSY на апгрейді
   * блокування, і один з них отримає помилку замість очікування.
   */
  claimNext(runId: number, stage?: string): RunTaskDto | null {
    const claim = this.db.transaction((): RunTaskRow | undefined => {
      const sql =
        stage === undefined
          ? `UPDATE run_task
                SET status = 'running', attempts = attempts + 1, updated_at = ?
              WHERE id = (SELECT id FROM run_task WHERE run_id = ? AND status = 'pending' ORDER BY id LIMIT 1)
              RETURNING *`
          : `UPDATE run_task
                SET status = 'running', attempts = attempts + 1, updated_at = ?
              WHERE id = (SELECT id FROM run_task WHERE run_id = ? AND stage = ? AND status = 'pending'
                          ORDER BY id LIMIT 1)
              RETURNING *`;
      const stmt = this.stmt<RunTaskRow>(sql);
      return stage === undefined ? stmt.get(nowIso(), runId) : stmt.get(nowIso(), runId, stage);
    });

    const row = claim.immediate();
    return row ? toRunTaskDto(row) : null;
  }

  complete(id: number): void {
    this.stmt("UPDATE run_task SET status = 'done', last_error = NULL, updated_at = ? WHERE id = ?").run(
      nowIso(),
      id,
    );
  }

  fail(id: number, error: string, retry = false): void {
    this.stmt('UPDATE run_task SET status = ?, last_error = ?, updated_at = ? WHERE id = ?').run(
      retry ? 'pending' : 'failed',
      error,
      nowIso(),
      id,
    );
  }

  skip(id: number, reason: string | null = null): void {
    this.stmt("UPDATE run_task SET status = 'skipped', last_error = ?, updated_at = ? WHERE id = ?").run(
      reason,
      nowIso(),
      id,
    );
  }

  /**
   * Відновлення після падіння: завдання, що лишились у `running`, нікому
   * не належать — повертаємо їх у чергу.
   */
  requeueStale(runId: number): number {
    return this.stmt(
      "UPDATE run_task SET status = 'pending', updated_at = ? WHERE run_id = ? AND status = 'running'",
    ).run(nowIso(), runId).changes;
  }

  /** Повторити невдалі завдання (кнопка Resume після серії помилок). */
  requeueFailed(runId: number): number {
    return this.stmt(
      "UPDATE run_task SET status = 'pending', updated_at = ? WHERE run_id = ? AND status = 'failed'",
    ).run(nowIso(), runId).changes;
  }

  deleteByRun(runId: number): number {
    return this.stmt('DELETE FROM run_task WHERE run_id = ?').run(runId).changes;
  }
}

export function emptySeverityCounts(): Record<Severity, number> {
  return { critical: 0, major: 0, minor: 0, recommendation: 0 };
}

/** GROUP_CONCAT повертає 'major,minor' або NULL — беремо найважчу. */
function worstSeverity(concatenated: string | null): Severity | null {
  if (!concatenated) return null;
  let best: Severity | null = null;
  for (const part of concatenated.split(',')) {
    const value = part.trim();
    if (!(value in SEVERITY_RANK)) continue;
    const severity = value as Severity;
    if (best === null || SEVERITY_RANK[severity] > SEVERITY_RANK[best]) best = severity;
  }
  return best;
}
