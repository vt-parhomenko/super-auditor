import { en, type Messages } from './en';
import type { Locale } from './locale';
import { nl } from './nl';
import { uk } from './uk';

/** `Record<Locale, …>` — нова мова в `LANGUAGES` без каталогу не пройде перевірку типом. */
export const CATALOGS: Record<Locale, Messages> = { en, nl, uk };
