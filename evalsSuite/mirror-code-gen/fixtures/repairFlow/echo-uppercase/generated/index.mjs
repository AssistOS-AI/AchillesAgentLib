export async function action({ promptText }) {
  if (typeof promptText !== 'string') {
    return '';
  }
  return `${promptText}`;
}
