const BOOLEAN_FLAGS = new Set(["background", "wait", "all", "json", "resume"]);
const VALUE_FLAGS = new Set(["base", "scope", "model", "timeout", "conversation"]);

export function splitRawArgumentString(raw) {
  const tokens = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match;
  while ((match = pattern.exec(raw ?? "")) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3]);
  }
  return tokens;
}

export function parseArgs(argv) {
  const flags = {};
  const text = [];
  const rest = [...(argv ?? [])];

  while (rest.length > 0) {
    const token = rest.shift();
    if (token.startsWith("--")) {
      const name = token.slice(2);
      if (BOOLEAN_FLAGS.has(name)) {
        flags[name] = true;
        continue;
      }
      if (VALUE_FLAGS.has(name)) {
        if (rest.length === 0) {
          throw new Error(`Missing value for --${name}`);
        }
        flags[name] = rest.shift();
        continue;
      }
    }
    text.push(token);
  }

  return { flags, text: text.join(" ").trim() };
}
