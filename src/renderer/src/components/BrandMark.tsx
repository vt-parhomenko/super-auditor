import { useId } from 'react';

interface BrandMarkProps {
  /** Сторона квадрата в CSS-пікселях. */
  size?: number;
  className?: string;
}

/**
 * Знак застосунку: та сама плитка «документ + печатка перевірки», що й іконка
 * у панелі задач (копія геометрії `resources/icon-24.svg`).
 *
 * viewBox відрізає однопіксельне поле майстра 24 px, тож при 22 CSS px і
 * масштабі 100 % кожна одиниця лягає рівно на піксель — знак лишається чітким.
 * Кольори фіксовані, а не з токенів теми: плитка має власний фон і однаково
 * читається на світлому й темному сайдбарі, як і іконка в системі.
 */
export function BrandMark({ size = 22, className }: BrandMarkProps) {
  // id градієнтів мають бути унікальними на сторінці: інакше url(#…) другого
  // екземпляра посилався б на градієнт першого. Символи, недопустимі в url(#…),
  // прибираємо про всяк випадок.
  const uid = useId().replace(/[^\w-]/g, '');
  const tileId = `${uid}-tile`;
  const sealId = `${uid}-seal`;

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="1 1 22 22"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={tileId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#5383f5" />
          <stop offset="1" stopColor="#2449b4" />
        </linearGradient>
        <linearGradient id={sealId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2fcf8e" />
          <stop offset="1" stopColor="#0c9360" />
        </linearGradient>
      </defs>

      <rect x="1" y="1" width="22" height="22" rx="5" fill={`url(#${tileId})`} />

      <path
        d="M4.5 3H12L15 6V17.5A1.5 1.5 0 0 1 13.5 19H4.5A1.5 1.5 0 0 1 3 17.5V4.5A1.5 1.5 0 0 1 4.5 3Z"
        fill="#ffffff"
      />
      <path d="M12 3V5A1 1 0 0 0 13 6H15Z" fill="#bcd0f7" />
      <rect x="5" y="6" width="5" height="2" rx="1" fill="#2f5fd0" />
      <rect x="5" y="10" width="6" height="2" rx="1" fill="#25b47a" />
      <rect x="5" y="14" width="4" height="1" fill="#b7c6e6" />

      <circle cx="15.5" cy="15.5" r="6" fill="#ffffff" />
      <circle cx="15.5" cy="15.5" r="4.5" fill={`url(#${sealId})`} />
      <path
        d="M13.2 15.6L14.9 17.3L18 14.1"
        fill="none"
        stroke="#ffffff"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
