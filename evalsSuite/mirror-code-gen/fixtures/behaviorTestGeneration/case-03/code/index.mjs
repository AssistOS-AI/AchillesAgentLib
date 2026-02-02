export async function action({ promptText }) {
  if (typeof promptText !== 'string') {
    throw new Error('promptText must be a string');
  }
  const normalized = promptText.trim().toLowerCase();
  if (normalized === 'on') return true;
  if (normalized === 'off') return false;
  throw new Error('Invalid toggle command');
}
