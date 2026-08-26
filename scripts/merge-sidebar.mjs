import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const configPath = resolve(__dirname, '..', '.vitepress', 'config.mts');
const generatedPath = resolve(__dirname, '..', '.vitepress', 'sidebar.generated.ts');

const config = readFileSync(configPath, 'utf-8');
const generated = readFileSync(generatedPath, 'utf-8');

// 找到 sidebar: { 开始位置
const sidebarStart = config.indexOf('    sidebar: {');
if (sidebarStart === -1) {
  console.error('Cannot find sidebar: { in config.mts');
  process.exit(1);
}

// 找到 sidebar 对象的结束位置（socialLinks 之前）
const socialLinksPos = config.indexOf('\n    socialLinks:', sidebarStart);
if (socialLinksPos === -1) {
  console.error('Cannot find socialLinks after sidebar');
  process.exit(1);
}

// 从 generated 文件中提取 sidebar 对象内容
const generatedContent = generated
  .replace(/\/\/ 此文件由.*\n\n/, '')
  .replace('export const sidebar = ', '')
  .trim();
const sidebarObj = generatedContent.endsWith(';')
  ? generatedContent.slice(0, -1)
  : generatedContent;

// 确保 config.mts 有 import
let newConfig = config;
if (!config.includes("import { sidebar as generatedSidebar }")) {
  newConfig = newConfig.replace(
    "import { withOpenInEditor } from 'vitepress-plugin-open-in-editor'",
    "import { withOpenInEditor } from 'vitepress-plugin-open-in-editor'\nimport { sidebar as generatedSidebar } from './sidebar.generated'"
  );
}

// 重新读取（可能刚加了 import）
const before = newConfig.substring(0, sidebarStart);
const after = newConfig.substring(socialLinksPos);

const newSidebar = `    sidebar: {
      ...generatedSidebar,
    },`;

newConfig = before + newSidebar + '\n' + after;
writeFileSync(configPath, newConfig, 'utf-8');
console.log('config.mts updated');
