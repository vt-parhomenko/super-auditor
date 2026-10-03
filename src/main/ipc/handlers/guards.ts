/**
 * Спільні перевірки входу для хендлерів.
 *
 * Renderer типізований контрактом, але IPC — це межа довіри: сюди може
 * прилетіти що завгодно (баг у UI, стороннє розширення, старий preload).
 * Тому id перевіряємо, а відсутність сутності перетворюємо на `NOT_FOUND`
 * замість тихого `null`, який UI не відрізнить від «порожньо».
 *
 * Тексти помилок — ключі каталогу `@main/i18n`: мову інтерфейсу підставляє
 * межа IPC, тож гардам не треба про неї знати.
 */

import type { Db } from '@main/db';
import {
  MARKER_MAX_COUNT,
  MARKER_MAX_LENGTH,
  normalizeMarkers,
  type AuditRunDto,
  type ClauseDto,
  type DocumentVersionDto,
  type SiteProfileDto,
  type SpecVersionDto,
  type SpecificationDto,
} from '@shared/domain';
import { notFound, validation } from '../errors';

export function requireId(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw validation((m) => m.ipc.invalidId(label, String(JSON.stringify(value))));
  }
  return value;
}

/**
 * Позначки стандарту біля вимоги: масив непорожніх рядків, не більше
 * `MARKER_MAX_COUNT`, кожен не довший за `MARKER_MAX_LENGTH`. Порушення —
 * помилка, а не тихе обрізання: людина має побачити, що її правку не прийнято.
 * Повертає нормалізований список (пробіли обрізано, дублі прибрано).
 */
export function requireMarkers(value: unknown): string[] {
  const invalid = () =>
    validation((m) => m.clauseEditing.markersInvalid(MARKER_MAX_COUNT, MARKER_MAX_LENGTH));
  if (!Array.isArray(value) || value.length > MARKER_MAX_COUNT) throw invalid();
  const items: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') throw invalid();
    const marker = item.replace(/\s+/g, ' ').trim();
    if (marker.length === 0 || marker.length > MARKER_MAX_LENGTH) throw invalid();
    items.push(marker);
  }
  return normalizeMarkers(items);
}

export function requireRun(db: Db, runId: number): AuditRunDto {
  const run = db.runs.get(requireId(runId, 'runId'));
  if (!run) throw notFound('run', runId);
  return run;
}

export function requireSpecification(db: Db, specificationId: number): SpecificationDto {
  const spec = db.specs.get(requireId(specificationId, 'specificationId'));
  if (!spec) throw notFound('specification', specificationId);
  return spec;
}

export function requireSpecVersion(db: Db, specVersionId: number): SpecVersionDto {
  const version = db.specs.getVersion(requireId(specVersionId, 'specVersionId'));
  if (!version) throw notFound('specVersion', specVersionId);
  return version;
}

export function requireClause(db: Db, clauseId: number): ClauseDto {
  const clause = db.clauses.get(requireId(clauseId, 'clauseId'));
  if (!clause) throw notFound('clause', clauseId);
  return clause;
}

export function requireSiteProfile(db: Db, siteProfileId: number): SiteProfileDto {
  const site = db.siteProfiles.get(requireId(siteProfileId, 'siteProfileId'));
  if (!site) throw notFound('siteProfile', siteProfileId);
  return site;
}

export function requireDocumentVersion(db: Db, documentVersionId: number): DocumentVersionDto {
  const version = db.documents.getVersion(requireId(documentVersionId, 'documentVersionId'));
  if (!version) throw notFound('documentVersion', documentVersionId);
  return version;
}
