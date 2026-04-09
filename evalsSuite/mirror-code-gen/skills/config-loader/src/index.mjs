class ConfigLoader {
  constructor() {}

  load(source, schema) {
    const config = {};
    const errors = [];

    for (const key of Object.keys(schema)) {
      const type = schema[key];
      const rawValue = source[key];

      if (rawValue === undefined || rawValue === null || rawValue === '') {
        errors.push({ key, message: `Missing required configuration value` });
        continue;
      }

      try {
        switch (type) {
          case 'string':
            config[key] = String(rawValue);
            break;
          case 'number': {
            const num = Number(rawValue);
            if (isNaN(num)) {
              errors.push({ key, message: `Invalid number value` });
            } else {
              config[key] = num;
            }
            break;
          }
          case 'boolean':
            config[key] = rawValue === 'true' || rawValue === true;
            break;
          case 'json': {
            try {
              config[key] = JSON.parse(rawValue);
            } catch (err) {
              errors.push({ key, message: `Invalid JSON value` });
            }
            break;
          }
          default:
            errors.push({ key, message: `Unsupported type: ${type}` });
        }
      } catch (err) {
        errors.push({ key, message: `Conversion error: ${err.message}` });
      }
    }

    return {
      success: errors.length === 0,
      config,
      errors
    };
  }
}

function parsePromptText(promptText) {
  const operationMatch = promptText.match(/^operation\s*:\s*(.+)$/mi);
  const sourceMatch = promptText.match(/^source\s*:\s*(.+)$/mi);
  const schemaMatch = promptText.match(/^schema\s*:\s*(.+)$/mi);

  if (!operationMatch) throw new Error("Missing required parameter: operation");
  if (!sourceMatch) throw new Error("Missing required parameter: source");
  if (!schemaMatch) throw new Error("Missing required parameter: schema");

  const operation = operationMatch[1].trim();
  const source = JSON.parse(sourceMatch[1].trim());
  const schema = JSON.parse(schemaMatch[1].trim());

  return { operation, source, schema };
}

export async function action(args) {
  const { promptText } = args;
  const { operation, source, schema } = parsePromptText(promptText);

  const loader = new ConfigLoader();

  if (operation === 'load') {
    return loader.load(source, schema);
  } else {
    throw new Error(`Unsupported operation: ${operation}`);
  }
}