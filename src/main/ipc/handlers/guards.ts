/**
 * Спільні перевірки входу для хендлерів.
 *
 * Renderer типізований контрактом, але IPC — це межа довіри: сюди може
 * прилетіти що завгодно (баг у UI, стороннє розширення, старий preload).
 * Тому id перевіряємо, а відсутність сутності перетворюємо на `NOT_FOUND`
 * замість тихого `null`, який UI не відрізнить від «порожньо».
 */

import type { Db } from '@main/db';
import type {
  AuditRunDto,
  ClauseDto,
  DocumentVersionDto,
  SiteProfileDto,
  SpecVersionDto,
  SpecificationDto,
} from '@shared/domain';
import { notFound, validation } from '../errors';

export function requireId(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw validation(`${label} має бути цілим додатним числом, отримано ${JSON.stringify(value)}`);
  }
  return value;
}

export function requireRun(db: Db, runId: number): AuditRunDto {
  const run = db.runs.get(requireId(runId, 'runId'));
  if (!run) throw notFound('Прогін', runId);
  return run;
}

export function requireSpecification(db: Db, specificationId: number): SpecificationDto {
  const spec = db.specs.get(requireId(specificationId, 'specificationId'));
  if (!spec) throw notFound('Специфікацію', specificationId);
  return spec;
}

export function requireSpecVersion(db: Db, specVersionId: number): SpecVersionDto {
  const version = db.specs.getVersion(requireId(specVersionId, 'specVersionId'));
  if (!version) throw notFound('Версію специфікації', specVersionId);
  return version;
}

export function requireClause(db: Db, clauseId: number): ClauseDto {
  const clause = db.clauses.get(requireId(clauseId, 'clauseId'));
  if (!clause) throw notFound('Вимогу', clauseId);
  return clause;
}

export function requireSiteProfile(db: Db, siteProfileId: number): SiteProfileDto {
  const site = db.siteProfiles.get(requireId(siteProfileId, 'siteProfileId'));
  if (!site) throw notFound('Профіль виробництва', siteProfileId);
  return site;
}

export function requireDocumentVersion(db: Db, documentVersionId: number): DocumentVersionDto {
  const version = db.documents.getVersion(requireId(documentVersionId, 'documentVersionId'));
  if (!version) throw notFound('Версію документа', documentVersionId);
  return version;
}
