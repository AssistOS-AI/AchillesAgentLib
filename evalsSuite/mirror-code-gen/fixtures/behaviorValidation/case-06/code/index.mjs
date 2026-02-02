export async function action({ promptText }) {
  if (typeof promptText !== 'string') {
    throw new Error('promptText must be a string');
  }
  let data;
  try {
    data = JSON.parse(promptText);
  } catch (error) {
    throw new Error('Invalid JSON');
  }
  if (!Array.isArray(data)) {
    throw new Error('Expected array');
  }
  if (data.some(item => typeof item !== 'number')) {
    throw new Error('Expected numbers');
  }
  return data.reduce((sum, value) => sum + value, 0) + 1;
}
