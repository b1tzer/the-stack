<template>
  <div v-html="svg"></div>
</template>

<script setup>
import { onMounted, onUnmounted, ref, toRaw } from 'vue'
import { useData } from 'vitepress'

const props = defineProps({
  graph: {
    type: String,
    required: true,
  },
  id: {
    type: String,
    required: true,
  },
})

const svg = ref(null)
const { page } = useData()
const { frontmatter } = toRaw(page.value)
const mermaidPageTheme = frontmatter.mermaidTheme || ''

let mut = null
// 只有页面上真的出现 mermaid 图时，onMounted 才会走到这里；
// 动态 import 让 mermaid 成为独立异步 chunk，不再进入全站 modulepreload。
let mermaid = null

// 串行化渲染：mermaid.render 用固定 id 建临时节点，两次渲染交叠会撞 id
let rendering = false
let rerenderRequested = false
let lastDark = null

const isDark = () => document.documentElement.classList.contains('dark')

const renderChart = async () => {
  if (rendering) {
    rerenderRequested = true
    return
  }
  rendering = true
  try {
    if (!mermaid) return

    const config = { securityLevel: 'loose', startOnLoad: false }
    if (mermaidPageTheme) config.theme = mermaidPageTheme
    if (isDark()) config.theme = 'dark'

    mermaid.initialize(config)
    const { svg: svgCode } = await mermaid.render(props.id, decodeURIComponent(props.graph))
    // 随机盐强制 v-html 重渲染：mermaid 会在 Vue 之外删除并重建 SVG，
    // svgCode 不变时 v-html 不会更新，切主题后图会消失。
    const salt = Math.random().toString(36).substring(7)
    svg.value = `${svgCode} <span style="display: none">${salt}</span>`
  } catch (error) {
    console.error(`[mermaid] 渲染失败（${props.id}）`, error)
  } finally {
    rendering = false
    if (rerenderRequested) {
      rerenderRequested = false
      await renderChart()
    }
  }
}

onMounted(async () => {
  ;({ default: mermaid } = await import('mermaid'))
  lastDark = isDark()
  // 只关心 <html> 的 class（明暗主题切换）。整棵子树的属性变化与主题无关，
  // 全量监听会让每张图在任意 DOM 属性变化时白白重渲染一次。
  mut = new MutationObserver(() => {
    const dark = isDark()
    if (dark === lastDark) return
    lastDark = dark
    renderChart()
  })
  mut.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  await renderChart()
})

onUnmounted(() => mut && mut.disconnect())
</script>
