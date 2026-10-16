// Prints just the part of the page marked with the "print-area" class (see index.css).
// If nothing is marked, the normal browser print is used.
export function printArea() {
  const root = document.documentElement;
  if (!document.querySelector('.print-area')) return window.print();
  const done = () => { root.classList.remove('printing'); window.removeEventListener('afterprint', done); };
  root.classList.add('printing');
  window.addEventListener('afterprint', done);
  window.print();
  // Some browsers do not fire afterprint reliably: make sure the class never gets stuck
  setTimeout(() => root.classList.remove('printing'), 60000);
  return undefined;
}
