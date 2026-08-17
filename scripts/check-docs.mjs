import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const files = [];

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(absolute);
    else if (entry.isFile() && entry.name.endsWith('.md')) files.push(absolute);
  }
}

await walk(path.join(root, 'docs'));
files.push(path.join(root, 'AGENTS.md'), path.join(root, 'README.md'));

const failures = [];
const linkPattern = /\[[^\]]+\]\(([^)]+)\)/g;

for (const file of files) {
  const raw = await readFile(file, 'utf8');
  const markdown = raw.replace(/```[\s\S]*?```/g, '');
  for (const match of markdown.matchAll(linkPattern)) {
    const target = match[1].trim();
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    const relative = decodeURIComponent(target.split('#', 1)[0]);
    if (relative.length === 0) continue;
    const resolved = path.resolve(path.dirname(file), relative);
    if (!resolved.startsWith(`${root}${path.sep}`)) {
      failures.push(`${path.relative(root, file)} escapes root: ${target}`);
      continue;
    }
    let targetStat;
    try {
      targetStat = await stat(resolved);
    } catch {
      failures.push(`${path.relative(root, file)} broken link: ${target}`);
      continue;
    }
    if (!targetStat.isFile()) {
      failures.push(`${path.relative(root, file)} not a file: ${target}`);
    }
  }
}

if (failures.length > 0) {
  console.error(`docs:check failed (${failures.length} issues):`);
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}
console.log(`docs:check passed (${files.length} markdown files checked)`);
