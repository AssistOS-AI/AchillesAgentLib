export async function action({ promptText }) {
  if (typeof promptText !== 'string') {
    throw new Error('promptText must be a string');
  }
  return promptText;
}
