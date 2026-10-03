/**
 * Вікно підтвердження видалення — чиста логіка без React: які рядки показати,
 * що написати на кнопці, чи вимагати окремої згоди і куди піти після видалення.
 *
 * Принцип вікна: показувати не питання, а ціну. Тому рядки — лише ненульові:
 * «0 файлів» чи «0 перевірок» — шум, що ховає справді важливе. А найважливіше —
 * людські вердикти: перерахувати модель можна, повторити роботу аудитора — ні.
 *
 * Без `@renderer/*`: тести запускаються без аліасів renderer.
 */

import type { RunStatus } from '@shared/domain';
import type { LibraryDeleteImpact, LibraryDeleteKind } from '@shared/ipc';
import type { Messages } from '../i18n/en';

export type DeleteLibraryMessages = Messages['deleteLibrary'];

export type ImpactLineKey = 'target' | 'lastVersion' | 'runs' | 'reviewed' | 'files' | 'sharedKept' | 'nothingElse';

export interface ImpactLine {
  key: ImpactLineKey;
  text: string;
  /**
   * `item` — пункт переліку «Буде видалено», `danger` — втрата людської роботи,
   * `note` — пояснення поза переліком (що лишається, що зникне заодно).
   */
  tone: 'item' | 'danger' | 'note';
}

export interface ImpactRunLine {
  id: number;
  name: string;
  status: RunStatus;
  /** Чому ця перевірка заслуговує окремої уваги: інші документи, ще виконується. */
  notes: string[];
}

/** «0068 Pest Management» — так само, як назву складає main (`LibraryDeletionRepo`). */
export function documentDisplayName(title: string, docNumber: string | null): string {
  return docNumber ? `${docNumber} ${title}` : title;
}

export function isSpecKind(kind: LibraryDeleteKind): boolean {
  return kind === 'specification' || kind === 'specVersion';
}

function isLive(status: RunStatus): boolean {
  return status === 'running' || status === 'queued';
}

/**
 * Рядки зведення в порядку читання. Порожніх рядків немає; якщо, крім самої
 * цілі, не зачеплено нічого, так і кажемо — інакше людина шукатиме підступ.
 */
export function impactLines(
  impact: LibraryDeleteImpact,
  m: DeleteLibraryMessages,
  formatBytes: (bytes: number) => string,
): ImpactLine[] {
  const { kind } = impact.target;
  const lines: ImpactLine[] = [];

  // Ціль: деталі в дужках — лише ненульові.
  const details: string[] = [];
  if (kind === 'specification' || kind === 'document') {
    if (impact.versions > 0) details.push(m.versions(impact.versions));
  }
  if (impact.clauses > 0) details.push(m.clauses(impact.clauses));
  if (impact.documentProfiles > 0) details.push(m.profiles(impact.documentProfiles));
  const target = m.target[kind](impact.title);
  lines.push({ key: 'target', text: details.length > 0 ? `${target} (${details.join(', ')})` : target, tone: 'item' });

  if (impact.runs.length > 0) {
    const runs = m.runs(impact.runs.length);
    lines.push({
      key: 'runs',
      text: impact.findings > 0 ? `${runs} (${m.findings(impact.findings)})` : runs,
      tone: 'item',
    });
  }
  if (impact.reviewedFindings > 0) {
    lines.push({ key: 'reviewed', text: m.reviewed(impact.reviewedFindings), tone: 'danger' });
  }
  if (impact.filesToRemove > 0) {
    lines.push({ key: 'files', text: m.files(impact.filesToRemove, formatBytes(impact.bytesToFree)), tone: 'item' });
  }

  if (impact.deletesParent && (kind === 'specVersion' || kind === 'documentVersion')) {
    lines.push({ key: 'lastVersion', text: m.lastVersion[kind], tone: 'note' });
  }
  if (impact.sharedFilesKept > 0) {
    lines.push({ key: 'sharedKept', text: m.sharedKept(impact.sharedFilesKept), tone: 'note' });
  }
  if (impact.runs.length === 0) {
    lines.push({ key: 'nothingElse', text: m.nothingElse, tone: 'note' });
  }
  return lines;
}

/**
 * Перевірки, що зникнуть. Позначка «містить ще N документів» — лише коли
 * видаляють документ: перевірка неподільна, і разом із цим документом зникнуть
 * результати по інших. Для специфікації це очевидно й позначка була б шумом.
 */
export function impactRuns(impact: LibraryDeleteImpact, m: DeleteLibraryMessages): ImpactRunLine[] {
  const flagOthers = !isSpecKind(impact.target.kind);
  return impact.runs.map((run) => {
    const notes: string[] = [];
    if (flagOthers && run.otherDocuments > 0) notes.push(m.runOtherDocuments(run.otherDocuments));
    if (isLive(run.status)) notes.push(m.runLive);
    return { id: run.id, name: run.label ?? m.runUnnamed, status: run.status, notes };
  });
}

/** Людські вердикти не відновити — перед їх втратою потрібна окрема явна згода. */
export function needsAcknowledgement(impact: LibraryDeleteImpact): boolean {
  return impact.reviewedFindings > 0;
}

export function confirmLabel(impact: LibraryDeleteImpact, m: DeleteLibraryMessages): string {
  return m.confirm[impact.target.kind](impact.runs.length);
}

/**
 * Куди піти, якщо поточна сторінка показує те, що щойно видалено.
 * `null` — сторінка лишається валідною.
 */
export function routeAfterDeletion(pathname: string, impact: LibraryDeleteImpact): string | null {
  const runIds = new Set(impact.runs.map((run) => run.id));
  const run = /^\/runs\/(\d+)(?:\/|$)/.exec(pathname);
  if (run && runIds.has(Number(run[1]))) return '/runs';

  if (isSpecKind(impact.target.kind)) {
    const registry = /^\/specs\/(\d+)\/clauses(?:\/|$)/.exec(pathname);
    if (registry && impact.versionIds.includes(Number(registry[1]))) return '/specs';
    return null;
  }

  const documentRuns = /^\/library\/(\d+)\/runs(?:\/|$)/.exec(pathname);
  if (documentRuns && impact.deletesParent && Number(documentRuns[1]) === impact.parentId) return '/library';
  return null;
}
