import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from '@renderer/App';
import { IS_MOCK, installApi } from '@renderer/lib/api';
import { applyLocale, applyTheme, useUiStore } from '@renderer/store/ui';
import '@renderer/styles/global.css';
import '@renderer/styles/app.css';

applyTheme(useUiStore.getState().theme);
applyLocale(useUiStore.getState().locale);

const container = document.getElementById('root');
if (!container) throw new Error('Не знайдено #root у index.html');

const root = createRoot(container);

/**
 * У mock-режимі підміна API має статись ДО першого рендера, інакше перші запити
 * підуть у неготовий window.api і осядуть у кеші як помилки.
 */
async function bootstrap(): Promise<void> {
  if (IS_MOCK) {
    const { createMockApi } = await import('@renderer/mocks');
    installApi(createMockApi());
  }
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void bootstrap();
