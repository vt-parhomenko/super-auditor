/**
 * Видалення специфікацій і документів: план («що зникне») і виконання.
 *
 * Чому окремий репозиторій, а не `specs.delete()` / `documents.delete()`.
 * У схемі навмисно НЕМАЄ каскаду від версій до результатів перевірок:
 * `audit_run.spec_version_id`, `audit_run_document.document_version_id`,
 * `finding.clause_id`, `finding.document_version_id` і
 * `finding_evidence.document_version_id` — без `ON DELETE CASCADE`. Інакше
 * результати аудиту й людські вердикти могли б тихо зникнути разом із файлом.
 * Тож видалення — свідома операція з планом: спершу перевірки, що спираються на
 * ціль, потім версії, потім файли, якими більше ніхто не користується.
 *
 * Той самий план показується людині як ціна видалення, і рівно його ж ми
 * виконуємо: `execute()` перераховує план усередині транзакції, тож між
 * підтвердженням і видаленням нічого не «проскочить» повз FK.
 *
 * Журнал витрат (`llm_spend`) не чіпаємо: гроші витрачено незалежно від того,
 * чи потрібен результат. Кеш LLM-викликів (`llm_call`) теж лишається — він не
 * прив'язаний до сутностей і дешевить повторний імпорт того самого файлу.
 */

import type { BlobDto, RunStatus } from '@shared/domain';
import type { LibraryDeleteTarget } from '@shared/ipc';
import { toBlobDto, type BlobRow } from '../mappers';
import { BaseRepo, type SqliteDb } from '../types';

/** Перевірка, яка зникне разом із ціллю. */
export interface LibraryDeletionRun {
  id: number;
  label: string | null;
  status: RunStatus;
  /** Скільки версій документів охоплює перевірка. */
  documentCount: number;
  /** Документи перевірки, які самі НЕ видаляються. */
  otherDocuments: number;
}

export interface LibraryDeletionPlan {
  target: LibraryDeleteTarget;
  /** «Tesco Ornamental Plant Standard v5.0», «0068 Pest Management v002». */
  title: string;
  /** id специфікації або документа. */
  parentId: number;
  /** Зникає й сама специфікація/документ. */
  deletesParent: boolean;
  specVersionIds: number[];
  documentVersionIds: number[];
  clauses: number;
  documentProfiles: number;
  runs: LibraryDeletionRun[];
  findings: number;
  reviewedFindings: number;
  /** Блоби, на які після видалення ніхто не посилатиметься: рядок і файл зникають. */
  orphanedBlobs: BlobDto[];
  /** Хеші блобів видалених версій, які ще використовує щось інше, — лишаються. */
  sharedBlobHashes: string[];
}

/** Ціль без підрахунків: що саме видаляємо і як це назвати. */
interface Scope {
  title: string;
  parentId: number;
  deletesParent: boolean;
  specVersionIds: number[];
  documentVersionIds: number[];
}

/**
 * Список id — одним JSON-параметром через `json_each`, а не `IN (?, ?, …)`:
 * тоді на будь-яку довжину списку припадає один підготовлений стейтмент, і кеш
 * стейтментів не росте від кількості версій чи перевірок.
 */
const IN_SPEC_VERSIONS = '(SELECT value FROM json_each(@sv))';
const IN_DOC_VERSIONS = '(SELECT value FROM json_each(@dv))';
const IN_RUNS = '(SELECT value FROM json_each(@runs))';

const asJson = (ids: readonly number[]): string => JSON.stringify(ids);

/** «0068 Pest Management» — так документ називають люди на виробництві. */
function documentName(title: string, docNumber: string | null): string {
  return docNumber ? `${docNumber} ${title}` : title;
}

export class LibraryDeletionRepo extends BaseRepo {
  constructor(db: SqliteDb) {
    super(db);
  }

