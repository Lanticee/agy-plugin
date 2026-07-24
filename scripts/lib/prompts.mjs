import fs from "node:fs";
import path from "node:path";

export function loadTemplate(pluginRoot, name) {
  return fs.readFileSync(path.join(pluginRoot, "prompts", `${name}.md`), "utf8");
}

export function interpolate(template, vars) {
  let output = template;
  for (const [key, value] of Object.entries(vars)) {
    output = output.split(`{{${key}}}`).join(String(value ?? ""));
  }
  return output;
}
