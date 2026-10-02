/**
 * Мінімальний розбір Server-Sent Events (WHATWG «event stream interpretation»).
 *
 * Свій, а не бібліотека: потрібна лише частина специфікації, а нова залежність
 * у main-процесі — дорожча за 60 рядків. Що враховано:
 *  - рядки-коментарі `: OPENROUTER PROCESSING` (keep-alive) ігноруються —
 *    передати їх у `JSON.parse` означало б упасти посеред відповіді;
 *  - кінці рядків `\n`, `\r\n` і `\r`, у тому числі розірвані між чанками;
 *  - кілька `data:` в одній події склеюються через `\n`;
 *  - подія завершується порожнім рядком; хвіст без нього віддає `flush()`.
 */

export class SseParser {
  private buffer = '';
  private data: string[] = [];
  /** Попередній чанк закінчився на `\r` — наступний `\n` належить тому ж кінцю рядка. */
  private pendingCr = false;

  /** Додає шматок тексту; повертає payload-и подій, що завершились. */
  feed(chunk: string): string[] {
    let text = chunk;
    if (this.pendingCr && text.startsWith('\n')) text = text.slice(1);
    this.pendingCr = false;
    this.buffer += text;

    const events: string[] = [];
    for (;;) {
      const match = /\r\n|\r|\n/.exec(this.buffer);
      if (!match) break;
      // `\r` в самому кінці буфера може бути половиною `\r\n` — дочекаємось.
      if (match[0] === '\r' && match.index === this.buffer.length - 1) {
        this.pendingCr = true;
        const line = this.buffer.slice(0, match.index);
        this.buffer = '';
        this.processLine(line, events);
        break;
      }
      const line = this.buffer.slice(0, match.index);
      this.buffer = this.buffer.slice(match.index + match[0].length);
      this.processLine(line, events);
    }
    return events;
  }

  /** Кінець потоку: віддає подію, якій бракувало завершального порожнього рядка. */
  flush(): string[] {
    const events: string[] = [];
    if (this.buffer.length > 0) {
      this.processLine(this.buffer, events);
      this.buffer = '';
    }
    this.dispatch(events);
    return events;
  }

  private processLine(line: string, events: string[]): void {
    if (line.length === 0) {
      this.dispatch(events);
      return;
    }
    if (line.startsWith(':')) return; // коментар / keep-alive

    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);

    // event:, id:, retry: нам не потрібні — OpenRouter шле все в data.
    if (field === 'data') this.data.push(value);
  }

  private dispatch(events: string[]): void {
    if (this.data.length === 0) return;
    events.push(this.data.join('\n'));
    this.data = [];
  }
}
