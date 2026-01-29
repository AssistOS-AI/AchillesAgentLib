import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

export async function action(args) {
  const input = args?.promptText || "";
  const match = input.match(/([A-Z][a-z]+)\s+([A-Z][a-z]+).*?(\d+)/);
  if (!match) { return "Error: Incomplete user data provided."; }
  const fullName = `${match[1]} ${match[2]}`;
  const age = Number(match[3]);
  const status = age >= 18 ? 'Adult' : 'Minor';
  const result = `Full Name: ${fullName}, Age: ${age} (${status})`;
  return result;
}

// Child process entry point
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argsJson = process.argv[2];
  const args = JSON.parse(argsJson);
  action(args)
    .then(res => process.stdout.write(JSON.stringify(res)))
    .catch(err => {
      console.error("Error in generated code:", err);
      process.exit(1);
    });
}