  /** Ціна видалення. `null` — цілі немає. Нічого не змінює. */
  plan(target: LibraryDeleteTarget): LibraryDeletionPlan | null {
    const scope = this.scope(target);
    if (!scope) return null;

    const sv = asJson(scope.specVersionIds);
    const dv = asJson(scope.documentVersionIds);

    // Перевірки, що спираються на ціль. Не лише «за прямим зв'язком»
    // (`audit_run.spec_version_id`, `audit_run_document`), а й через findings і
    // докази: FK на клаузулу чи версію документа там без каскаду, і будь-який
    // пропущений рядок звалив би транзакцію посередині.
    const runRows = this.stmt<{
      id: number;
      label: string | null;
      status: RunStatus;
      document_count: number;
      other_documents: number;
    }>(
      `SELECT r.id, r.label, r.status,
              (SELECT COUNT(*) FROM audit_run_document a WHERE a.run_id = r.id) AS document_count,
              (SELECT COUNT(*) FROM audit_run_document a
                WHERE a.run_id = r.id AND a.document_version_id NOT IN ${IN_DOC_VERSIONS}) AS other_documents
         FROM audit_run r
        WHERE r.id IN (
                SELECT id FROM audit_run WHERE spec_version_id IN ${IN_SPEC_VERSIONS}
                UNION
                SELECT f.run_id FROM finding f JOIN clause c ON c.id = f.clause_id
                 WHERE c.spec_version_id IN ${IN_SPEC_VERSIONS}
                UNION
                SELECT run_id FROM audit_run_document WHERE document_version_id IN ${IN_DOC_VERSIONS}
                UNION
                SELECT run_id FROM finding WHERE document_version_id IN ${IN_DOC_VERSIONS}
                UNION
                SELECT f.run_id FROM finding_evidence fe JOIN finding f ON f.id = fe.finding_id
                 WHERE fe.document_version_id IN ${IN_DOC_VERSIONS}
              )
        ORDER BY r.id DESC`,
    ).all({ sv, dv });

    const runs: LibraryDeletionRun[] = runRows.map((row) => ({
      id: row.id,
      label: row.label,
      status: row.status,
      documentCount: row.document_count,
      otherDocuments: row.other_documents,
    }));

    const findings = this.stmt<{ n: number; reviewed: number | null }>(
      `SELECT COUNT(*) AS n, SUM(CASE WHEN fr.finding_id IS NULL THEN 0 ELSE 1 END) AS reviewed
         FROM finding f LEFT JOIN finding_review fr ON fr.finding_id = f.id
        WHERE f.run_id IN ${IN_RUNS}`,
    ).get({ runs: asJson(runs.map((run) => run.id)) });

    const clauses = this.stmt<{ n: number }>(
      `SELECT COUNT(*) AS n FROM clause WHERE spec_version_id IN ${IN_SPEC_VERSIONS}`,
    ).get({ sv });

    const profiles = this.stmt<{ n: number }>(
      `SELECT COUNT(*) AS n FROM doc_profile WHERE document_version_id IN ${IN_DOC_VERSIONS}`,
    ).get({ dv });

    // Сховище content-addressed: той самий PDF, імпортований двічі (як дві версії,
    // два документи чи документ і стандарт), — це ОДИН блоб. Прибираємо лише ті,
    // на які після видалення не посилатиметься жодна версія — ані напряму, ані
    // через екстракцію (`extraction_id` теж FK без каскаду).
    const blobRows = this.stmt<BlobRow & { orphaned: number }>(
      `SELECT b.*,
              CASE WHEN NOT EXISTS (SELECT 1 FROM document_version o
                                     WHERE o.blob_hash = b.hash AND o.id NOT IN ${IN_DOC_VERSIONS})
                    AND NOT EXISTS (SELECT 1 FROM spec_version o
                                     WHERE o.blob_hash = b.hash AND o.id NOT IN ${IN_SPEC_VERSIONS})
                    AND NOT EXISTS (SELECT 1 FROM document_version o JOIN extraction e ON e.id = o.extraction_id
                                     WHERE e.blob_hash = b.hash AND o.id NOT IN ${IN_DOC_VERSIONS})
                    AND NOT EXISTS (SELECT 1 FROM spec_version o JOIN extraction e ON e.id = o.extraction_id
                                     WHERE e.blob_hash = b.hash AND o.id NOT IN ${IN_SPEC_VERSIONS})
                   THEN 1 ELSE 0 END AS orphaned
         FROM blob b
        WHERE b.hash IN (SELECT blob_hash FROM document_version WHERE id IN ${IN_DOC_VERSIONS}
                         UNION
                         SELECT blob_hash FROM spec_version WHERE id IN ${IN_SPEC_VERSIONS})
        ORDER BY b.hash`,
    ).all({ sv, dv });

    return {
      target: { kind: target.kind, id: target.id },
      ...scope,
      clauses: clauses?.n ?? 0,
      documentProfiles: profiles?.n ?? 0,
      runs,
      findings: findings?.n ?? 0,
      reviewedFindings: findings?.reviewed ?? 0,
      orphanedBlobs: blobRows.filter((row) => row.orphaned === 1).map(toBlobDto),
      sharedBlobHashes: blobRows.filter((row) => row.orphaned !== 1).map((row) => row.hash),
    };
  }

