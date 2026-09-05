import{_ as s,o as n,c as i,a4 as e}from"./chunks/framework.BUqnS5H7.js";const g=JSON.parse('{"title":"技术债务","description":"","frontmatter":{},"headers":[],"relativePath":"engineering/08-project-management/chapter-04-technical-debt.md","filePath":"engineering/08-project-management/chapter-04-technical-debt.md"}'),t={name:"engineering/08-project-management/chapter-04-technical-debt.md"};function l(p,a,h,c,r,d){return n(),i("div",null,[...a[0]||(a[0]=[e(`<h1 id="技术债务" tabindex="-1" data-src-line="1" data-src-file="engineering/08-project-management/chapter-04-technical-debt.md">技术债务 <a class="header-anchor" href="#技术债务" aria-label="Permalink to &quot;技术债务&quot;">​</a></h1><blockquote data-src-line="3" data-src-file="engineering/08-project-management/chapter-04-technical-debt.md"><p data-src-line="3" data-src-file="engineering/08-project-management/chapter-04-technical-debt.md"><strong>核心问题</strong>：什么是技术债务？如何识别、管理和偿还技术债务？</p></blockquote><h2 id="_1-技术债务的类型" tabindex="-1" data-src-line="5" data-src-file="engineering/08-project-management/chapter-04-technical-debt.md">1. 技术债务的类型 <a class="header-anchor" href="#_1-技术债务的类型" aria-label="Permalink to &quot;1. 技术债务的类型&quot;">​</a></h2><table tabindex="0"><thead data-src-line="7" data-src-file="engineering/08-project-management/chapter-04-technical-debt.md"><tr data-src-line="7" data-src-file="engineering/08-project-management/chapter-04-technical-debt.md"><th style="text-align:left;">类型</th><th style="text-align:left;">说明</th><th style="text-align:left;">示例</th></tr></thead><tbody data-src-line="9" data-src-file="engineering/08-project-management/chapter-04-technical-debt.md"><tr data-src-line="9" data-src-file="engineering/08-project-management/chapter-04-technical-debt.md"><td style="text-align:left;">故意债务</td><td style="text-align:left;">明知不好但为了赶工期</td><td style="text-align:left;">跳过单元测试、硬编码配置</td></tr><tr data-src-line="10" data-src-file="engineering/08-project-management/chapter-04-technical-debt.md"><td style="text-align:left;">无意债务</td><td style="text-align:left;">不知道更好的方案</td><td style="text-align:left;">不合理的架构设计、过时的依赖</td></tr><tr data-src-line="11" data-src-file="engineering/08-project-management/chapter-04-technical-debt.md"><td style="text-align:left;">环境债务</td><td style="text-align:left;">外部环境变化导致</td><td style="text-align:left;">框架版本过旧、依赖库停止维护</td></tr><tr data-src-line="12" data-src-file="engineering/08-project-management/chapter-04-technical-debt.md"><td style="text-align:left;">代码债务</td><td style="text-align:left;">代码层面的问题</td><td style="text-align:left;">重复代码、过长方法、缺少文档</td></tr></tbody></table><h2 id="_2-技术债务识别" tabindex="-1" data-src-line="14" data-src-file="engineering/08-project-management/chapter-04-technical-debt.md">2. 技术债务识别 <a class="header-anchor" href="#_2-技术债务识别" aria-label="Permalink to &quot;2. 技术债务识别&quot;">​</a></h2><div class="language-java vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang">java</span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// 识别信号</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// 1. 代码层面</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">//    - SonarQube 报告的 Bug 和坏味道</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">//    - 测试覆盖率低于 60%</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">//    - 构建时间超过 10 分钟</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">//</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// 2. 架构层面</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">//    - 添加新功能需要修改多处代码</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">//    - 模块间耦合严重</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">//    - 缺少自动化测试</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">//</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// 3. 团队层面</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">//    - 新人上手需要超过 2 周</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">//    - 频繁出现&quot;改了这里那里坏了&quot;</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">//    - 团队不敢重构某些模块</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// 技术债务登记模板</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">/**</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"> * 债务编号：TD-001</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"> * 债务名称：订单模块缺少单元测试</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"> * 债务类型：代码债务</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"> * 严重程度：高</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"> * 影响范围：订单模块所有功能</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"> * 产生原因：赶工期跳过了测试</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"> * 偿还成本：5 人天</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"> * 风险：每次发布都有回归 Bug</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"> * 优先级：P1</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"> * 计划偿还时间：下个 Sprint</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"> */</span></span></code></pre></div><h2 id="_3-技术债务管理策略" tabindex="-1" data-src-line="48" data-src-file="engineering/08-project-management/chapter-04-technical-debt.md">3. 技术债务管理策略 <a class="header-anchor" href="#_3-技术债务管理策略" aria-label="Permalink to &quot;3. 技术债务管理策略&quot;">​</a></h2><div class="language-java vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang">java</span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// 策略 1：每次 Sprint 预留 20% 时间处理技术债务</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// Sprint 容量：20 故事点</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// 功能开发：16 点（80%）</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// 技术债务：4 点（20%）</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// 策略 2：Boy Scout Rule（离开时比来时更干净）</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// 每次修改代码时，顺手改善周围的代码</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// 不必专门安排时间，积少成多</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// 策略 3：技术债务 Sprint</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// 每 4-5 个功能 Sprint 后，安排一个专门的技术 Sprint</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// 集中处理积累的技术债务</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// 策略 4：重构与功能开发结合</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// 在开发新功能时，顺便重构相关模块</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// 避免&quot;等有时间再重构&quot;（永远不会有时间）</span></span></code></pre></div><h2 id="_4-技术债务的-roi-分析" tabindex="-1" data-src-line="69" data-src-file="engineering/08-project-management/chapter-04-technical-debt.md">4. 技术债务的 ROI 分析 <a class="header-anchor" href="#_4-技术债务的-roi-分析" aria-label="Permalink to &quot;4. 技术债务的 ROI 分析&quot;">​</a></h2><div class="language-java vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang">java</span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// 偿还技术债务的收益计算</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// 假设：订单模块缺少测试，每次发布平均有 2 个回归 Bug</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// 每个 Bug 修复成本：2 小时（定位 + 修复 + 测试）</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// 每月发布 4 次，每月损失：2 × 2 × 4 = 16 小时</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// 偿还成本：5 人天 = 40 小时</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// 回本周期：40 / 16 = 2.5 个月</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// 决策：如果偿还成本 &lt; 3 个月的损失，应该立即偿还</span></span></code></pre></div><blockquote data-src-line="82" data-src-file="engineering/08-project-management/chapter-04-technical-debt.md"><p data-src-line="82" data-src-file="engineering/08-project-management/chapter-04-technical-debt.md"><strong>技术债务的核心</strong>：技术债务不是坏事，就像金融债务一样，适度的债务可以帮助你快速发展。关键是&quot;有意识地借债，有计划地偿还&quot;。无意识的债务才是危险的。</p></blockquote>`,11)])])}const o=s(t,[["render",l]]);export{g as __pageData,o as default};
