export async function action({ promptText }) {
  const [leftRaw] = String(promptText).split('||');
  const left = JSON.parse(leftRaw || '{}');
  return left;
}
