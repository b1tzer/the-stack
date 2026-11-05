import type { EnhanceAppContext } from 'vitepress'
import { VPBTheme } from '@chunge16/vitepress-blogs-theme'
import { enhanceApp as enhanceAppWithSvgEditor } from 'vitepress-plugin-svg-editor/client'
import Mermaid from './components/Mermaid.vue'
import './custom.css'

export default {
  extends: VPBTheme,
  enhanceApp(context: EnhanceAppContext) {
    enhanceAppWithSvgEditor(context)
    context.app.component('Mermaid', Mermaid)
  },
}
