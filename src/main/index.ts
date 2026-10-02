import { app, BrowserWindow, shell } from 'electron';
import { join } from 'node:path';
import { createDb, type Db } from './db';
import { DEFAULT_LANGUAGE, mainMessages, uiLanguageOf } from './i18n';
import { installIpc, type InstalledIpc } from './ipc';
import { setOrchestrator } from './ipc/orchestratorPort';
import { dbPath, ensureStorageDirs, storageRoot } from './paths';
import { createOrchestrator } from './pipeline/orchestrator';

let mainWindow: BrowserWindow | null = null;
let db: Db | null = null;
let ipc: InstalledIpc | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#12131a',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.on('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Зовнішні посилання — у системному браузері, не у вікні застосунку.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) {
    void mainWindow.loadURL(devUrl);
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  ensureStorageDirs();
  console.log('[super-auditor] сховище:', storageRoot());

  // Порядок важливий: теки → база (міграції) → хендлери → вікно.
  // Renderer починає смикати IPC одразу після завантаження, тож канали
  // мають бути зареєстровані ДО створення вікна.
  db = createDb(dbPath());
  console.log('[super-auditor] схема БД:', db.schemaVersion());

  ipc = installIpc({ db, getWindow: () => mainWindow });

  // Оркестратор підключається після IPC: він користується тим самим реєстром
  // провайдерів і тим самим емітером подій, що й хендлери.
  setOrchestrator(
    createOrchestrator({
      db,
      providers: ipc.context.providers,
      events: ipc.events,
    }),
  );



  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// WAL зливаємо в основний файл до виходу — інакше бекап візьме неповну базу.
app.on('will-quit', () => {
  setOrchestrator(null);
  ipc?.dispose();
  ipc = null;
  try {
    db?.checkpoint();
  } catch (err) {
    console.error('[super-auditor] checkpoint не вдався:', err);
  }
  db?.close();
  db = null;
});

/**
 * Необроблена відмова в main убила б процес мовчки (Electron не показує
 * нічого). Логуємо і, поки вікно живе, повідомляємо користувача тостом.
 */
process.on('unhandledRejection', (reason) => {
  console.error('[super-auditor] необроблена відмова:', reason);
  const message = reason instanceof Error ? reason.message : String(reason);
  ipc?.events.toast('error', internalErrorText(message));
});

process.on('uncaughtException', (error) => {
  console.error('[super-auditor] неперехоплена помилка:', error);
  ipc?.events.toast('error', internalErrorText(error.message));
});

/** Тост мовою інтерфейсу; база вже може бути закрита (вихід) — тоді англійською. */
function internalErrorText(message: string): string {
  const language = db ? uiLanguageOf(db) : DEFAULT_LANGUAGE;
  return mainMessages(language).app.internalError(message);
}
