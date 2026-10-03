/**
 * Видалення специфікацій і документів — сервіс над `db.libraryDeletion`.
 *
 * Репозиторій уміє порахувати ціну й видалити рядки в одній транзакції. Тут —
 * те, чого він не може і не повинен:
 *  1. зупинити живі перевірки ДО видалення (оркестратор, async) — інакше їхні
 *     смуги виконання писали б findings у щойно видалений прогін;
 *  2. прибрати з диска файли, якими більше ніхто не користується, — ПІСЛЯ
 *     коміту: відкат транзакції не повернув би вже стертий файл. Збій тут не
 *     валить операцію (дані в БД уже узгоджені), лише пишеться в лог: зайвий
 *     файл на диску нікому не шкодить, а повторний імпорт його просто перевикористає.
 *
 * Журнал витрат не чіпаємо ніколи — гроші витрачено незалежно від долі результату.
 */

import { rm } from 'node:fs/promises';
import { extname, join } from 'node:path';
import type { BlobDto, RunStatus } from '@shared/domain';
import type { LibraryDeleteImpact, LibraryDeleteTarget } from '@shared/ipc';
import type { Db, LibraryDeletionPlan } from '@main/db';
import { remove as removeBlob } from '@main/ingest/blobStore';
import { extractedDir } from '@main/paths';

export interface LibraryDeletionDeps {
  db: Db;
  /** Зупиняє живу перевірку (у застосунку — `orchestrator.cancelRun`). */
  cancelRun: (runId: number) => Promise<void>;
  /** Прибирає файл блоба з диска. За замовчуванням — `removeStoredBlob`. */
  removeBlobFile?: (blob: BlobDto) => Promise<void>;
  logger?: { warn(...args: unknown[]): void };
}

const HASH_RE = /^[0-9a-f]{64}$/;

/** Ті самі стани, що й у `runs:delete`: лише їх оркестратор реально виконує. */
function isLive(status: RunStatus): boolean {
  return status === 'running' || status === 'queued';
}

/** План репозиторію → форма контракту. */
export function impactOf(plan: LibraryDeletionPlan): LibraryDeleteImpact {
  const versionIds =
    plan.target.kind === 'specification' || plan.target.kind === 'specVersion'
      ? plan.specVersionIds
      : plan.documentVersionIds;
  return {
    target: plan.target,
    title: plan.title,
    parentId: plan.parentId,
    deletesParent: plan.deletesParent,
    versionIds: [...versionIds],
    versions: versionIds.length,
    clauses: plan.clauses,
    documentProfiles: plan.documentProfiles,
    runs: plan.runs.map((run) => ({ ...run })),
    findings: plan.findings,
    reviewedFindings: plan.reviewedFindings,
    filesToRemove: plan.orphanedBlobs.length,
    bytesToFree: plan.orphanedBlobs.reduce((sum, blob) => sum + blob.byteSize, 0),
    sharedFilesKept: plan.sharedBlobHashes.length,
  };
}

/** Ціна видалення для вікна підтвердження. `null` — цілі немає. Нічого не змінює. */
export function libraryDeleteImpact(db: Db, target: LibraryDeleteTarget): LibraryDeleteImpact | null {
  const plan = db.libraryDeletion.plan(target);
  return plan ? impactOf(plan) : null;
}

/**
 * Видаляє ціль разом із перевірками, що на неї спираються, і файлами-сиротами.
 * Повертає фактично видалене; `null` — цілі вже немає.
 */
export async function deleteFromLibrary(
  deps: LibraryDeletionDeps,
  target: LibraryDeleteTarget,
): Promise<LibraryDeleteImpact | null> {
  const { db } = deps;
  const logger = deps.logger ?? console;
  const removeFile = deps.removeBlobFile ?? removeStoredBlob;

  const before = db.libraryDeletion.plan(target);
  if (!before) return null;

  // Спершу зупиняємо. Помилка тут (напр. оркестратор не підключено) зупиняє й
  // видалення — так само, як у `runs:delete`: поки нічого не стерто, це безпечно.
  const stopped = new Set<number>();
  for (const run of before.runs) {
    if (!isLive(run.status)) continue;
    await deps.cancelRun(run.id);
    stopped.add(run.id);
  }

  const plan = db.libraryDeletion.execute(target);
  if (!plan) return null;

  // Перевірка, що стартувала вже після підрахунку: її рядок транзакція прибрала,
  // а смуги виконання ще біжать — обриваємо, щоб вони не писали в нікуди.
  for (const run of plan.runs) {
    if (!isLive(run.status) || stopped.has(run.id)) continue;
    try {
      await deps.cancelRun(run.id);
    } catch (error) {
      logger.warn(`[library] не вдалося зупинити перевірку ${run.id} після видалення:`, error);
    }
  }

  for (const blob of plan.orphanedBlobs) {
    // Між комітом і цим місцем той самий файл могли імпортувати знову: тоді рядок
    // блоба вже є, і файл належить новій версії — не чіпаємо.
    if (db.blobs.exists(blob.hash)) continue;
    try {
      await removeFile(blob);
    } catch (error) {
      logger.warn(`[library] файл ${blob.relPath} не видалено з диска:`, error);
    }
  }

  return impactOf(plan);
}

/**
 * Прибирає файл блоба зі сховища (§4 architecture.md). Шлях будується з хеша й
 * розширення, а не з `relPath` як є, — так само, як `blob:path`: навіть зіпсований
 * рядок у БД не виведе за межі `blobs/`.
 */
export async function removeStoredBlob(blob: BlobDto): Promise<void> {
  if (!HASH_RE.test(blob.hash)) throw new Error(`Некоректний хеш блоба: ${blob.hash}`);
  await removeBlob(blob.hash, extname(blob.relPath));
  // Кеш екстракції на диску передбачений розкладкою сховища; зараз текст живе в
  // БД, але якщо файл є — він теж сирота.
  await rm(join(extractedDir(), blob.hash.slice(0, 2), blob.hash.slice(2, 4), `${blob.hash}.json`), {
    force: true,
  });
}
