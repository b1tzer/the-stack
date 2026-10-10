import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, extname, join, relative, resolve } from 'node:path'

const DOCS_DIR = resolve('docs')
const CONFIG_PATH = resolve('.vitepress/config.mts')
const REVIEW_STATUS_PATH = resolve('.vitepress/review-status.json')
const SIDEBAR_EXCLUSIONS = new Set([
  join(DOCS_DIR, 'index.md'),
  join(DOCS_DIR, '_snippets', 'depth-audit-2026-08-31.md'),
  join(DOCS_DIR, 'kafka', 'RESTRUCTURE-PLAN.md'),
])

const errors = []

function walk(directory) {
  const entries = readdirSync(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...walk(path))
    else if (entry.isFile() && path.endsWith('.md')) files.push(path)
  }
  return files
}

function stripCodeAndFrontmatter(source) {
  const body = source.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '')
  const lines = []
  let fenced = false

  for (const line of body.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced
      lines.push('')
      continue
    }
    lines.push(fenced ? '' : line)
  }

  return lines.join('\n')
}

function resolveTarget(sourcePath, target) {
  const cleanTarget = decodeURI(target.split(/[?#]/, 1)[0])
  if (!cleanTarget) return null

  const isRootPath = cleanTarget.startsWith('/')
  const base = isRootPath ? join(DOCS_DIR, cleanTarget) : resolve(dirname(sourcePath), cleanTarget)
  const candidates = []

  if (extname(cleanTarget) === '.md') candidates.push(base)
  else if (cleanTarget.endsWith('/')) candidates.push(join(base, 'index.md'))
  else candidates.push(base, `${base}.md`, join(base, 'index.md'))

  if (isRootPath) candidates.unshift(join(DOCS_DIR, 'public', cleanTarget))

  return candidates.find(candidate => existsSync(candidate) && statSync(candidate).isFile()) ?? candidates[0]
}

function report(file, message) {
  errors.push(`${relative(process.cwd(), file)}: ${message}`)
}

const markdownFiles = walk(DOCS_DIR).sort()
const markdownSet = new Set(markdownFiles)

// 记录每篇文档被多少其他页面引用，用于零入链软告警
const inboundLinks = new Map(markdownFiles.map(file => [file, 0]))

for (const file of markdownFiles) {
  const source = readFileSync(file, 'utf8')
  const content = stripCodeAndFrontmatter(source)

  // 代码围栏：开栏必须标注语言，且必须闭合
  let fence = null
  source.split(/\r?\n/).forEach((line, index) => {
    const match = line.match(/^\s*(`{3,}|~{3,})(.*)$/)
    if (!match) return
    const [, run, info] = match
    if (fence === null) {
      if (!info.trim()) report(file, `第 ${index + 1} 行代码块缺少语言标注`)
      fence = { char: run[0], length: run.length }
    } else if (run[0] === fence.char && run.length >= fence.length && !info.trim()) {
      fence = null
    }
  })
  if (fence) report(file, '代码围栏未闭合')

  const headings = [...content.matchAll(/^(#{1,6})\s+.+$/gm)]
  const h1Count = headings.filter(match => match[1] === '#').length

  if (file !== join(DOCS_DIR, 'index.md') && h1Count !== 1) {
    report(file, `应有且仅有一个 H1，当前为 ${h1Count}`)
  }

  if (headings.length > 0) {
    let previousLevel = headings[0][1].length
    if (previousLevel !== 1) report(file, '首个标题必须是 H1')

    for (const heading of headings.slice(1)) {
      const level = heading[1].length
      if (level > previousLevel + 1) {
        report(file, `标题层级从 H${previousLevel} 跳到 H${level}`)
      }
      previousLevel = level
    }
  }

  const aliases = new Map()
  for (const match of content.matchAll(/^#{1,6}\s+.+\s+\{#([a-z0-9-]+)\}\s*$/gm)) {
    const alias = match[1]
    if (aliases.has(alias)) report(file, `锚点别名 ${alias} 在同一文档内重复`)
    aliases.set(alias, true)
  }

  for (const match of content.matchAll(/!\[([^\]]*)\]\([^)]+\)/g)) {
    if (!match[1].trim()) report(file, '图片缺少替代文本')
  }

  for (const match of content.matchAll(/(?<!!)\[[^\]\n]*\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g)) {
    const target = match[1]
    if (/^(?:https?:|mailto:|tel:|\/\/|#)/i.test(target)) continue
    const resolved = resolveTarget(file, target)
    if (!existsSync(resolved) || !statSync(resolved).isFile()) report(file, `内部链接目标不存在：${target}`)
    else if (markdownSet.has(resolved) && resolved !== file) inboundLinks.set(resolved, inboundLinks.get(resolved) + 1)
  }
}

// 零入链软告警：正文页若没有被任何其他页面引用，读者只能靠侧边栏和搜索碰到它。
// 只报告，不阻塞构建；导览页、纯中转说明页和被排除的草稿页不计入。
function isInboundExempt(file) {
  if (SIDEBAR_EXCLUSIONS.has(file)) return true
  if (basename(file) === 'index.md') return true

  const body = stripCodeAndFrontmatter(readFileSync(file, 'utf8')).trim()
  return /^#\s[^\n]+\n+\n+>/.test(body) && !/^##\s/m.test(body)
}

const orphanPages = markdownFiles.filter(file => inboundLinks.get(file) === 0 && !isInboundExempt(file))
const orphansByDomain = new Map()

for (const file of orphanPages) {
  const domain = relative(DOCS_DIR, file).split('/')[0] ?? '(root)'
  orphansByDomain.set(domain, (orphansByDomain.get(domain) ?? 0) + 1)
}

if (orphanPages.length > 0) {
  const breakdown = [...orphansByDomain]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([domain, count]) => `${domain} ${count}`)
    .join('、')
  console.warn(`⚠ ${orphanPages.length} 个正文页暂无其他页面引用（软告警，不阻塞）：${breakdown}`)
  if (process.argv.includes('--verbose')) {
    for (const file of orphanPages) console.warn(`  - ${relative(process.cwd(), file)}`)
  } else {
    console.warn('  运行 `node check-docs.mjs --verbose` 查看完整列表。')
  }
}

const config = readFileSync(CONFIG_PATH, 'utf8')
const configRoutes = new Set()

for (const match of config.matchAll(/link:\s*['"]([^'"]+)['"]/g)) {
  const target = match[1]
  if (/^https?:\/\//i.test(target)) continue
  const cleanTarget = target.split('#', 1)[0]
  if (!cleanTarget) continue

  const resolved = resolveTarget(join(DOCS_DIR, 'index.md'), cleanTarget)
  if (!existsSync(resolved) || !statSync(resolved).isFile()) {
    errors.push(`${relative(process.cwd(), CONFIG_PATH)}: 导航目标不存在：${target}`)
    continue
  }

  if (markdownSet.has(resolved)) configRoutes.add(resolved)
}

for (const file of markdownFiles) {
  if (SIDEBAR_EXCLUSIONS.has(file)) continue
  if (!configRoutes.has(file)) report(file, '未出现在站点导航或侧边栏中')
}

const reviewStatus = JSON.parse(readFileSync(REVIEW_STATUS_PATH, 'utf8'))
const reviewDomains = reviewStatus.domains ?? {}
const contentDomains = readdirSync(DOCS_DIR, { withFileTypes: true })
  .filter(entry => entry.isDirectory() && !entry.name.startsWith('_') && !['assets', 'public'].includes(entry.name))
  .map(entry => entry.name)
  .sort()

for (const domain of contentDomains) {
  if (!reviewDomains[domain]) errors.push(`${relative(process.cwd(), REVIEW_STATUS_PATH)}: 缺少专题复查记录：${domain}`)
}

for (const [domain, record] of Object.entries(reviewDomains)) {
  if (!contentDomains.includes(domain)) {
    errors.push(`${relative(process.cwd(), REVIEW_STATUS_PATH)}: 不存在的专题：${domain}`)
    continue
  }
  if (!record.versionScope) errors.push(`${relative(process.cwd(), REVIEW_STATUS_PATH)}: ${domain} 缺少适用版本`)
  if (!['pending', 'verified'].includes(record.status)) {
    errors.push(`${relative(process.cwd(), REVIEW_STATUS_PATH)}: ${domain} 的状态无效：${record.status}`)
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(record.nextReview ?? '')) {
    errors.push(`${relative(process.cwd(), REVIEW_STATUS_PATH)}: ${domain} 缺少有效的下次复查日期`)
  }
  if (record.status === 'verified' && !/^\d{4}-\d{2}-\d{2}$/.test(record.lastVerified ?? '')) {
    errors.push(`${relative(process.cwd(), REVIEW_STATUS_PATH)}: ${domain} 已标记核验但缺少验证日期`)
  }
}

// 复查轮换：同一天到期的专题过多会造成复查积压
const reviewsByDate = new Map()
for (const [domain, record] of Object.entries(reviewDomains)) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(record.nextReview ?? '')) continue
  const domains = reviewsByDate.get(record.nextReview) ?? []
  domains.push(domain)
  reviewsByDate.set(record.nextReview, domains)
}
for (const [date, domains] of [...reviewsByDate].sort()) {
  if (domains.length > 3) {
    console.warn(`⚠ ${date} 有 ${domains.length} 个专题同时到期（${domains.join('、')}），建议按 cadenceDays 错开。`)
  }
}

if (errors.length > 0) {
  console.error(`文档检查失败，共发现 ${errors.length} 个问题：`)
  for (const error of errors) console.error(`- ${error}`)
  process.exit(1)
}

const pendingReviews = Object.values(reviewDomains).filter(record => record.status === 'pending').length
console.log(
  `Checked ${markdownFiles.length} Markdown files: headings, links, images, aliases, navigation, and ${pendingReviews} pending review records passed; ${orphanPages.length} pages await inbound links.`
)
