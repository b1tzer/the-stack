import{_ as a,o as i,c as n,a4 as l}from"./chunks/framework.BUqnS5H7.js";const F=JSON.parse('{"title":"RabbitMQ 命令速查","description":"","frontmatter":{},"headers":[],"relativePath":"rabbitmq/reference/commands.md","filePath":"rabbitmq/reference/commands.md"}'),t={name:"rabbitmq/reference/commands.md"};function e(p,s,h,k,r,d){return i(),n("div",null,[...s[0]||(s[0]=[l(`<h1 id="rabbitmq-命令速查" tabindex="-1" data-src-line="1" data-src-file="rabbitmq/reference/commands.md">RabbitMQ 命令速查 <a class="header-anchor" href="#rabbitmq-命令速查" aria-label="Permalink to &quot;RabbitMQ 命令速查&quot;">​</a></h1><h2 id="rabbitmqctl-管理" tabindex="-1" data-src-line="3" data-src-file="rabbitmq/reference/commands.md">rabbitmqctl 管理 <a class="header-anchor" href="#rabbitmqctl-管理" aria-label="Permalink to &quot;rabbitmqctl 管理&quot;">​</a></h2><div class="language-bash vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang">bash</span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"># 集群状态</span></span>
<span class="line"><span style="--shiki-light:#6F42C1;--shiki-dark:#B392F0;">rabbitmqctl</span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;"> cluster_status</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"># 节点状态</span></span>
<span class="line"><span style="--shiki-light:#6F42C1;--shiki-dark:#B392F0;">rabbitmqctl</span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;"> status</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"># 列出所有连接</span></span>
<span class="line"><span style="--shiki-light:#6F42C1;--shiki-dark:#B392F0;">rabbitmqctl</span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;"> list_connections</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"># 列出所有通道</span></span>
<span class="line"><span style="--shiki-light:#6F42C1;--shiki-dark:#B392F0;">rabbitmqctl</span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;"> list_channels</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"># 列出所有队列</span></span>
<span class="line"><span style="--shiki-light:#6F42C1;--shiki-dark:#B392F0;">rabbitmqctl</span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;"> list_queues</span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;"> name</span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;"> messages</span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;"> consumers</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"># 列出所有交换机</span></span>
<span class="line"><span style="--shiki-light:#6F42C1;--shiki-dark:#B392F0;">rabbitmqctl</span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;"> list_exchanges</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"># 列出所有绑定</span></span>
<span class="line"><span style="--shiki-light:#6F42C1;--shiki-dark:#B392F0;">rabbitmqctl</span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;"> list_bindings</span></span></code></pre></div><h2 id="用户与权限" tabindex="-1" data-src-line="28" data-src-file="rabbitmq/reference/commands.md">用户与权限 <a class="header-anchor" href="#用户与权限" aria-label="Permalink to &quot;用户与权限&quot;">​</a></h2><div class="language-bash vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang">bash</span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"># 创建用户</span></span>
<span class="line"><span style="--shiki-light:#6F42C1;--shiki-dark:#B392F0;">rabbitmqctl</span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;"> add_user</span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;"> myuser</span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;"> mypassword</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"># 设置管理员标签</span></span>
<span class="line"><span style="--shiki-light:#6F42C1;--shiki-dark:#B392F0;">rabbitmqctl</span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;"> set_user_tags</span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;"> myuser</span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;"> administrator</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"># 设置权限（vhost, configure, write, read）</span></span>
<span class="line"><span style="--shiki-light:#6F42C1;--shiki-dark:#B392F0;">rabbitmqctl</span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;"> set_permissions</span><span style="--shiki-light:#005CC5;--shiki-dark:#79B8FF;"> -p</span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;"> /</span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;"> myuser</span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;"> &quot;.*&quot;</span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;"> &quot;.*&quot;</span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;"> &quot;.*&quot;</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"># 列出用户</span></span>
<span class="line"><span style="--shiki-light:#6F42C1;--shiki-dark:#B392F0;">rabbitmqctl</span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;"> list_users</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"># 删除用户</span></span>
<span class="line"><span style="--shiki-light:#6F42C1;--shiki-dark:#B392F0;">rabbitmqctl</span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;"> delete_user</span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;"> myuser</span></span></code></pre></div><h2 id="队列操作" tabindex="-1" data-src-line="47" data-src-file="rabbitmq/reference/commands.md">队列操作 <a class="header-anchor" href="#队列操作" aria-label="Permalink to &quot;队列操作&quot;">​</a></h2><div class="language-bash vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang">bash</span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"># 清空队列</span></span>
<span class="line"><span style="--shiki-light:#6F42C1;--shiki-dark:#B392F0;">rabbitmqctl</span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;"> purge_queue</span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;"> my-queue</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"># 删除队列</span></span>
<span class="line"><span style="--shiki-light:#6F42C1;--shiki-dark:#B392F0;">rabbitmqctl</span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;"> delete_queue</span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;"> my-queue</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"># 同步队列（镜像队列）</span></span>
<span class="line"><span style="--shiki-light:#6F42C1;--shiki-dark:#B392F0;">rabbitmqctl</span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;"> sync_queue</span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;"> my-queue</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"># 取消同步</span></span>
<span class="line"><span style="--shiki-light:#6F42C1;--shiki-dark:#B392F0;">rabbitmqctl</span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;"> cancel_sync_queue</span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;"> my-queue</span></span></code></pre></div><h2 id="策略管理" tabindex="-1" data-src-line="63" data-src-file="rabbitmq/reference/commands.md">策略管理 <a class="header-anchor" href="#策略管理" aria-label="Permalink to &quot;策略管理&quot;">​</a></h2><div class="language-bash vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang">bash</span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"># 设置策略（高可用）</span></span>
<span class="line"><span style="--shiki-light:#6F42C1;--shiki-dark:#B392F0;">rabbitmqctl</span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;"> set_policy</span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;"> ha-all</span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;"> &quot;^&quot;</span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;"> &#39;{&quot;ha-mode&quot;:&quot;all&quot;,&quot;ha-sync-mode&quot;:&quot;automatic&quot;}&#39;</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"># 设置策略（TTL + DLX）</span></span>
<span class="line"><span style="--shiki-light:#6F42C1;--shiki-dark:#B392F0;">rabbitmqctl</span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;"> set_policy</span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;"> dlx</span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;"> &quot;.*&quot;</span><span style="--shiki-light:#005CC5;--shiki-dark:#79B8FF;"> \\</span></span>
<span class="line"><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;">  &#39;{&quot;dead-letter-exchange&quot;:&quot;dlx-exchange&quot;,&quot;message-ttl&quot;:60000}&#39;</span><span style="--shiki-light:#005CC5;--shiki-dark:#79B8FF;"> \\</span></span>
<span class="line"><span style="--shiki-light:#005CC5;--shiki-dark:#79B8FF;">  --apply-to</span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;"> queues</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"># 列出策略</span></span>
<span class="line"><span style="--shiki-light:#6F42C1;--shiki-dark:#B392F0;">rabbitmqctl</span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;"> list_policies</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"># 删除策略</span></span>
<span class="line"><span style="--shiki-light:#6F42C1;--shiki-dark:#B392F0;">rabbitmqctl</span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;"> clear_policy</span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;"> ha-all</span></span></code></pre></div><h2 id="插件管理" tabindex="-1" data-src-line="81" data-src-file="rabbitmq/reference/commands.md">插件管理 <a class="header-anchor" href="#插件管理" aria-label="Permalink to &quot;插件管理&quot;">​</a></h2><div class="language-bash vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang">bash</span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"># 启用管理插件</span></span>
<span class="line"><span style="--shiki-light:#6F42C1;--shiki-dark:#B392F0;">rabbitmq-plugins</span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;"> enable</span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;"> rabbitmq_management</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"># 启用延迟消息插件</span></span>
<span class="line"><span style="--shiki-light:#6F42C1;--shiki-dark:#B392F0;">rabbitmq-plugins</span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;"> enable</span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;"> rabbitmq_delayed_message_exchange</span></span>
<span class="line"></span>
<span class="line"><span style="--shiki-light:#6A737D;--shiki-dark:#6A737D;"># 列出插件</span></span>
<span class="line"><span style="--shiki-light:#6F42C1;--shiki-dark:#B392F0;">rabbitmq-plugins</span><span style="--shiki-light:#032F62;--shiki-dark:#9ECBFF;"> list</span></span></code></pre></div>`,11)])])}const g=a(t,[["render",e]]);export{F as __pageData,g as default};
