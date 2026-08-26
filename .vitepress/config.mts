import { defineConfig } from 'vitepress'
import { svgEditorPlugin, svgDiagramMarkdownPlugin } from 'vitepress-plugin-svg-editor'
import { withOpenInEditor } from 'vitepress-plugin-open-in-editor'
import { sidebar as generatedSidebar } from './sidebar.generated'

export default withOpenInEditor(defineConfig({
  title: 'The Stack',
  description: '系统化的 Java 后端技术分析',
  lang: 'zh-CN',
  srcDir: './docs',
  outDir: './site',

  vite: {
    plugins: [
      svgEditorPlugin({
        storage: 'vitepress',
      }),
    ],
  },
  markdown: {
    config(md) {
      md.use(svgDiagramMarkdownPlugin)
    },
  },
  
  themeConfig: {
    logo: '/assets/logo.svg',
    
    editLink: {
      text: '在编辑器中打开源文件',
    },
    
    nav: [
      { text: '首页', link: '/' },
      { text: 'Java', link: '/java/01-java-language/' },
      { text: 'Spring', link: '/spring/' },
      { text: 'Redis', link: '/redis/' },
      { text: '更多', items: [
        { text: 'PostgreSQL', link: '/postgresql/' },
        { text: 'MySQL', link: '/mysql/' },
        { text: 'Kafka', link: '/kafka/' },
        { text: 'Elasticsearch', link: '/elasticsearch/' },
        { text: '设计模式', link: '/design-pattern/' },
        { text: '软件工程', link: '/engineering/' },
        { text: 'AI 工程', link: '/ai/' },
      ]
      },
    ],
    
    sidebar: {
      ...generatedSidebar,
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/b1tzer/b1tzer.github.io' }
    ],
    
    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2024-2026 b1tzer'
    },
    
    search: {
      provider: 'local'
    }
  }
}))
