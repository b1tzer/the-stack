import{_ as s,o as i,c as a,a4 as n}from"./chunks/framework.BUqnS5H7.js";const k=JSON.parse('{"title":"Code Review","description":"","frontmatter":{},"headers":[],"relativePath":"engineering/06-engineering-practices/chapter-02-code-review.md","filePath":"engineering/06-engineering-practices/chapter-02-code-review.md"}'),t={name:"engineering/06-engineering-practices/chapter-02-code-review.md"};function l(p,e,r,h,d,c){return i(),a("div",null,[...e[0]||(e[0]=[n(`<h1 id="code-review" tabindex="-1" data-src-line="1" data-src-file="engineering/06-engineering-practices/chapter-02-code-review.md">Code Review <a class="header-anchor" href="#code-review" aria-label="Permalink to &quot;Code Review&quot;">​</a></h1><blockquote data-src-line="3" data-src-file="engineering/06-engineering-practices/chapter-02-code-review.md"><p data-src-line="3" data-src-file="engineering/06-engineering-practices/chapter-02-code-review.md"><strong>核心问题</strong>：如何做好 Code Review？Review 的标准是什么？如何让 Code Review 成为团队文化？</p></blockquote><h2 id="_1-code-review-的价值" tabindex="-1" data-src-line="5" data-src-file="engineering/06-engineering-practices/chapter-02-code-review.md">1. Code Review 的价值 <a class="header-anchor" href="#_1-code-review-的价值" aria-label="Permalink to &quot;1. Code Review 的价值&quot;">​</a></h2><table tabindex="0"><thead data-src-line="7" data-src-file="engineering/06-engineering-practices/chapter-02-code-review.md"><tr data-src-line="7" data-src-file="engineering/06-engineering-practices/chapter-02-code-review.md"><th style="text-align:left;">价值</th><th style="text-align:left;">说明</th></tr></thead><tbody data-src-line="9" data-src-file="engineering/06-engineering-practices/chapter-02-code-review.md"><tr data-src-line="9" data-src-file="engineering/06-engineering-practices/chapter-02-code-review.md"><td style="text-align:left;">代码质量</td><td style="text-align:left;">发现 Bug、设计缺陷、代码坏味道</td></tr><tr data-src-line="10" data-src-file="engineering/06-engineering-practices/chapter-02-code-review.md"><td style="text-align:left;">知识共享</td><td style="text-align:left;">团队成员了解彼此的代码</td></tr><tr data-src-line="11" data-src-file="engineering/06-engineering-practices/chapter-02-code-review.md"><td style="text-align:left;">一致性</td><td style="text-align:left;">统一代码风格和设计模式</td></tr><tr data-src-line="12" data-src-file="engineering/06-engineering-practices/chapter-02-code-review.md"><td style="text-align:left;">成长</td><td style="text-align:left;">新人从 Review 中学习，资深工程师通过 Review 教学</td></tr></tbody></table><h2 id="_2-code-review-checklist" tabindex="-1" data-src-line="14" data-src-file="engineering/06-engineering-practices/chapter-02-code-review.md">2. Code Review Checklist <a class="header-anchor" href="#_2-code-review-checklist" aria-label="Permalink to &quot;2. Code Review Checklist&quot;">​</a></h2><div class="language-markdown vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang">markdown</span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span style="--shiki-light:#005CC5;--shiki-light-font-weight:bold;--shiki-dark:#79B8FF;--shiki-dark-font-weight:bold;">## Code Review 检查清单</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#005CC5;--shiki-light-font-weight:bold;--shiki-dark:#79B8FF;--shiki-dark-font-weight:bold;">### 正确性</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">□ 代码逻辑是否正确？</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">□ 边界条件是否处理？</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">□ 异常处理是否完善？</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">□ 并发安全是否考虑？</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#005CC5;--shiki-light-font-weight:bold;--shiki-dark:#79B8FF;--shiki-dark-font-weight:bold;">### 设计</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">□ 是否遵循 SOLID 原则？</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">□ 是否有代码坏味道？</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">□ 抽象层次是否合理？</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">□ 命名是否清晰？</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#005CC5;--shiki-light-font-weight:bold;--shiki-dark:#79B8FF;--shiki-dark-font-weight:bold;">### 可维护性</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">□ 代码是否易于理解？</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">□ 是否有适当的注释？</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">□ 是否有单元测试？</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">□ 测试覆盖率是否足够？</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#005CC5;--shiki-light-font-weight:bold;--shiki-dark:#79B8FF;--shiki-dark-font-weight:bold;">### 性能</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">□ 是否有 N+1 查询？</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">□ 是否有内存泄漏风险？</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">□ 是否有不必要的循环？</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#005CC5;--shiki-light-font-weight:bold;--shiki-dark:#79B8FF;--shiki-dark-font-weight:bold;">### 安全</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">□ 是否有 SQL 注入风险？</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">□ 是否有 XSS 风险？</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">□ 敏感数据是否加密？</span></span></code></pre></div><h2 id="_3-review-评论规范" tabindex="-1" data-src-line="48" data-src-file="engineering/06-engineering-practices/chapter-02-code-review.md">3. Review 评论规范 <a class="header-anchor" href="#_3-review-评论规范" aria-label="Permalink to &quot;3. Review 评论规范&quot;">​</a></h2><div class="language-java vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang">java</span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// 好的 Review 评论：具体、可操作、解释原因</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// 差：模糊的评论</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// &quot;这段代码不好&quot;</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// 好：具体的评论</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// &quot;建议使用 StringBuilder 替代字符串拼接。在循环中使用 + 拼接字符串，</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">//  每次都会创建新的 String 对象，时间复杂度为 O(n²)。</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">//  StringBuilder 的时间复杂度为 O(n)。&quot;</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// 好：指出问题并给出解决方案</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// &quot;这里可能存在 N+1 查询问题。建议使用 @EntityGraph 或 JOIN FETCH：</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">//  @Query(\\&quot;SELECT o FROM Order o JOIN FETCH o.items WHERE o.userId = :userId\\&quot;)&quot;</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// 好：认可好的代码</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// &quot;这个策略模式的使用很优雅，后续新增支付方式只需要添加新的实现类 👍&quot;</span></span></code></pre></div><h2 id="_4-review-工具与流程" tabindex="-1" data-src-line="69" data-src-file="engineering/06-engineering-practices/chapter-02-code-review.md">4. Review 工具与流程 <a class="header-anchor" href="#_4-review-工具与流程" aria-label="Permalink to &quot;4. Review 工具与流程&quot;">​</a></h2><div class="language-java vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang">java</span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// GitHub Pull Request 流程</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// 1. 创建分支，开发功能</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// 2. 提交 PR，填写描述</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// 3. 自动触发 CI（构建 + 测试 + 代码扫描）</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// 4. 指定 Reviewer 进行 Review</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// 5. 根据反馈修改代码</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// 6. 至少 1 人 Approve 后合并</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// PR 描述模板</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">/**</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"> * ## 变更说明</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"> * 简述本次变更的内容和目的</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"> * </span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"> * ## 变更类型</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"> * - [ ] 新功能</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"> * - [ ] Bug 修复</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"> * - [ ] 重构</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"> * - [ ] 文档更新</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"> * </span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"> * ## 测试</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"> * - [ ] 单元测试已添加/更新</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"> * - [ ] 本地测试通过</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"> * </span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"> * ## 影响范围</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"> * 描述本次变更影响的功能模块</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"> * </span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"> * ## 截图（UI 变更时）</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"> */</span></span></code></pre></div><h2 id="_5-review-文化建设" tabindex="-1" data-src-line="102" data-src-file="engineering/06-engineering-practices/chapter-02-code-review.md">5. Review 文化建设 <a class="header-anchor" href="#_5-review-文化建设" aria-label="Permalink to &quot;5. Review 文化建设&quot;">​</a></h2><table tabindex="0"><thead data-src-line="104" data-src-file="engineering/06-engineering-practices/chapter-02-code-review.md"><tr data-src-line="104" data-src-file="engineering/06-engineering-practices/chapter-02-code-review.md"><th style="text-align:left;">实践</th><th style="text-align:left;">说明</th></tr></thead><tbody data-src-line="106" data-src-file="engineering/06-engineering-practices/chapter-02-code-review.md"><tr data-src-line="106" data-src-file="engineering/06-engineering-practices/chapter-02-code-review.md"><td style="text-align:left;">小 PR</td><td style="text-align:left;">每次 PR 控制在 200-400 行，便于 Review</td></tr><tr data-src-line="107" data-src-file="engineering/06-engineering-practices/chapter-02-code-review.md"><td style="text-align:left;">及时 Review</td><td style="text-align:left;">收到 PR 后 24 小时内完成 Review</td></tr><tr data-src-line="108" data-src-file="engineering/06-engineering-practices/chapter-02-code-review.md"><td style="text-align:left;">正面反馈</td><td style="text-align:left;">认可好的代码，不只是挑问题</td></tr><tr data-src-line="109" data-src-file="engineering/06-engineering-practices/chapter-02-code-review.md"><td style="text-align:left;">对事不对人</td><td style="text-align:left;">评论针对代码，不针对人</td></tr><tr data-src-line="110" data-src-file="engineering/06-engineering-practices/chapter-02-code-review.md"><td style="text-align:left;">自我 Review</td><td style="text-align:left;">提交 PR 前先自己 Review 一遍</td></tr></tbody></table><blockquote data-src-line="112" data-src-file="engineering/06-engineering-practices/chapter-02-code-review.md"><p data-src-line="112" data-src-file="engineering/06-engineering-practices/chapter-02-code-review.md"><strong>核心原则</strong>：Code Review 不是找茬，而是团队共同提升代码质量的过程。好的 Review 文化应该是&quot;我们一起让代码更好&quot;，而不是&quot;我来挑你的毛病&quot;。</p></blockquote>`,13)])])}const o=s(t,[["render",l]]);export{k as __pageData,o as default};
