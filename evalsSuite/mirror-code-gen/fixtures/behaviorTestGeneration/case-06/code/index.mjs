export async function action({ promptText }) {
  if (typeof promptText !== 'string') {
    throw new Error('promptText must be a string');
  }
  let data;
  try {
    data = JSON.parse(promptText);
  } catch (error) {
    throw new Error('Invalid JSON input');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Expected JSON object');
  }
  if (!Object.prototype.hasOwnProperty.call(data, 'value')) {
    throw new Error('Missing key: value');
  }
  return data.value;
}
