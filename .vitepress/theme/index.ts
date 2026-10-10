import DefaultTheme from 'vitepress/theme'
import type { EnhanceAppContext } from 'vitepress'
import { enhanceApp as enhanceAppWithSvgEditor } from 'vitepress-plugin-svg-editor/client'
import Mermaid from './components/Mermaid.vue'
import './custom.css'

export default {
  extends: DefaultTheme,
  enhanceApp(context: EnhanceAppContext) {
    enhanceAppWithSvgEditor(context)
    context.app.component('Mermaid', Mermaid)
  },
}
