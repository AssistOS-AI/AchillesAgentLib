export async function action({ promptText }) {
  if (!promptText) {
    return 0;
  }
  const parts = String(promptText).split(',');
  return parts.reduce((total, value) => total + Number(value), 0);
}
