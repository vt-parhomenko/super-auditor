/**
 * Stage 0: вибір файлів, імпорт, доступ до вихідного тексту й до блоба.
 *
 * `blob:path` — єдиний канал, який віддає renderer'у шлях у файловій системі
 * (для вбудованого PDF-вьювера), тому він же найчутливіший: шлях будується
 * З ХЕША, знайденого в БД, а не з рядка користувача, і додатково перевіряється
 * на належність теці блобів.
 */

import { dialog } from 'electron';
import { existsSync, readFileSync } from 'node:fs';
import { extname, resolve as resolvePath, sep } from 'node:path';
import { blobPath, blobsDir } from '@main/paths';
import { importFiles } from '@main/pipeline/import';
import { uiMessages, type MainMessages } from '@main/i18n';
import type { IpcHandlers } from '@shared/ipc';
import type { IpcContext } from '../context';
import { internal, notFound, validation } from '../errors';
import { requireId } from './guards';

export type ImportHandlers = Pick<
  IpcHandlers,
  'import:pick' | 'import:run' | 'extraction:get' | 'blob:path' | 'blob:read'
>;

const HASH_RE = /^[0-9a-f]{64}$/;

/** Фільтри системного діалогу — підписи мовою інтерфейсу. */
function fileFilters(m: MainMessages): Electron.FileFilter[] {
  return [
    { name: m.importing.filterDocuments, extensions: ['pdf', 'docx'] },
    { name: 'PDF', extensions: ['pdf'] },
    { name: 'Word', extensions: ['docx', 'doc'] },
    { name: m.importing.filterAll, extensions: ['*'] },
  ];
}

export function importHandlers(ctx: IpcContext): ImportHandlers {
  const { db, events } = ctx;

  return {
    'import:pick': async (kind) => {
      if (kind !== 'document' && kind !== 'specification') {
        throw validation((m) => m.importing.unknownKind(String(JSON.stringify(kind))));
      }

      // Системний діалог — частина інтерфейсу, тож і він говорить мовою вікна.
      const m = uiMessages(db);
      const options: Electron.OpenDialogOptions = {
        title:
          kind === 'document' ? m.importing.dialogTitleDocuments : m.importing.dialogTitleSpecification,
        buttonLabel: m.importing.dialogButton,
        properties: ['openFile', 'multiSelections', 'dontAddToRecent'],
        filters: fileFilters(m),
      };

      const window = ctx.getWindow();
      const result = window
        ? await dialog.showOpenDialog(window, options)
        : await dialog.showOpenDialog(options);

      return result.canceled ? [] : result.filePaths;
    },

    'import:run': async (request) => {
      const paths = request?.paths ?? [];
      if (!Array.isArray(paths) || paths.length === 0) {
        throw validation((m) => m.importing.noFiles);
      }
      const target = request?.target;
      if (!target || (target.kind !== 'document' && target.kind !== 'specification')) {
        throw validation((m) => m.importing.noTarget);
      }

      const result = await importFiles(db, { paths, target }, { stripBoilerplate: true });

      if (result.imported.length > 0) {
        events.emit('library:changed', {
          kind: target.kind === 'document' ? 'documents' : 'specifications',
        });
      }
      if (result.failed.length > 0) {
        events.toast(
          'warn',
          uiMessages(db).importing.failedToast(result.failed.length, paths.length),
        );
      }

      return result;
    },

    'extraction:get': (extractionId) => db.extractions.get(requireId(extractionId, 'extractionId')),

    'blob:path': (blobHash) => {
      const absolute = safeBlobPath(blobHash);
      // Рядок у БД є, а файлу немає — сховище чистили руками. Для UI це «немає файлу».
      return existsSync(absolute) ? absolute : null;
    },

    'blob:read': (blobHash) => {
      const absolute = safeBlobPath(blobHash);
      if (!existsSync(absolute)) throw notFound('blobFile', blobHash);
      return readFileSync(absolute);
    },
  };

  /**
   * Абсолютний шлях до блоба з повним набором перевірок.
   *
   * Спільний для `blob:path` і `blob:read`: обидва отримують хеш із renderer,
   * тож обидва мусять пройти ті самі три бар'єри — формат, наявність у БД,
   * межі теки сховища.
   */
  function safeBlobPath(blobHash: unknown): string {
    const hash = typeof blobHash === 'string' ? blobHash.trim().toLowerCase() : '';
    if (!HASH_RE.test(hash)) {
      throw validation((m) => m.importing.invalidBlobHash);
    }

    // Хеш має бути відомий БАЗІ — інакше це спроба намацати чужий файл.
    const blob = db.blobs.get(hash);
    if (!blob) throw notFound('blob', hash);

    // Шлях складаємо з хеша й розширення, а не з relPath: навіть якщо в БД
    // колись опиниться зіпсований relPath, вийти за межі blobs/ не вийде.
    const absolute = resolvePath(blobPath(hash, extname(blob.relPath)));
    const root = resolvePath(blobsDir());
    if (!absolute.startsWith(root + sep)) {
      throw internal((m) => m.importing.blobOutsideStorage, { hash });
    }
    return absolute;
  }
}
