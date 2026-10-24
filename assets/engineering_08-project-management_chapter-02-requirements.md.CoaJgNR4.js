import{_ as a,o as n,c as i,a5 as e}from"./chunks/framework.a5no_H3L.js";const g=JSON.parse('{"title":"需求分析","description":"核心问题：如何将模糊的业务需求转化为清晰的技术需求？如何避免需求理解偏差？","frontmatter":{},"headers":[],"relativePath":"engineering/08-project-management/chapter-02-requirements.md","filePath":"engineering/08-project-management/chapter-02-requirements.md"}'),l={name:"engineering/08-project-management/chapter-02-requirements.md"};function p(t,s,h,k,r,c){return n(),i("div",null,[...s[0]||(s[0]=[e(`<h1 id="需求分析" tabindex="-1" data-src-line="1" data-src-file="engineering/08-project-management/chapter-02-requirements.md">需求分析 <a class="header-anchor" href="#需求分析" aria-label="Permalink to &quot;需求分析&quot;">​</a></h1><blockquote data-src-line="3" data-src-file="engineering/08-project-management/chapter-02-requirements.md"><p data-src-line="3" data-src-file="engineering/08-project-management/chapter-02-requirements.md"><strong>核心问题</strong>：如何将模糊的业务需求转化为清晰的技术需求？如何避免需求理解偏差？</p></blockquote><h2 id="_1-用户故事与验收标准" tabindex="-1" data-src-line="5" data-src-file="engineering/08-project-management/chapter-02-requirements.md">1. 用户故事与验收标准 <a class="header-anchor" href="#_1-用户故事与验收标准" aria-label="Permalink to &quot;1. 用户故事与验收标准&quot;">​</a></h2><div class="language-java vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang">java</span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// 用户故事格式：As a [role], I want [feature], so that [benefit]</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// 验收标准（AC）：Given-When-Then 格式</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// 示例：购物车功能</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// 用户故事：</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// 作为一个注册用户，我想要将商品加入购物车，以便稍后统一结算。</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">//</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// 验收标准：</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// AC1: 用户可以将商品加入购物车</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">//   Given 用户已登录且商品有库存</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">//   When  用户点击&quot;加入购物车&quot;</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">//   Then  购物车数量增加，显示成功提示</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">//</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// AC2: 同一商品重复添加时合并数量</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">//   Given 购物车中已有商品 A（数量 2）</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">//   When  用户再次将商品 A 加入购物车（数量 1）</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">//   Then  购物车中商品 A 数量变为 3</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">//</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// AC3: 库存不足时提示用户</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">//   Given 商品当前可购买数量为 5，购物车中已有 4 件</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">//   When  用户尝试再添加 2 件</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">//   Then  拒绝本次添加，提示库存不足，并返回剩余可添加数量 1 件</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">//   注：「可购买数量」是业务定义的有效值，不必然等于数据库库存字段</span></span></code></pre></div><p data-src-line="33" data-src-file="engineering/08-project-management/chapter-02-requirements.md">验收标准要锁定业务结果，而非页面提示。购物车示例里，「不超卖」应落成一条可验证的业务不变量，即累计售出数量不得超过可售数量。边界条件（库存恰好耗尽、重复提交、并发下单）同样写进验收标准。至于库存何时预占、并发如何加锁，属于技术设计，不在需求阶段展开。需求分析只定义业务必须满足的约束，不决定实现方式。</p><h2 id="_2-需求分解" tabindex="-1" data-src-line="35" data-src-file="engineering/08-project-management/chapter-02-requirements.md">2. 需求分解 <a class="header-anchor" href="#_2-需求分解" aria-label="Permalink to &quot;2. 需求分解&quot;">​</a></h2><div class="language-java vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang">java</span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// 大需求分解为小需求（INVEST 原则）</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// I - Independent（独立的）</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// N - Negotiable（可协商的）</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// V - Valuable（有价值的）</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// E - Estimable（可估算的）</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// S - Small（小的）</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// T - Testable（可测试的）</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// 示例：将&quot;订单系统&quot;分解为独立的用户故事</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// 1. 创建订单（基础功能）</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// 2. 查看订单列表</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// 3. 查看订单详情</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// 4. 取消订单</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// 5. 订单支付</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// 6. 订单退款</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// 7. 订单物流跟踪</span></span></code></pre></div><p data-src-line="56" data-src-file="engineering/08-project-management/chapter-02-requirements.md">需求分析的产物是澄清后的业务规则、边界与验收条件。如何把这些条目排进产品待办列表、估算故事点并承诺进 Sprint，见<a href="./chapter-01-agile.html">敏捷开发</a>。澄清与迭代规划在开发中往复进行，并非严格的先后阶段。</p><h2 id="_3-需求评审-checklist" tabindex="-1" data-src-line="58" data-src-file="engineering/08-project-management/chapter-02-requirements.md">3. 需求评审 Checklist <a class="header-anchor" href="#_3-需求评审-checklist" aria-label="Permalink to &quot;3. 需求评审 Checklist&quot;">​</a></h2><div class="language-markdown vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang">markdown</span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">□ 需求目标是否明确？</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">□ 用户故事是否完整（角色-功能-价值）？</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">□ 验收标准是否清晰（Given-When-Then）？</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">□ 是否有边界条件和异常场景？</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">□ 是否有非功能需求（性能、安全）？</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">□ 涉及用户界面时，相关设计是否已明确？</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">□ 依赖的外部系统是否明确？</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">□ 技术可行性是否评估过？</span></span>
<span class="line"><span style="--shiki-light:#24292E;--shiki-dark:#E1E4E8;">□ 工期估算是否合理？</span></span></code></pre></div><h2 id="_4-需求变更管理" tabindex="-1" data-src-line="72" data-src-file="engineering/08-project-management/chapter-02-requirements.md">4. 需求变更管理 <a class="header-anchor" href="#_4-需求变更管理" aria-label="Permalink to &quot;4. 需求变更管理&quot;">​</a></h2><div class="language-java vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang">java</span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// 需求变更流程（按影响范围分层决策）</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// 1. 提出变更请求（描述变更内容和原因）</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// 2. 评估影响范围（工期、成本、风险）</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// 3. 按影响范围决策</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">//    - 不改变 Sprint Goal 的细节澄清或范围调整，相关角色协商后更新 Backlog</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">//    - 影响 Sprint Goal、交付承诺或跨团队依赖，评估影响后协商调整，必要时重新规划</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">//    - 涉及合同、合规或正式变更控制，按项目约定的审批机制执行</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// 4. 更新需求文档和 Sprint Backlog</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// 5. 通知相关方</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">// 变更影响评估模板</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;">/**</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"> * 变更名称：订单支持部分退款</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"> * 变更原因：用户反馈需要部分退款功能</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"> * 影响范围：</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"> *   - 后端：退款逻辑、金额计算</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"> *   - 前端：退款页面、退款记录</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"> *   - 测试：退款场景覆盖</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"> * 额外工期：3 天</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"> * 风险：与支付渠道的接口可能需要调整</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"> * 决策：同意变更，纳入下个 Sprint</span></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"> */</span></span></code></pre></div><blockquote data-src-line="99" data-src-file="engineering/08-project-management/chapter-02-requirements.md"><p data-src-line="99" data-src-file="engineering/08-project-management/chapter-02-requirements.md"><strong>需求分析的核心</strong>：好的需求分析不是记录用户说什么，而是理解用户要什么。</p></blockquote>`,13)])])}const A=a(l,[["render",p]]);export{g as __pageData,A as default};
