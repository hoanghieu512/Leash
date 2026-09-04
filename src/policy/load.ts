import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { policySchema, toPolicy, type Policy } from "./schema.js";

export class PolicyError extends Error {
  override readonly name = "PolicyError";
}

/**
 * Pure: YAML text in, validated Policy out. Throws PolicyError naming the
 * offending key — callers surface that text to the agent, so it has to read
 * like a sentence, not like a stack trace.
 */
export function parsePolicy(yamlText: string): Policy {
  let doc: unknown;
  try {
    doc = parseYaml(yamlText);
  } catch (err) {
    throw new PolicyError(`leash.policy.yaml không phải YAML hợp lệ: ${(err as Error).message}`);
  }

  const result = policySchema.safeParse(doc);
  if (!result.success) {
    const lines = result.error.issues.map((i) => {
      const path = i.path.join(".");
      return path ? `  ${path}: ${i.message}` : `  ${i.message}`;
    });
    throw new PolicyError(`leash.policy.yaml không hợp lệ:\n${lines.join("\n")}`);
  }

  return toPolicy(result.data);
}

/** Thin I/O wrapper. A missing file is an error, never an empty policy. */
export function loadPolicy(path: string): Policy {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new PolicyError(
      `Không đọc được ${path}. Leash chặn mọi lệnh khi thiếu file luật — chạy 'leash init' để tạo file mẫu.`,
    );
  }
  return parsePolicy(text);
}
