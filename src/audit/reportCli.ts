#!/usr/bin/env node
import { join } from "node:path";
import { formatReport, readAudit, summarise } from "./report.js";

const root = process.env["LEASH_HOME"] ?? process.cwd();
const { entries, malformed } = readAudit(join(root, "audit.jsonl"));
process.stdout.write(`${formatReport(summarise(entries, malformed))}\n`);
