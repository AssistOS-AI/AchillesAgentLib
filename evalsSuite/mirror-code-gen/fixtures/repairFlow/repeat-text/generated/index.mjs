export async function action({ promptText }) {
  const [text, countRaw] = String(promptText).split('|');
  const count = Number(countRaw || 0);
  return `${text}${count}`;
}
