import { defineConfig } from 'vitepress'
import { svgEditorPlugin, svgDiagramMarkdownPlugin } from 'vitepress-plugin-svg-editor'
import { withOpenInEditor } from 'vitepress-plugin-open-in-editor'
import { withMermaid } from 'vitepress-plugin-mermaid'

export default withOpenInEditor(withMermaid(defineConfig({
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
    optimizeDeps: {
      include: ['fastdom', 'fastdom/extensions/fastdom-promised.js'],
    },
  },
  markdown: {
    config(md) {
      md.use(svgDiagramMarkdownPlugin)
    },
  },
  
  themeConfig: {
    logo: '/logo.svg',
    outline: {
      level: [2, 3],
    },
    
    editLink: {
      text: '在编辑器中打开源文件',
    },
    
    nav: [
      { text: 'Java', link: '/java/01-java-language/chapter-01-type-system', activeMatch: '^/java/' },
      { text: 'Spring', link: '/spring/01-core/chapter-01-spring-overview', activeMatch: '^/spring/' },
      { text: 'Redis', link: '/redis/01-data-model/chapter-01-overview', activeMatch: '^/redis/' },
      {
        text: '数据库',
        activeMatch: '^/(mysql|postgresql)/',
        items: [
          { text: 'MySQL', link: '/mysql/01-basics/chapter-01-overview' },
          { text: 'PostgreSQL', link: '/postgresql/01-pg-unique/chapter-01-pg-overview' },
        ],
      },
      {
        text: '消息队列',
        activeMatch: '^/(kafka|rabbitmq)/',
        items: [
          { text: 'Kafka', link: '/kafka/01-basics/chapter-01-overview' },
          { text: 'RabbitMQ', link: '/rabbitmq/01-basics/chapter-01-overview' },
        ],
      },
      { text: 'Elasticsearch', link: '/elasticsearch/01-basics/chapter-01-overview', activeMatch: '^/elasticsearch/' },
      {
        text: '工程',
        activeMatch: '^/(design-pattern|engineering|ai)/',
        items: [
          { text: '设计模式', link: '/design-pattern/00-intro/chapter-01-why-patterns' },
          { text: '软件工程', link: '/engineering/01-principles/chapter-01-overview' },
          { text: 'AI 工程', link: '/ai/01-LLM接口与提示词工程' },
        ],
      },
      { text: '场景实战', link: '/scenarios/', activeMatch: '^/scenarios/' },
    ],

    sidebar: {
      '/scenarios/': [
        {
          text: '场景实战',
          collapsed: true,
          items: [
            { text: '场景首页', link: '/scenarios/' },
          ],
        },
        {
          text: '缓存场景',
          collapsed: true,
          items: [
            { text: '缓存场景首页', link: '/scenarios/01-cache/' },
            { text: '缓存失效：穿透·击穿·雪崩', link: '/scenarios/01-cache/chapter-01-cache-invalidation' },
            { text: '缓存写路径：四种模式与一致性', link: '/scenarios/01-cache/chapter-02-cache-write-patterns' },
            { text: '多级缓存与纵深防御', link: '/scenarios/01-cache/chapter-03-multi-level-defense' },
            { text: '大 Key 与热 Key', link: '/scenarios/01-cache/chapter-04-big-hot-key' },
          ],
        },
        {
          text: '并发控制',
          collapsed: true,
          items: [
            { text: '并发控制首页', link: '/scenarios/02-concurrency/' },
            { text: '分布式锁', link: '/scenarios/02-concurrency/chapter-01-distributed-lock' },
            { text: '限流器', link: '/scenarios/02-concurrency/chapter-02-rate-limiting' },
            { text: '幂等控制', link: '/scenarios/02-concurrency/chapter-03-idempotency' },
          ],
        },
        {
          text: '消息场景',
          collapsed: true,
          items: [
            { text: '消息场景首页', link: '/scenarios/03-messaging/' },
            { text: '延迟任务', link: '/scenarios/03-messaging/chapter-01-delayed-task' },
            { text: 'RPC over MQ', link: '/scenarios/03-messaging/chapter-02-rpc-over-mq' },
            { text: '竞争消费者', link: '/scenarios/03-messaging/chapter-03-competing-consumers' },
            { text: '发布订阅', link: '/scenarios/03-messaging/chapter-04-pub-sub' },
            { text: '消息去重', link: '/scenarios/03-messaging/chapter-05-deduplication' },
          ],
        },
        {
          text: '数据访问',
          collapsed: true,
          items: [
            { text: '数据访问首页', link: '/scenarios/04-data-access/' },
            { text: '读写分离', link: '/scenarios/04-data-access/chapter-01-read-write-split' },
            { text: '多租户', link: '/scenarios/04-data-access/chapter-02-multi-tenant' },
          ],
        },
        {
          text: '综合案例',
          collapsed: true,
          items: [
            { text: '综合案例首页', link: '/scenarios/05-cases/' },
            { text: '电商订单系统', link: '/scenarios/05-cases/chapter-01-ecommerce' },
            { text: '排行榜', link: '/scenarios/05-cases/chapter-02-leaderboard' },
            { text: '缓存系统实战', link: '/scenarios/05-cases/chapter-03-cache-system' },
            { text: '日志分析', link: '/scenarios/05-cases/chapter-04-log-analysis' },
            { text: '搜索引擎', link: '/scenarios/05-cases/chapter-05-search-engine' },
            { text: '数据同步', link: '/scenarios/05-cases/chapter-06-data-sync' },
            { text: '电商订单（消息驱动）', link: '/scenarios/05-cases/chapter-07-order-system' },
          ],
        },
      ],
      '/ai/': [
        {
          text: 'AI 工程',
          collapsed: true,
          items: [
            { text: 'LLM 接口与提示词工程', link: '/ai/01-LLM接口与提示词工程' },
            { text: 'RAG 架构与工程落地', link: '/ai/02-RAG架构与工程落地' },
            { text: 'Function Calling 与 Agent 范式', link: '/ai/03-FunctionCalling与Agent范式' },
            { text: 'Spring AI 入门与 MCP 集成', link: '/ai/04-SpringAI入门与MCP集成' },
            { text: 'MCP 协议与 OpenClaw Skill 实战', link: '/ai/05-MCP协议与OpenClawSkill实战' },
          ],
        },
      ],
      '/design-pattern/': [
        {
          text: '入门',
          collapsed: true,
          items: [
            { text: '为什么需要设计模式', link: '/design-pattern/00-intro/chapter-01-why-patterns' },
          ],
        },
        {
          text: '创建型',
          collapsed: true,
          items: [
            { text: '工厂模式', link: '/design-pattern/01-creational/chapter-01-factory' },
            { text: '单例模式', link: '/design-pattern/01-creational/chapter-02-singleton' },
            { text: '建造者模式', link: '/design-pattern/01-creational/chapter-03-builder' },
            { text: '原型模式', link: '/design-pattern/01-creational/chapter-04-prototype' },
            { text: '创建型对比', link: '/design-pattern/01-creational/chapter-05-creational-comparison' },
          ],
        },
        {
          text: '结构型',
          collapsed: true,
          items: [
            { text: '适配器模式', link: '/design-pattern/02-structural/chapter-01-adapter' },
            { text: '装饰器模式', link: '/design-pattern/02-structural/chapter-02-decorator' },
            { text: '代理模式', link: '/design-pattern/02-structural/chapter-03-proxy' },
            { text: '外观模式', link: '/design-pattern/02-structural/chapter-04-facade' },
            { text: '桥接模式', link: '/design-pattern/02-structural/chapter-05-bridge' },
            { text: '组合模式', link: '/design-pattern/02-structural/chapter-06-composite' },
            { text: '享元模式', link: '/design-pattern/02-structural/chapter-07-flyweight' },
            { text: '结构型对比', link: '/design-pattern/02-structural/chapter-08-structural-comparison' },
          ],
        },
        {
          text: '行为型',
          collapsed: true,
          items: [
            { text: '策略模式', link: '/design-pattern/03-behavioral/chapter-01-strategy' },
            { text: '观察者模式', link: '/design-pattern/03-behavioral/chapter-02-observer' },
            { text: '模板方法', link: '/design-pattern/03-behavioral/chapter-03-template-method' },
            { text: '责任链模式', link: '/design-pattern/03-behavioral/chapter-04-chain-of-responsibility' },
            { text: '命令模式', link: '/design-pattern/03-behavioral/chapter-05-command' },
            { text: '状态模式', link: '/design-pattern/03-behavioral/chapter-06-state' },
            { text: '迭代器模式', link: '/design-pattern/03-behavioral/chapter-07-iterator' },
            { text: '中介者模式', link: '/design-pattern/03-behavioral/chapter-08-mediator' },
            { text: '备忘录模式', link: '/design-pattern/03-behavioral/chapter-09-memento' },
            { text: '访问者模式', link: '/design-pattern/03-behavioral/chapter-10-visitor' },
            { text: '行为型对比', link: '/design-pattern/03-behavioral/chapter-11-behavioral-comparison' },
          ],
        },
        {
          text: '实战',
          collapsed: true,
          items: [
            { text: '设计模式入门', link: '/design-pattern/04-practice/chapter-01-getting-started' },
            { text: 'Spring 中的模式', link: '/design-pattern/04-practice/chapter-02-spring-patterns' },
            { text: 'JDK 中的模式', link: '/design-pattern/04-practice/chapter-03-jdk-patterns' },
            { text: '重构到模式', link: '/design-pattern/04-practice/chapter-04-refactoring-to-patterns' },
            { text: '反模式', link: '/design-pattern/04-practice/chapter-05-anti-patterns' },
          ],
        },
        {
          text: '参考手册',
          collapsed: true,
          items: [
            { text: '模式速查表', link: '/design-pattern/reference/pattern-cheatsheet' },
            { text: 'UML 类图速查', link: '/design-pattern/reference/uml-cheatsheet' },
          ],
        },
      ],
      '/elasticsearch/': [
        {
          text: '基础入门',
          collapsed: true,
          items: [
            { text: 'ES 引入', link: '/elasticsearch/01-basics/chapter-00-intro' },
            { text: 'ES 概览', link: '/elasticsearch/01-basics/chapter-01-overview' },
            { text: '核心概念', link: '/elasticsearch/01-basics/chapter-03-core-concepts' },
            { text: 'REST API', link: '/elasticsearch/01-basics/chapter-04-rest-api' },
          ],
        },
        {
          text: '索引与映射',
          collapsed: true,
          items: [
            { text: '文档 CRUD', link: '/elasticsearch/02-indexing/chapter-01-document-crud' },
            { text: '映射', link: '/elasticsearch/02-indexing/chapter-02-mapping' },
            { text: '分析器', link: '/elasticsearch/02-indexing/chapter-03-analysis' },
            { text: '中文分词', link: '/elasticsearch/02-indexing/chapter-04-chinese-analysis' },
            { text: '索引管理', link: '/elasticsearch/02-indexing/chapter-05-index-management' },
            { text: '倒排索引', link: '/elasticsearch/02-indexing/chapter-06-inverted-index' },
          ],
        },
        {
          text: '搜索',
          collapsed: true,
          items: [
            { text: 'Query DSL', link: '/elasticsearch/03-search/chapter-01-query-dsl' },
            { text: '全文搜索', link: '/elasticsearch/03-search/chapter-02-full-text-search' },
            { text: '精确查询', link: '/elasticsearch/03-search/chapter-03-term-query' },
            { text: '布尔查询', link: '/elasticsearch/03-search/chapter-04-bool-query' },
            { text: '嵌套查询', link: '/elasticsearch/03-search/chapter-05-joining' },
            { text: '高亮', link: '/elasticsearch/03-search/chapter-06-highlight' },
            { text: '分页', link: '/elasticsearch/03-search/chapter-07-pagination' },
          ],
        },
        {
          text: '聚合',
          collapsed: true,
          items: [
            { text: '指标聚合', link: '/elasticsearch/04-aggregation/chapter-01-metrics-agg' },
            { text: '桶聚合', link: '/elasticsearch/04-aggregation/chapter-02-bucket-agg' },
            { text: '管道聚合', link: '/elasticsearch/04-aggregation/chapter-03-pipeline-agg' },
            { text: '聚合优化', link: '/elasticsearch/04-aggregation/chapter-04-agg-optimization' },
          ],
        },
        {
          text: '分布式原理',
          collapsed: true,
          items: [
            { text: '分布式架构', link: '/elasticsearch/05-distributed-internals/chapter-01-architecture' },
            { text: '分片机制', link: '/elasticsearch/05-distributed-internals/chapter-02-sharding' },
            { text: '副本机制', link: '/elasticsearch/05-distributed-internals/chapter-03-replication' },
            { text: '写入流程', link: '/elasticsearch/05-distributed-internals/chapter-04-write-path' },
            { text: '读取流程', link: '/elasticsearch/05-distributed-internals/chapter-05-read-path' },
            { text: '近实时搜索', link: '/elasticsearch/05-distributed-internals/chapter-06-near-real-time' },
            { text: '数据一致性', link: '/elasticsearch/05-distributed-internals/chapter-07-data-consistency' },
          ],
        },
        {
          text: '数据建模',
          collapsed: true,
          items: [
            { text: '建模原则', link: '/elasticsearch/06-data-modeling/chapter-01-modeling-principles' },
            { text: 'Nested vs Join', link: '/elasticsearch/06-data-modeling/chapter-02-nested-vs-join' },
            { text: '反规范化', link: '/elasticsearch/06-data-modeling/chapter-03-denormalization' },
            { text: '时序数据', link: '/elasticsearch/06-data-modeling/chapter-04-time-series' },
          ],
        },
        {
          text: '运维管理',
          collapsed: true,
          items: [
            { text: '集群管理', link: '/elasticsearch/07-operations/chapter-01-cluster-management' },
            { text: '监控', link: '/elasticsearch/07-operations/chapter-02-monitoring' },
            { text: '备份恢复', link: '/elasticsearch/07-operations/chapter-03-backup-restore' },
            { text: '安全', link: '/elasticsearch/07-operations/chapter-04-security' },
            { text: '版本升级', link: '/elasticsearch/07-operations/chapter-05-upgrade' },
            { text: '常见问题', link: '/elasticsearch/07-operations/chapter-06-troubleshooting' },
          ],
        },
        {
          text: '性能优化',
          collapsed: true,
          items: [
            { text: '索引优化', link: '/elasticsearch/08-performance/chapter-01-index-optimization' },
            { text: '查询优化', link: '/elasticsearch/08-performance/chapter-02-query-optimization' },
            { text: 'JVM 调优', link: '/elasticsearch/08-performance/chapter-03-jvm-tuning' },
            { text: '硬件选型', link: '/elasticsearch/08-performance/chapter-04-hardware' },
          ],
        },
        {
          text: '生态工具',
          collapsed: true,
          items: [
            { text: 'ELK Stack', link: '/elasticsearch/09-ecosystem/chapter-01-elk' },
            { text: 'Beats', link: '/elasticsearch/09-ecosystem/chapter-02-beats' },
            { text: 'APM', link: '/elasticsearch/09-ecosystem/chapter-03-apm' },
            { text: '向量搜索', link: '/elasticsearch/09-ecosystem/chapter-04-vector-search' },
          ],
        },
        {
          text: '实战',
          collapsed: true,
          items: [
            { text: '安装部署与环境配置', link: '/elasticsearch/10-practice/chapter-01-installation' },
            { text: '第一个 ES 应用', link: '/elasticsearch/10-practice/chapter-02-first-app' },
            { text: '首次生产部署', link: '/elasticsearch/10-practice/chapter-03-first-production' },
            { text: 'Spring 集成', link: '/elasticsearch/10-practice/chapter-04-spring-integration' },
          ],
        },
        {
          text: '参考手册',
          collapsed: true,
          items: [
            { text: '参数速查', link: '/elasticsearch/reference/parameters' },
            { text: 'API 速查', link: '/elasticsearch/reference/api' },
          ],
        },
      ],
      '/engineering/': [
        {
          text: '设计原则',
          collapsed: true,
          items: [
            { text: '软件工程概览', link: '/engineering/01-principles/chapter-01-overview' },
            { text: 'SOLID 原则', link: '/engineering/01-principles/chapter-02-solid' },
            { text: '其他原则', link: '/engineering/01-principles/chapter-03-other-principles' },
            { text: '代码坏味道', link: '/engineering/01-principles/chapter-04-code-smells' },
            { text: '重构', link: '/engineering/01-principles/chapter-05-refactoring' },
          ],
        },
        {
          text: '设计模式',
          collapsed: true,
          items: [
            { text: '创建型', link: '/engineering/02-design-patterns/chapter-01-creational' },
            { text: '结构型', link: '/engineering/02-design-patterns/chapter-02-structural' },
            { text: '行为型', link: '/engineering/02-design-patterns/chapter-03-behavioral' },
            { text: '模式实践', link: '/engineering/02-design-patterns/chapter-04-pattern-practice' },
          ],
        },
        {
          text: '架构设计',
          collapsed: true,
          items: [
            { text: '架构风格', link: '/engineering/03-architecture/chapter-01-architecture-styles' },
            { text: '整洁架构', link: '/engineering/03-architecture/chapter-02-clean-architecture' },
            { text: '微服务', link: '/engineering/03-architecture/chapter-03-microservices' },
            { text: '单体架构', link: '/engineering/03-architecture/chapter-04-monolith' },
            { text: '事件驱动', link: '/engineering/03-architecture/chapter-05-event-driven' },
            { text: '架构决策', link: '/engineering/03-architecture/chapter-06-architecture-decision' },
            { text: 'API 设计', link: '/engineering/03-architecture/chapter-07-api-design' },
            { text: '数据建模', link: '/engineering/03-architecture/chapter-08-data-modeling' },
          ],
        },
        {
          text: 'DDD',
          collapsed: true,
          items: [
            { text: 'DDD 概览', link: '/engineering/04-ddd/chapter-01-ddd-overview' },
            { text: '限界上下文', link: '/engineering/04-ddd/chapter-02-bounded-context' },
            { text: '战术设计', link: '/engineering/04-ddd/chapter-03-tactical-design' },
            { text: '领域事件', link: '/engineering/04-ddd/chapter-04-domain-events' },
            { text: 'DDD 实战', link: '/engineering/04-ddd/chapter-05-ddd-practice' },
          ],
        },
        {
          text: '系统设计',
          collapsed: true,
          items: [
            { text: '设计方法论', link: '/engineering/05-system-design/chapter-01-design-methodology' },
            { text: '高并发', link: '/engineering/05-system-design/chapter-02-high-concurrency' },
            { text: '高可用', link: '/engineering/05-system-design/chapter-03-high-availability' },
            { text: '高性能', link: '/engineering/05-system-design/chapter-04-high-performance' },
            { text: '可扩展', link: '/engineering/05-system-design/chapter-05-scalability' },
            { text: '分布式理论', link: '/engineering/05-system-design/chapter-06-distributed-theory' },
          ],
        },
        {
          text: '工程实践',
          collapsed: true,
          items: [
            { text: 'Git 工作流', link: '/engineering/06-engineering-practices/chapter-01-git-workflow' },
            { text: 'Code Review', link: '/engineering/06-engineering-practices/chapter-02-code-review' },
            { text: '测试', link: '/engineering/06-engineering-practices/chapter-03-testing' },
            { text: 'CI/CD', link: '/engineering/06-engineering-practices/chapter-04-cicd' },
            { text: 'DevOps', link: '/engineering/06-engineering-practices/chapter-05-devops' },
            { text: '可观测性', link: '/engineering/06-engineering-practices/chapter-06-observability' },
          ],
        },
        {
          text: '安全',
          collapsed: true,
          items: [
            { text: '安全概览', link: '/engineering/07-security/chapter-01-security-overview' },
            { text: '认证', link: '/engineering/07-security/chapter-02-authentication' },
            { text: '授权', link: '/engineering/07-security/chapter-03-authorization' },
            { text: '常见攻击', link: '/engineering/07-security/chapter-04-common-attacks' },
            { text: '安全实践', link: '/engineering/07-security/chapter-05-security-practice' },
          ],
        },
        {
          text: '项目管理',
          collapsed: true,
          items: [
            { text: '敏捷', link: '/engineering/08-project-management/chapter-01-agile' },
            { text: '需求分析', link: '/engineering/08-project-management/chapter-02-requirements' },
            { text: '估算', link: '/engineering/08-project-management/chapter-03-estimation' },
            { text: '技术债务', link: '/engineering/08-project-management/chapter-04-technical-debt' },
          ],
        },
        {
          text: '参考手册',
          collapsed: true,
          items: [
            { text: '设计原则速查', link: '/engineering/reference/principles' },
            { text: '工具链速查', link: '/engineering/reference/toolchain' },
            { text: 'Code Review 速查', link: '/engineering/reference/code-review-checklist' },
          ],
        },
      ],
      '/java/': [
        {
          text: 'Java 语言',
          collapsed: true,
          items: [
            { text: '类型系统', link: '/java/01-java-language/chapter-01-type-system' },
            { text: '面向对象', link: '/java/01-java-language/chapter-02-oop' },
            { text: '泛型', link: '/java/01-java-language/chapter-03-generics' },
            { text: '注解与 Lambda', link: '/java/01-java-language/chapter-04-annotation-lambda' },
          ],
        },
        {
          text: 'JVM Runtime',
          collapsed: true,
          items: [
            { text: '字节码与类加载', link: '/java/02-jvm-runtime/chapter-01-bytecode-classloading' },
            { text: 'JVM 运行时数据区', link: '/java/02-jvm-runtime/chapter-02-memory-model' },
            { text: '对象模型', link: '/java/02-jvm-runtime/chapter-03-object-model' },
            { text: '垃圾回收', link: '/java/02-jvm-runtime/chapter-04-gc' },
            { text: 'JIT 编译', link: '/java/02-jvm-runtime/chapter-05-jit' },
            { text: '线上排查与诊断', link: '/java/02-jvm-runtime/chapter-06-diagnostics' },
            { text: '案例集（一）：CPU 飙升与内存泄漏', link: '/java/02-jvm-runtime/chapter-06-diagnostics-cases-part1' },
            { text: '案例集（二）：低内存低 CPU 的 GC 疑难', link: '/java/02-jvm-runtime/chapter-06-diagnostics-cases-part2' },
            { text: '案例集（三）：低内存低 CPU 的 GC 疑难', link: '/java/02-jvm-runtime/chapter-06-diagnostics-cases-part3' },
            { text: '案例集（四）：TCP 层与堆外内存', link: '/java/02-jvm-runtime/chapter-06-diagnostics-cases-part4' },
          ],
        },
        {
          text: 'Java 并发',
          collapsed: true,
          items: [
            { text: '并发的本质', link: '/java/03-java-concurrency/chapter-01-why-concurrency' },
            { text: '线程：Java 的执行单元', link: '/java/03-java-concurrency/chapter-02-thread-model' },
            { text: '线程封闭：ThreadLocal', link: '/java/03-java-concurrency/chapter-03-threadlocal' },
            { text: 'Java 内存模型（JMM）', link: '/java/03-java-concurrency/chapter-04-jmm' },
            { text: 'volatile', link: '/java/03-java-concurrency/chapter-05-volatile' },
            { text: 'synchronized', link: '/java/03-java-concurrency/chapter-06-synchronized' },
            { text: 'CAS 与原子类', link: '/java/03-java-concurrency/chapter-07-cas-atomic' },
            { text: 'LockSupport 与 AQS', link: '/java/03-java-concurrency/chapter-08-locksupport-aqs' },
            { text: '并发集合', link: '/java/03-java-concurrency/chapter-09-concurrent-collections' },
            { text: '线程池', link: '/java/03-java-concurrency/chapter-10-thread-pool' },
            { text: '异步编程', link: '/java/03-java-concurrency/chapter-11-async-model' },
            { text: '虚拟线程与结构化并发', link: '/java/03-java-concurrency/chapter-12-virtual-thread' },
            { text: '诊断与优化', link: '/java/03-java-concurrency/chapter-13-diagnostics' },
            { text: '案例集：死锁、线程池与虚拟线程', link: '/java/03-java-concurrency/chapter-14-diagnostics-cases' },
          ],
        },
        {
          text: '网络与通信',
          collapsed: true,
          items: [
            { text: '网络通信基础', link: '/java/04-java-network/chapter-01-network-basics' },
            { text: 'TCP/IP', link: '/java/04-java-network/chapter-02-tcp-ip' },
            { text: 'Socket 编程', link: '/java/04-java-network/chapter-03-socket' },
            { text: 'Java NIO', link: '/java/04-java-network/chapter-04-nio' },
            { text: 'Netty', link: '/java/04-java-network/chapter-05-netty' },
            { text: 'HTTP 协议', link: '/java/04-java-network/chapter-06-http' },
            { text: 'Servlet 到 Spring MVC', link: '/java/04-java-network/chapter-07-servlet-springmvc' },
            { text: 'RPC 与微服务', link: '/java/04-java-network/chapter-08-rpc' },
            { text: '长连接与实时通信', link: '/java/04-java-network/chapter-09-long-connection' },
            { text: '网络诊断', link: '/java/04-java-network/chapter-10-network-diagnostics' },
          ],
        },
        {
          text: '数据访问与持久化',
          collapsed: true,
          items: [
            { text: '持久化思想', link: '/java/05-java-data-access/chapter-01-persistence-thought' },
            { text: 'JDBC', link: '/java/05-java-data-access/chapter-02-jdbc' },
            { text: 'MyBatis', link: '/java/05-java-data-access/chapter-03-mybatis' },
            { text: 'ORM 深入', link: '/java/05-java-data-access/chapter-04-orm-deep' },
            { text: '性能优化', link: '/java/05-java-data-access/chapter-05-performance' },
            { text: 'Druid 连接池', link: '/java/05-java-data-access/chapter-06-druid' },
          ],
        },
      ],
      '/kafka/': [
        {
          text: '基础入门',
          collapsed: true,
          items: [
            { text: 'Kafka 概览', link: '/kafka/01-basics/chapter-01-overview' },
            { text: '核心术语', link: '/kafka/01-basics/chapter-02-terminology' },
            { text: '整体架构', link: '/kafka/01-basics/chapter-03-architecture' },
            { text: '消息队列选型', link: '/kafka/01-basics/chapter-04-mq-comparison' },
          ],
        },
        {
          text: '生产者',
          collapsed: true,
          items: [
            { text: '生产者 API', link: '/kafka/02-producer/chapter-01-producer-basics' },
            { text: '分区策略', link: '/kafka/02-producer/chapter-02-partition-strategy' },
            { text: 'ACK 与重试', link: '/kafka/02-producer/chapter-03-acks-retries' },
            { text: '批量与压缩', link: '/kafka/02-producer/chapter-04-batch-compression' },
            { text: '事务生产者', link: '/kafka/02-producer/chapter-05-transaction-producer' },
          ],
        },
        {
          text: '消费者',
          collapsed: true,
          items: [
            { text: '消费者 API', link: '/kafka/03-consumer/chapter-01-consumer-basics' },
            { text: '消费者组', link: '/kafka/03-consumer/chapter-02-consumer-group' },
            { text: 'Offset 管理', link: '/kafka/03-consumer/chapter-03-offset-management' },
            { text: 'Rebalance 策略', link: '/kafka/03-consumer/chapter-04-rebalance-strategy' },
            { text: '消费者优化', link: '/kafka/03-consumer/chapter-05-consumer-optimization' },
          ],
        },
        {
          text: 'Schema 与序列化',
          collapsed: true,
          items: [
            { text: 'Schema 概览', link: '/kafka/04-schema/chapter-01-schema-overview' },
            { text: '序列化格式对比', link: '/kafka/04-schema/chapter-02-serializers' },
            { text: 'Schema Registry', link: '/kafka/04-schema/chapter-03-schema-registry' },
            { text: 'Schema 演进', link: '/kafka/04-schema/chapter-04-schema-evolution' },
          ],
        },
        {
          text: '存储原理',
          collapsed: true,
          items: [
            { text: '日志分段', link: '/kafka/05-storage-internals/chapter-01-log-segment' },
            { text: 'Page Cache', link: '/kafka/05-storage-internals/chapter-02-page-cache' },
            { text: '副本机制', link: '/kafka/05-storage-internals/chapter-03-replication' },
            { text: 'Controller', link: '/kafka/05-storage-internals/chapter-04-controller' },
            { text: 'KRaft', link: '/kafka/05-storage-internals/chapter-05-kraft' },
          ],
        },
        {
          text: '可靠性',
          collapsed: true,
          items: [
            { text: 'ACK 机制', link: '/kafka/06-reliability/chapter-01-acks' },
            { text: 'Exactly Once', link: '/kafka/06-reliability/chapter-02-exactly-once' },
            { text: '消息顺序', link: '/kafka/06-reliability/chapter-03-message-ordering' },
            { text: '数据保留', link: '/kafka/06-reliability/chapter-04-data-retention' },
          ],
        },
        {
          text: '流处理',
          collapsed: true,
          items: [
            { text: 'Streams 概览', link: '/kafka/07-streams/chapter-01-streams-basics' },
            { text: '流操作', link: '/kafka/07-streams/chapter-02-stream-operations' },
            { text: '窗口操作', link: '/kafka/07-streams/chapter-03-windowing' },
            { text: '状态存储', link: '/kafka/07-streams/chapter-04-state-store' },
            { text: 'Streams Exactly Once', link: '/kafka/07-streams/chapter-05-exactly-once-streams' },
          ],
        },
        {
          text: 'Connect',
          collapsed: true,
          items: [
            { text: 'Connect 概览', link: '/kafka/08-connect/chapter-01-connect-basics' },
            { text: '连接器配置', link: '/kafka/08-connect/chapter-02-connect-config' },
            { text: '常用插件', link: '/kafka/08-connect/chapter-03-connect-plugins' },
            { text: 'Connect 监控', link: '/kafka/08-connect/chapter-04-connect-monitoring' },
          ],
        },
        {
          text: '运维管理',
          collapsed: true,
          items: [
            { text: '集群管理', link: '/kafka/09-operations/chapter-01-cluster-management' },
            { text: '监控', link: '/kafka/09-operations/chapter-02-monitoring' },
            { text: '安全', link: '/kafka/09-operations/chapter-03-security' },
            { text: '常见问题', link: '/kafka/09-operations/chapter-04-troubleshooting' },
          ],
        },
        {
          text: '多集群',
          collapsed: true,
          items: [
            { text: '拓扑与场景', link: '/kafka/10-multi-cluster/chapter-01-scenarios' },
            { text: 'MirrorMaker 2', link: '/kafka/10-multi-cluster/chapter-02-mirrormaker2' },
            { text: 'Offset 翻译', link: '/kafka/10-multi-cluster/chapter-03-offset-translation' },
            { text: '灾备演练', link: '/kafka/10-multi-cluster/chapter-04-dr-drill' },
          ],
        },
        {
          text: '实战',
          collapsed: true,
          items: [
            { text: '安装部署与环境配置', link: '/kafka/11-practice/chapter-01-installation' },
            { text: '第一个 Kafka 应用', link: '/kafka/11-practice/chapter-02-first-app' },
            { text: '首次生产部署', link: '/kafka/11-practice/chapter-03-first-production' },
            { text: 'Spring 集成', link: '/kafka/11-practice/chapter-04-spring-integration' },
            { text: '常见场景', link: '/kafka/11-practice/chapter-05-common-patterns' },
            { text: '性能调优', link: '/kafka/11-practice/chapter-06-performance-tuning' },
            { text: 'AdminClient 编程', link: '/kafka/11-practice/chapter-07-admin-client' },
          ],
        },
        {
          text: '参考手册',
          collapsed: true,
          items: [
            { text: '参数速查', link: '/kafka/reference/parameters' },
            { text: '命令速查', link: '/kafka/reference/commands' },
          ],
        },
      ],
      '/rabbitmq/': [
        {
          text: '基础入门',
          collapsed: true,
          items: [
            { text: 'RabbitMQ 概览', link: '/rabbitmq/01-basics/chapter-01-overview' },
            { text: '整体架构', link: '/rabbitmq/01-basics/chapter-02-architecture' },
            { text: 'AMQP 协议', link: '/rabbitmq/01-basics/chapter-03-amqp-protocol' },
            { text: '安装部署', link: '/rabbitmq/01-basics/chapter-04-install-config' },
            { text: '消息队列选型', link: '/rabbitmq/01-basics/chapter-05-mq-comparison' },
          ],
        },
        {
          text: 'Exchange',
          collapsed: true,
          items: [
            { text: 'Exchange 基础', link: '/rabbitmq/02-exchange/chapter-01-exchange-basics' },
            { text: 'Direct Exchange', link: '/rabbitmq/02-exchange/chapter-02-direct-exchange' },
            { text: 'Topic Exchange', link: '/rabbitmq/02-exchange/chapter-03-topic-exchange' },
            { text: 'Fanout Exchange', link: '/rabbitmq/02-exchange/chapter-04-fanout-exchange' },
            { text: 'Headers Exchange', link: '/rabbitmq/02-exchange/chapter-05-headers-exchange' },
            { text: 'Alternate Exchange', link: '/rabbitmq/02-exchange/chapter-06-alternate-exchange' },
          ],
        },
        {
          text: 'Queue',
          collapsed: true,
          items: [
            { text: 'Queue 基础', link: '/rabbitmq/03-queue/chapter-01-queue-basics' },
            { text: 'Classic Queue', link: '/rabbitmq/03-queue/chapter-02-classic-queue' },
            { text: 'Quorum Queue', link: '/rabbitmq/03-queue/chapter-03-quorum-queue' },
            { text: 'Stream Queue', link: '/rabbitmq/03-queue/chapter-04-stream-queue' },
            { text: '队列参数', link: '/rabbitmq/03-queue/chapter-05-queue-arguments' },
            { text: '死信队列', link: '/rabbitmq/03-queue/chapter-06-dead-letter' },
          ],
        },
        {
          text: '生产者',
          collapsed: true,
          items: [
            { text: '生产者基础', link: '/rabbitmq/04-producer/chapter-01-producer-basics' },
            { text: 'Publisher Confirm', link: '/rabbitmq/04-producer/chapter-02-publisher-confirm' },
            { text: 'Mandatory 与 Return', link: '/rabbitmq/04-producer/chapter-03-mandatory-return' },
            { text: '批量发送', link: '/rabbitmq/04-producer/chapter-04-batch-send' },
          ],
        },
        {
          text: '消费者',
          collapsed: true,
          items: [
            { text: '消费者基础', link: '/rabbitmq/05-consumer/chapter-01-consumer-basics' },
            { text: 'ACK 机制', link: '/rabbitmq/05-consumer/chapter-02-ack-mechanism' },
            { text: 'Prefetch 与背压', link: '/rabbitmq/05-consumer/chapter-03-prefetch' },
            { text: '消息 TTL', link: '/rabbitmq/05-consumer/chapter-04-message-ttl' },
            { text: '优先级队列', link: '/rabbitmq/05-consumer/chapter-05-priority-queue' },
          ],
        },
        {
          text: '集群',
          collapsed: true,
          items: [
            { text: '集群基础', link: '/rabbitmq/07-clustering/chapter-01-cluster-basics' },
            { text: '镜像队列', link: '/rabbitmq/07-clustering/chapter-02-mirrored-queue' },
            { text: 'Quorum 与 Raft', link: '/rabbitmq/07-clustering/chapter-03-quorum-raft' },
            { text: '网络分区', link: '/rabbitmq/07-clustering/chapter-04-network-partition' },
            { text: 'Federation 与 Shovel', link: '/rabbitmq/07-clustering/chapter-05-federation' },
          ],
        },
        {
          text: '运维管理',
          collapsed: true,
          items: [
            { text: '管理与监控', link: '/rabbitmq/08-operations/chapter-01-management' },
            { text: '安全配置', link: '/rabbitmq/08-operations/chapter-02-security' },
            { text: '常见问题', link: '/rabbitmq/08-operations/chapter-03-troubleshooting' },
            { text: '性能调优', link: '/rabbitmq/08-operations/chapter-04-performance-tuning' },
          ],
        },
        {
          text: 'Spring 集成',
          collapsed: true,
          items: [
            { text: 'Spring AMQP 集成', link: '/spring/07-async-and-messaging/chapter-04-messaging#rabbitmq-integration' },
          ],
        },
        {
          text: '实战',
          collapsed: true,
          items: [
            { text: '安装部署与环境配置', link: '/rabbitmq/10-practice/chapter-01-installation' },
            { text: '第一个 RabbitMQ 应用', link: '/rabbitmq/10-practice/chapter-02-first-app' },
            { text: '首次生产部署', link: '/rabbitmq/10-practice/chapter-03-first-production' },
            { text: '事件驱动架构', link: '/rabbitmq/10-practice/chapter-04-event-driven' },
            { text: '可靠性模式', link: '/rabbitmq/10-practice/chapter-05-reliability-patterns' },
            { text: '性能基准', link: '/rabbitmq/10-practice/chapter-06-performance-benchmark' },
          ],
        },
        {
          text: '参考手册',
          collapsed: true,
          items: [
            { text: '参数速查', link: '/rabbitmq/reference/parameters' },
            { text: '命令速查', link: '/rabbitmq/reference/commands' },
          ],
        },
      ],
      '/mysql/': [
        {
          text: '基础入门',
          collapsed: true,
          items: [
            { text: 'MySQL 概览', link: '/mysql/01-basics/chapter-01-overview' },
            { text: '整体架构', link: '/mysql/01-basics/chapter-02-architecture' },
            { text: '字符集与排序规则', link: '/mysql/01-basics/chapter-03-charset-collation' },
          ],
        },
        {
          text: 'InnoDB 内核',
          collapsed: true,
          items: [
            { text: '数据页与行格式', link: '/mysql/02-innodb-internals/chapter-01-data-page' },
            { text: 'Buffer Pool', link: '/mysql/02-innodb-internals/chapter-02-buffer-pool' },
            { text: '表空间', link: '/mysql/02-innodb-internals/chapter-03-tablespace' },
            { text: 'Redo Log', link: '/mysql/02-innodb-internals/chapter-04-redo-log' },
            { text: 'Undo Log', link: '/mysql/02-innodb-internals/chapter-05-undo-log' },
            { text: 'Binlog', link: '/mysql/02-innodb-internals/chapter-06-binlog' },
          ],
        },
        {
          text: '索引与查询优化',
          collapsed: true,
          items: [
            { text: 'B+ 树索引', link: '/mysql/03-index/chapter-01-btree-index' },
            { text: '索引设计', link: '/mysql/03-index/chapter-02-index-design' },
            { text: '索引失效', link: '/mysql/03-index/chapter-03-index-usage' },
            { text: '索引优化与治理', link: '/mysql/03-index/chapter-04-index-optimization' },
            { text: '全文索引', link: '/mysql/03-index/chapter-05-fulltext-index' },
            { text: '查询执行流程与 EXPLAIN', link: '/mysql/05-query-optimization/chapter-01-execution-plan' },
            { text: 'SQL 优化', link: '/mysql/05-query-optimization/chapter-02-sql-optimization' },
            { text: '连接优化', link: '/mysql/05-query-optimization/chapter-03-join-optimization' },
            { text: '子查询优化', link: '/mysql/05-query-optimization/chapter-04-subquery-optimization' },
          ],
        },
        {
          text: '事务与锁',
          collapsed: true,
          items: [
            { text: '事务与 MVCC', link: '/mysql/04-transaction-lock/chapter-01-transaction' },
            { text: '锁机制', link: '/mysql/04-transaction-lock/chapter-02-lock' },
            { text: '死锁', link: '/mysql/04-transaction-lock/chapter-03-deadlock' },
            { text: '锁选型：悲观锁 vs 乐观锁', link: '/mysql/04-transaction-lock/chapter-04-lock-selection' },
          ],
        },
        {
          text: 'SQL 高级特性',
          collapsed: true,
          items: [
            { text: '窗口函数', link: '/mysql/06-advanced-features/chapter-01-window-function' },
            { text: 'CTE', link: '/mysql/06-advanced-features/chapter-02-cte' },
            { text: 'JSON', link: '/mysql/06-advanced-features/chapter-03-json' },
            { text: '生成列', link: '/mysql/06-advanced-features/chapter-04-generated-column' },
            { text: '分区表', link: '/mysql/06-advanced-features/chapter-05-partition' },
            { text: '存储过程与触发器', link: '/mysql/06-advanced-features/chapter-06-stored-procedure' },
          ],
        },
        {
          text: '复制与高可用',
          collapsed: true,
          items: [
            { text: '异步复制', link: '/mysql/07-replication-ha/chapter-01-binlog-replication' },
            { text: 'GTID', link: '/mysql/07-replication-ha/chapter-02-gtid' },
            { text: '组复制', link: '/mysql/07-replication-ha/chapter-03-group-replication' },
            { text: '读写分离', link: '/mysql/07-replication-ha/chapter-04-read-write-split' },
            { text: '高可用方案', link: '/mysql/07-replication-ha/chapter-05-ha-solution' },
            { text: '分库分表', link: '/mysql/07-replication-ha/chapter-06-sharding' },
          ],
        },
        {
          text: '运维管理',
          collapsed: true,
          items: [
            { text: '备份恢复', link: '/mysql/08-operations/chapter-01-backup-restore' },
            { text: '监控', link: '/mysql/08-operations/chapter-02-monitoring' },
            { text: '安全与用户管理', link: '/mysql/08-operations/chapter-03-security' },
            { text: '日常维护', link: '/mysql/08-operations/chapter-04-maintenance' },
            { text: '连接管理', link: '/mysql/08-operations/chapter-05-connection-mgmt' },
            { text: '在线 DDL', link: '/mysql/08-operations/chapter-06-online-ddl' },
            { text: '数据迁移', link: '/mysql/08-operations/chapter-07-data-migration' },
          ],
        },
        {
          text: '实战',
          collapsed: true,
          items: [
            { text: '安装部署与环境配置', link: '/mysql/10-practice/chapter-01-installation' },
            { text: '首次生产部署', link: '/mysql/10-practice/chapter-02-first-production' },
            { text: 'Spring 集成', link: '/mysql/10-practice/chapter-03-spring-integration' },
            { text: '常见问题', link: '/mysql/10-practice/chapter-04-common-issues' },
            { text: '性能调优', link: '/mysql/10-practice/chapter-05-performance-tuning' },
            { text: 'SQL 规范与最佳实践', link: '/mysql/10-practice/chapter-06-sql-best-practices' },
          ],
        },
        {
          text: '参考手册',
          collapsed: true,
          items: [
            { text: '参数速查', link: '/mysql/reference/parameters' },
            { text: '数据类型速查', link: '/mysql/reference/types' },
            { text: '函数速查', link: '/mysql/reference/functions' },
            { text: '错误码速查', link: '/mysql/reference/errors' },
          ],
        },
      ],
      '/postgresql/': [
        {
          text: 'PG 到底特殊在哪',
          collapsed: true,
          items: [
            { text: '认识 PostgreSQL', link: '/postgresql/01-pg-unique/chapter-01-pg-overview' },
            { text: '类型系统', link: '/postgresql/01-pg-unique/chapter-02-type-system' },
            { text: 'MVCC 机制', link: '/postgresql/01-pg-unique/chapter-03-mvcc' },
            { text: 'VACUUM 机制', link: '/postgresql/01-pg-unique/chapter-04-vacuum' },
          ],
        },
        {
          text: '内部架构',
          collapsed: true,
          items: [
            { text: '进程与内存架构', link: '/postgresql/02-architecture/chapter-01-process-memory' },
            { text: 'WAL 日志与崩溃恢复', link: '/postgresql/02-architecture/chapter-02-wal' },
            { text: '数据页与存储结构', link: '/postgresql/02-architecture/chapter-03-data-page' },
            { text: 'Checkpoint 与脏页刷新', link: '/postgresql/02-architecture/chapter-04-checkpoint' },
          ],
        },
        {
          text: 'SQL 能力',
          collapsed: true,
          items: [
            { text: '窗口函数', link: '/postgresql/03-sql-power/chapter-01-window-function' },
            { text: 'CTE 与递归', link: '/postgresql/03-sql-power/chapter-02-cte-recursive' },
            { text: 'JSONB', link: '/postgresql/03-sql-power/chapter-03-jsonb' },
            { text: '全文搜索', link: '/postgresql/03-sql-power/chapter-04-full-text-search' },
            { text: 'PG 独有的 DML', link: '/postgresql/03-sql-power/chapter-05-returning-dml' },
          ],
        },
        {
          text: '索引深入',
          collapsed: true,
          items: [
            { text: '索引类型', link: '/postgresql/04-indexing/chapter-01-index-types' },
            { text: '索引设计', link: '/postgresql/04-indexing/chapter-02-index-design' },
            { text: 'EXPLAIN 深入', link: '/postgresql/04-indexing/chapter-03-explain' },
            { text: '表分区', link: '/postgresql/04-indexing/chapter-04-partitioning' },
          ],
        },
        {
          text: '事务与并发',
          collapsed: true,
          items: [
            { text: '隔离级别', link: '/postgresql/05-transactions/chapter-01-isolation-levels' },
            { text: '锁机制', link: '/postgresql/05-transactions/chapter-02-locking' },
            { text: '咨询锁', link: '/postgresql/05-transactions/chapter-03-advisory-lock' },
            { text: '并发实战', link: '/postgresql/05-transactions/chapter-04-concurrency-patterns' },
          ],
        },
        {
          text: '存储过程与触发器',
          collapsed: true,
          items: [
            { text: 'PL/pgSQL 基础', link: '/postgresql/06-plpgsql/chapter-01-plpgsql-basics' },
            { text: '触发器', link: '/postgresql/06-plpgsql/chapter-02-triggers' },
            { text: '什么时候用存储过程', link: '/postgresql/06-plpgsql/chapter-03-when-to-use' },
          ],
        },
        {
          text: '性能优化',
          collapsed: true,
          items: [
            { text: '配置调优', link: '/postgresql/07-performance/chapter-01-config-tuning' },
            { text: '查询优化', link: '/postgresql/07-performance/chapter-02-query-optimization' },
            { text: '扩展策略', link: '/postgresql/07-performance/chapter-03-scaling' },
          ],
        },
        {
          text: '监控体系',
          collapsed: true,
          items: [
            { text: '系统视图监控', link: '/postgresql/08-monitoring/chapter-01-pg-stat-views' },
            { text: 'pg_stat_statements', link: '/postgresql/08-monitoring/chapter-02-pg-stat-statements' },
            { text: 'Prometheus + Grafana', link: '/postgresql/08-monitoring/chapter-03-prometheus-grafana' },
            { text: '日志分析与审计', link: '/postgresql/08-monitoring/chapter-04-log-analysis' },
          ],
        },
        {
          text: '高可用与复制',
          collapsed: true,
          items: [
            { text: '流复制', link: '/postgresql/09-ha/chapter-01-streaming-replication' },
            { text: '逻辑复制', link: '/postgresql/09-ha/chapter-02-logical-replication' },
            { text: '高可用方案', link: '/postgresql/09-ha/chapter-03-ha-solutions' },
            { text: '备份恢复', link: '/postgresql/09-ha/chapter-04-backup-restore' },
          ],
        },
        {
          text: '扩展与生态',
          collapsed: true,
          items: [
            { text: '扩展机制', link: '/postgresql/10-ecosystem/chapter-01-extension-system' },
            { text: 'FDW 外部数据', link: '/postgresql/10-ecosystem/chapter-02-fdw' },
            { text: '专业扩展（PostGIS/TimescaleDB/pgvector）', link: '/postgresql/10-ecosystem/chapter-03-specialized' },
          ],
        },
        {
          text: '安全与运维',
          collapsed: true,
          items: [
            { text: '用户与安全', link: '/postgresql/11-ops/chapter-01-user-security' },
            { text: '日常维护', link: '/postgresql/11-ops/chapter-02-maintenance' },
            { text: '数据迁移', link: '/postgresql/11-ops/chapter-03-migration' },
          ],
        },
        {
          text: '生产避坑指南',
          collapsed: true,
          items: [
            { text: '事务 ID 回卷', link: '/postgresql/12-production-pitfalls/chapter-01-xid-wraparound' },
            { text: '表膨胀检测与治理', link: '/postgresql/12-production-pitfalls/chapter-02-table-bloat' },
            { text: '执行计划翻转', link: '/postgresql/12-production-pitfalls/chapter-03-plan-flip' },
            { text: '锁等待排查', link: '/postgresql/12-production-pitfalls/chapter-04-lock-troubleshooting' },
          ],
        },
        {
          text: '参考手册',
          collapsed: true,
          items: [
            { text: '参数速查', link: '/postgresql/reference/parameters' },
            { text: '类型速查', link: '/postgresql/reference/types' },
            { text: '函数速查', link: '/postgresql/reference/functions' },
            { text: '错误码速查', link: '/postgresql/reference/errors' },
          ],
        },
        {
          text: '教程',
          collapsed: true,
          items: [
            { text: '安装部署与环境配置', link: '/postgresql/tutorials/installation' },
            { text: '第一个数据库', link: '/postgresql/tutorials/first-db' },
            { text: 'MySQL 转 PG', link: '/postgresql/tutorials/mysql-to-pg' },
            { text: '首次生产部署', link: '/postgresql/tutorials/first-production' },
          ],
        },
      ],
      '/redis/': [
        {
          text: '数据模型',
          collapsed: true,
          items: [
            { text: '概览', link: '/redis/01-data-model/chapter-01-overview' },
            { text: '基础类型', link: '/redis/01-data-model/chapter-02-basic-types' },
            { text: '高级类型', link: '/redis/01-data-model/chapter-03-advanced-types' },
            { text: '数据结构', link: '/redis/01-data-model/chapter-04-data-structures' },
            { text: '对象编码', link: '/redis/01-data-model/chapter-05-object-encoding' },
            { text: '线上问题案例集', link: '/redis/01-data-model/chapter-06-production-cases' },
          ],
        },
        {
          text: '单机核心',
          collapsed: true,
          items: [
            { text: '线程模型', link: '/redis/02-standalone-core/chapter-01-thread-model' },
            { text: '命令与 RESP', link: '/redis/02-standalone-core/chapter-02-command-resp' },
            { text: '事务与 Lua', link: '/redis/02-standalone-core/chapter-03-transaction-lua' },
            { text: 'Pipeline 与 Pub/Sub', link: '/redis/02-standalone-core/chapter-04-pipeline-pubsub' },
            { text: '持久化 RDB 与 AOF', link: '/redis/02-standalone-core/chapter-05-persistence' },
            { text: '过期与淘汰', link: '/redis/02-standalone-core/chapter-06-expiration-eviction' },
            { text: '线上问题案例集', link: '/redis/02-standalone-core/chapter-07-production-cases' },
          ],
        },
        {
          text: '缓存工程',
          collapsed: true,
          items: [
            { text: '缓存工程场景', link: '/scenarios/01-cache/' },
          ],
        },
        {
          text: '高可用',
          collapsed: true,
          items: [
            { text: '主从复制', link: '/redis/04-high-availability/chapter-01-replication' },
            { text: '哨兵', link: '/redis/04-high-availability/chapter-02-sentinel' },
            { text: '集群', link: '/redis/04-high-availability/chapter-03-cluster' },
            { text: '线上问题案例集', link: '/redis/04-high-availability/chapter-04-production-cases' },
          ],
        },
        {
          text: '运维管理',
          collapsed: true,
          items: [
            { text: '性能', link: '/redis/05-operations/chapter-01-performance' },
            { text: '排障', link: '/redis/05-operations/chapter-02-troubleshooting' },
            { text: '监控', link: '/redis/05-operations/chapter-03-monitoring' },
            { text: '踩坑', link: '/redis/05-operations/chapter-04-pitfalls' },
          ],
        },
        {
          text: '实战',
          collapsed: true,
          items: [
            { text: '安装部署与环境配置', link: '/redis/10-practice/chapter-01-installation' },
            { text: '第一个 Redis 应用', link: '/redis/10-practice/chapter-02-first-app' },
            { text: '首次生产部署', link: '/redis/10-practice/chapter-03-first-production' },
          ],
        },
        {
          text: '参考手册',
          collapsed: true,
          items: [
            { text: '参数速查', link: '/redis/reference/parameters' },
            { text: '命令速查', link: '/redis/reference/commands' },
            { text: '错误码速查', link: '/redis/reference/errors' },
          ],
        },
      ],
      '/spring/': [
        { text: 'Spring 概览', link: '/spring/01-core/chapter-01-spring-overview' },
        {
          text: '核心原理',
          collapsed: true,
          items: [
            { text: 'IoC 容器', link: '/spring/01-core/chapter-02-ioc-container' },
            { text: 'Bean 完整生命周期', link: '/spring/01-core/chapter-03-bean-lifecycle' },
            { text: '依赖注入', link: '/spring/01-core/chapter-04-dependency-injection' },
            { text: 'AOP 面向切面编程', link: '/spring/01-core/chapter-05-aop' },
            { text: '循环依赖与三级缓存', link: '/spring/01-core/chapter-06-circular-dependency' },
            { text: '条件装配与 Profile', link: '/spring/01-core/chapter-07-conditional-profile' },
            { text: '踩坑案例集', link: '/spring/01-core/chapter-08-pitfalls-and-cases' },
          ],
        },
        {
          text: 'Spring Boot',
          collapsed: true,
          items: [
            { text: '自动配置原理', link: '/spring/02-spring-boot/chapter-01-autoconfiguration' },
            { text: 'Starter 机制', link: '/spring/02-spring-boot/chapter-02-starter' },
            { text: '外部化配置', link: '/spring/02-spring-boot/chapter-03-configuration' },
            { text: '内嵌容器', link: '/spring/02-spring-boot/chapter-04-embedded-server' },
            { text: '启动流程与启动参数', link: '/spring/02-spring-boot/chapter-05-startup' },
            { text: 'Actuator 监控', link: '/spring/02-spring-boot/chapter-06-actuator' },
            { text: 'DevTools 热部署', link: '/spring/02-spring-boot/chapter-07-devtools' },
          ],
        },
        {
          text: 'Web 开发',
          collapsed: true,
          items: [
            { text: 'Spring MVC', link: '/spring/03-web/chapter-01-spring-mvc' },
            { text: '全局异常处理', link: '/spring/03-web/chapter-03-global-exception' },
            { text: '参数校验与数据绑定', link: '/spring/03-web/chapter-04-validation-binding' },
            { text: '拦截器与过滤器', link: '/spring/03-web/chapter-05-interceptor-filter' },
            { text: 'WebFlux 响应式编程', link: '/spring/03-web/chapter-06-webflux' },
            { text: 'WebSocket 实时通信', link: '/spring/03-web/chapter-07-websocket' },
            { text: 'Server-Sent Events', link: '/spring/03-web/chapter-08-sse' },
            { text: '文件上传与下载', link: '/spring/03-web/chapter-09-file-upload-download' },
            { text: 'API 文档', link: '/spring/03-web/chapter-10-api-doc' },
          ],
        },
        {
          text: '数据访问',
          collapsed: true,
          items: [
            { text: 'JdbcTemplate', link: '/spring/04-data-access/chapter-01-jdbc-template' },
            { text: 'MyBatis 集成', link: '/spring/04-data-access/chapter-02-mybatis-integration' },
            { text: 'Spring Data JPA', link: '/spring/04-data-access/chapter-03-jpa' },
            { text: '事务管理', link: '/spring/04-data-access/chapter-04-transaction' },
            { text: 'MyBatis vs JPA 选型', link: '/spring/04-data-access/chapter-05-mybatis-vs-jpa' },
            { text: '多数据源', link: '/spring/04-data-access/chapter-06-multi-datasource' },
            { text: '数据库迁移', link: '/spring/04-data-access/chapter-07-flyway-liquibase' },
            { text: '响应式数据访问', link: '/spring/04-data-access/chapter-08-r2dbc' },
            { text: 'Elasticsearch 集成', link: '/spring/04-data-access/chapter-09-elasticsearch-integration' },
            { text: 'Redis 集成', link: '/spring/04-data-access/chapter-10-redis-integration' },
            { text: '缓存抽象', link: '/spring/04-data-access/chapter-11-caching' },
          ],
        },
        {
          text: '安全',
          collapsed: true,
          items: [
            { text: '安全架构', link: '/spring/05-security/chapter-01-security-architecture' },
            { text: '认证机制', link: '/spring/05-security/chapter-02-authentication' },
            { text: '授权模型', link: '/spring/05-security/chapter-03-authorization' },
            { text: '安全最佳实践', link: '/spring/05-security/chapter-04-security-practice' },
          ],
        },
        {
          text: '可观测性',
          collapsed: true,
          items: [
            { text: '日志体系', link: '/spring/06-observability/chapter-01-logging' },
            { text: '指标监控', link: '/spring/06-observability/chapter-02-metrics' },
            { text: '链路追踪', link: '/spring/06-observability/chapter-03-tracing' },
            { text: '生产问题排查', link: '/spring/06-observability/chapter-04-production-debug' },
          ],
        },
        {
          text: '异步与消息',
          collapsed: true,
          items: [
            { text: '事件机制', link: '/spring/07-async-and-messaging/chapter-01-event' },
            { text: '异步处理', link: '/spring/07-async-and-messaging/chapter-02-async' },
            { text: '定时任务', link: '/spring/07-async-and-messaging/chapter-03-scheduling' },
            { text: '消息集成', link: '/spring/07-async-and-messaging/chapter-04-messaging' },
          ],
        },
        {
          text: '测试',
          collapsed: true,
          items: [
            { text: '单元测试', link: '/spring/08-testing/chapter-01-unit-test' },
            { text: '集成测试', link: '/spring/08-testing/chapter-02-integration-test' },
            { text: 'Testcontainers 与数据库测试', link: '/spring/08-testing/chapter-03-testcontainers' },
            { text: 'API 测试与契约测试', link: '/spring/08-testing/chapter-04-api-test' },
          ],
        },
        {
          text: '分布式系统',
          collapsed: true,
          items: [
            { text: '分布式锁', link: '/spring/09-distributed/chapter-01-distributed-lock' },
            { text: '分布式事务', link: '/spring/09-distributed/chapter-02-distributed-transaction' },
            { text: '服务调用', link: '/spring/09-distributed/chapter-03-service-call' },
            { text: '服务容错', link: '/spring/09-distributed/chapter-04-circuit-breaker' },
            { text: '配置中心', link: '/spring/09-distributed/chapter-05-config-center' },
            { text: 'API 网关', link: '/spring/09-distributed/chapter-06-api-gateway' },
          ],
        },
        {
          text: '生产化',
          collapsed: true,
          items: [
            { text: '连接池与容器调优', link: '/spring/10-production/chapter-01-pool-tuning' },
            { text: '容器化部署', link: '/spring/10-production/chapter-02-containerization' },
            { text: 'GraalVM 原生镜像', link: '/spring/10-production/chapter-03-graalvm' },
            { text: 'JVM 调优', link: '/spring/10-production/chapter-05-jvm-tuning' },
          ],
        },
        {
          text: '实战',
          collapsed: true,
          items: [
            { text: '构建与部署', link: '/spring/11-practice/chapter-01-build-deploy' },
            { text: '第一个 Spring Boot 应用', link: '/spring/11-practice/chapter-02-first-app' },
            { text: '首次生产部署', link: '/spring/11-practice/chapter-03-first-production' },
            { text: 'AOP 实战：切点表达式与自定义注解', link: '/spring/11-practice/chapter-04-aop-in-action' },
          ],
        },
        {
          text: '参考手册',
          collapsed: true,
          items: [
            { text: '注解速查', link: '/spring/reference/annotations' },
            { text: 'Starter 速查', link: '/spring/reference/starters' },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/b1tzer/the-stack' }
    ],
    
    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2024-2026 b1tzer'
    },
    
    search: {
      provider: 'local'
    }
  }
})))
