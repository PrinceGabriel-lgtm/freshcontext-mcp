const fs = require('fs');
let content = fs.readFileSync('./worker/src/worker.ts', 'utf8');

// Tools that need withCache wrapping (github already done)
// For each: find the async handler start and add withCache open
// Then find the corresponding catch line and add the closing

const tools = [
  { name: 'extract_hackernews',  adapter: 'hackernews',    input: 'url' },
  { name: 'extract_scholar',     adapter: 'scholar',       input: 'url' },
  { name: 'extract_yc',          adapter: 'yc',            input: 'url' },
  { name: 'search_repos',        adapter: 'reposearch',    input: 'query' },
  { name: 'package_trends',      adapter: 'packagetrends', input: 'packages' },
  { name: 'extract_reddit',      adapter: 'reddit',        input: 'url' },
  { name: 'extract_producthunt', adapter: 'producthunt',   input: 'url' },
  { name: 'extract_finance',     adapter: 'finance',       input: 'url' },
  { name: 'search_jobs',         adapter: 'jobs',          input: 'query' },
  { name: 'extract_landscape',   adapter: 'landscape',     input: 'topic' },
];

// We'll work line-by-line for precision
const lines = content.split('\n');
const result = [];
let i = 0;

while (i < lines.length) {
  const line = lines[i];

  // Check if this line closes a tool handler that needs wrapping
  // Pattern: "    } catch (err: any) { return ..." followed by "  });"
  // We add "    }); // end withCache" before the closing  });
  if (
    line.match(/^\s+\} catch \(err: any\) \{ return \{ content/) &&
    lines[i + 1] && lines[i + 1].trim() === '});' &&
    !(lines[i + 1].includes('end withCache'))
  ) {
    result.push(line);
    result.push('    }); // end withCache');
    i++;
    continue;
  }

  result.push(line);
  i++;
}

content = result.join('\n');

// Now add the withCache OPEN for each tool
// Pattern to find: the }, async ({ INPUT }) => {\n    try {
// for each tool, but only if not already wrapped

for (const tool of tools) {
  // Build a specific marker string that is unique per tool
  // Look for the line: "  }, async ({ url/query/etc }) => {"
  // followed by next non-empty content being "    try {"
  // We replace "    try {" with "    return withCache(...); try {"
  
  // Find the tool's registerTool call, then find the first "try {" after it
  const toolMarker = `server.registerTool("${tool.name}"`;
  const idx = content.indexOf(toolMarker);
  if (idx === -1) { console.log('Tool not found: ' + tool.name); continue; }

  // From that position, find the first "    try {" that is NOT already preceded by withCache
  const afterTool = content.slice(idx);
  const tryIdx = afterTool.indexOf('\n    try {');
  if (tryIdx === -1) { console.log('No try block for: ' + tool.name); continue; }

  // Check if withCache is already there (look 200 chars before the try)
  const beforeTry = afterTool.slice(Math.max(0, tryIdx - 200), tryIdx);
  if (beforeTry.includes('withCache')) {
    console.log('Already wrapped: ' + tool.name);
    continue;
  }

  // Insert the withCache line before "    try {"
  const absoluteIdx = idx + tryIdx;
  content = content.slice(0, absoluteIdx) +
    `\n    return withCache("${tool.adapter}", ${tool.input}, env.CACHE, async () => {` +
    content.slice(absoluteIdx);

  console.log('Wrapped: ' + tool.name);
}

fs.writeFileSync('./worker/src/worker.ts', content, 'utf8');
console.log('\nAll done. Lines: ' + content.split('\n').length);
