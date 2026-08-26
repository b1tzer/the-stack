import { readFileSync, readdirSync, writeFileSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// 英文分组名 → 中文
const GROUP_NAMES = {
  'basics': '基础入门',
  'producer': '生产者',
  'consumer': '消费者',
  'storage-internals': '存储原理',
  'reliability': '可靠性',
  'streams': '流处理',
  'connect': 'Connect',
  'operations': '运维管理',
  'innodb-internals': 'InnoDB 内核',
  'index': '索引',
  'transaction-lock': '事务与锁',
  'query-optimization': '查询优化',
  'advanced-features': '高级特性',
  'replication-ha': '复制与高可用',
  'scaling': '扩展架构',
  'indexing': '索引与映射',
  'search': '搜索',
  'aggregation': '聚合',
  'distributed-internals': '分布式原理',
  'data-modeling': '数据建模',
  'performance': '性能优化',
  'ecosystem': '生态工具',
  'principles': '设计原则',
  'design-patterns': '设计模式',
  'architecture': '架构设计',
  'ddd': 'DDD',
  'system-design': '系统设计',
  'engineering-practices': '工程实践',
  'security': '安全',
  'project-management': '项目管理',
  'practice': '实战场景',
  'java-language': 'Java 语言',
  'jvm-runtime': 'JVM Runtime',
  'java-concurrency': 'Java 并发',
  'java-network': '网络与通信',
  'java-data-access': '数据访问与持久化',
  'java-enterprise': '企业架构',
  'performance-architecture': '性能与架构',
  'data-model': '数据模型',
  'standalone-core': '单机核心',
  'cache-engineering': '缓存工程',
  'high-availability': '高可用',
  'intro': '入门',
  'ai-engineering': 'AI 工程',
};

const SKIP_SECTIONS = [];

function parseIndexMd(filePath, sectionName) {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const groups = [];
  let currentGroup = null;
  let inFrontmatter = false;

  for (const line of lines) {
    if (line.trim() === '---') {
      inFrontmatter = !inFrontmatter;
      continue;
    }
    if (inFrontmatter) continue;

    const headerMatch = line.match(/^###\s+(\d+)-(.+)/);
    if (headerMatch) {
      const rawName = headerMatch[2].trim();
      // 如果含中文，取中文部分；否则查映射表
      const chinesePart = rawName.match(/[\u4e00-\u9fff].*/);
      const groupName = chinesePart ? chinesePart[0] : (GROUP_NAMES[rawName] || rawName);
      currentGroup = { text: groupName, items: [] };
      groups.push(currentGroup);
      continue;
    }

    const linkMatch = line.match(/^-\s+\[([^\]]+)\]\(([^)]+)\)/);
    if (linkMatch && currentGroup) {
      const text = linkMatch[1].trim();
      const relativePath = linkMatch[2].trim();
      const link = '/' + sectionName + '/' + relativePath;
      currentGroup.items.push({ text, link });
    }
  }
  return groups;
}

function main() {
  const docsDir = resolve(__dirname, '..', 'docs');
  const sections = readdirSync(docsDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('_') && !d.name.startsWith('.'))
    .map(d => d.name)
    .sort();

  const sidebar = {};

  for (const section of sections) {
    if (SKIP_SECTIONS.includes(section)) continue;
    const indexFile = join(docsDir, section, 'index.md');
    if (!existsSync(indexFile)) continue;

    const groups = parseIndexMd(indexFile, section);
    if (groups.length === 0) continue;
    sidebar['/' + section + '/'] = groups;
  }

  const output = formatOutput(sidebar);

  if (process.argv.includes('--write')) {
    const outPath = resolve(__dirname, '..', '.vitepress', 'sidebar.generated.ts');
    writeFileSync(outPath, output, 'utf-8');
    console.log('Written to ' + outPath);
  } else {
    console.log(output);
  }
}

function formatOutput(sidebar) {
  let out = '// 此文件由 scripts/generate-sidebar.mjs 自动生成，请勿手动编辑\n\n';
  out += 'export const sidebar = {\n';

  for (const [route, groups] of Object.entries(sidebar)) {
    out += "  '" + route + "': [\n";
    for (const group of groups) {
      out += '    {\n';
      out += "      text: '" + group.text + "',\n";
      out += '      items: [\n';
      for (const item of group.items) {
        out += "        { text: '" + item.text + "', link: '" + item.link + "' },\n";
      }
      out += '      ],\n';
      out += '    },\n';
    }
    out += '  ],\n';
  }
  out += '};\n';
  return out;
}

main();