  /**
   * Видаляє ціль в ОДНІЙ транзакції й повертає план, за яким видалено.
   * `null` — цілі вже немає (нічого не змінено).
   *
   * План перераховується всередині транзакції: перевірка, запущена між вікном
   * підтвердження й натисканням кнопки, теж потрапить у видалення, а не звалить
   * транзакцію на FK посередині. Файли з диска тут НЕ видаляються — це робить
   * сервіс після коміту: відкат транзакції не повернув би стертий файл.
   */
  execute(target: LibraryDeleteTarget): LibraryDeletionPlan | null {
    return this.db.transaction((): LibraryDeletionPlan | null => {
      const plan = this.plan(target);
      if (!plan) return null;

      // 1. Перевірки — першими: на версії й клаузули з них посилаються FK без каскаду.
      //    Далі каскадом: audit_run_document, run_task, finding → finding_evidence, finding_review.
      this.stmt(`DELETE FROM audit_run WHERE id IN ${IN_RUNS}`).run({
        runs: asJson(plan.runs.map((run) => run.id)),
      });

      // 2. Версії. Каскадом: clause → clause_applicability, spec_summary; doc_profile.
      this.stmt(`DELETE FROM spec_version WHERE id IN ${IN_SPEC_VERSIONS}`).run({
        sv: asJson(plan.specVersionIds),
      });
      this.stmt(`DELETE FROM document_version WHERE id IN ${IN_DOC_VERSIONS}`).run({
        dv: asJson(plan.documentVersionIds),
      });

      // 3. Ціле — коли видаляють його повністю або його останню версію:
      //    специфікація чи документ без жодної версії в списку лише заважали б.
      if (plan.deletesParent) {
        const isSpec = plan.target.kind === 'specification' || plan.target.kind === 'specVersion';
        this.stmt(isSpec ? 'DELETE FROM specification WHERE id = ?' : 'DELETE FROM document WHERE id = ?').run(
          plan.parentId,
        );
      }

      // 4. Блоби-сироти: спершу екстракції (FK extraction.blob_hash без каскаду;
      //    extraction_page піде каскадом), потім сам рядок блоба.
      for (const blob of plan.orphanedBlobs) {
        this.stmt('DELETE FROM extraction WHERE blob_hash = ?').run(blob.hash);
        this.stmt('DELETE FROM blob WHERE hash = ?').run(blob.hash);
      }

      return plan;
    })();
  }

  private scope(target: LibraryDeleteTarget): Scope | null {
    switch (target.kind) {
      case 'specification': {
        const spec = this.stmt<{ id: number; name: string }>(
          'SELECT id, name FROM specification WHERE id = ?',
        ).get(target.id);
        if (!spec) return null;
        return {
          title: spec.name,
          parentId: spec.id,
          deletesParent: true,
          specVersionIds: this.specVersionIdsOf(spec.id),
          documentVersionIds: [],
        };
      }
      case 'specVersion': {
        const row = this.stmt<{ id: number; version_label: string; specification_id: number; name: string }>(
          `SELECT sv.id, sv.version_label, sv.specification_id, s.name
             FROM spec_version sv JOIN specification s ON s.id = sv.specification_id
            WHERE sv.id = ?`,
        ).get(target.id);
        if (!row) return null;
        const siblings = this.specVersionIdsOf(row.specification_id);
        return {
          title: `${row.name} v${row.version_label}`,
          parentId: row.specification_id,
          deletesParent: siblings.every((id) => id === row.id),
          specVersionIds: [row.id],
          documentVersionIds: [],
        };
      }
      case 'document': {
        const doc = this.stmt<{ id: number; title: string; doc_number: string | null }>(
          'SELECT id, title, doc_number FROM document WHERE id = ?',
        ).get(target.id);
        if (!doc) return null;
        return {
          title: documentName(doc.title, doc.doc_number),
          parentId: doc.id,
          deletesParent: true,
          specVersionIds: [],
          documentVersionIds: this.documentVersionIdsOf(doc.id),
        };
      }
      case 'documentVersion': {
        const row = this.stmt<{
          id: number;
          version_label: string;
          document_id: number;
          title: string;
          doc_number: string | null;
        }>(
          `SELECT dv.id, dv.version_label, dv.document_id, d.title, d.doc_number
             FROM document_version dv JOIN document d ON d.id = dv.document_id
            WHERE dv.id = ?`,
        ).get(target.id);
        if (!row) return null;
        const siblings = this.documentVersionIdsOf(row.document_id);
        return {
          title: `${documentName(row.title, row.doc_number)} v${row.version_label}`,
          parentId: row.document_id,
          deletesParent: siblings.every((id) => id === row.id),
          specVersionIds: [],
          documentVersionIds: [row.id],
        };
      }
      default:
        return null;
    }
  }

  private specVersionIdsOf(specificationId: number): number[] {
    return this.stmt<{ id: number }>('SELECT id FROM spec_version WHERE specification_id = ? ORDER BY id')
      .all(specificationId)
      .map((row) => row.id);
  }

  private documentVersionIdsOf(documentId: number): number[] {
    return this.stmt<{ id: number }>('SELECT id FROM document_version WHERE document_id = ? ORDER BY id')
      .all(documentId)
      .map((row) => row.id);
  }
}
