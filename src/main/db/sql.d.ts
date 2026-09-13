/**
 * `.sql`-файли підключаються як рядки через vite-суфікс `?raw`.
 * Так DDL лишається в окремому файлі (підсвітка, дифи), але потрапляє
 * в бандл main-процесу — після `electron-vite build` читати його з диска нічим.
 */
declare module '*.sql?raw' {
  const content: string;
  export default content;
}
