export async function action({ promptText }) {
  if (typeof promptText !== 'string') {
    throw new Error('promptText must be a string');
  }
  const words = promptText.trim().length
    ? promptText.trim().split(/\s+/)
    : [];
  return { count: words.length };
}
