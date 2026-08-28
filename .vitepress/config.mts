import { defineConfig } from 'vitepress'
import { svgEditorPlugin, svgDiagramMarkdownPlugin } from 'vitepress-plugin-svg-editor'
import { withOpenInEditor } from 'vitepress-plugin-open-in-editor'

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
      { text: 'Java', link: '/java/01-java-language/chapter-01-type-system' },
      { text: 'Spring', link: '/spring/01-core/chapter-01-spring-overview' },
      { text: 'Redis', link: '/redis/01-data-model/chapter-01-overview' },
      { text: '更多', items: [
        { text: 'PostgreSQL', link: '/postgresql/01-pg-unique/chapter-01-why-pg' },
        { text: 'MySQL', link: '/mysql/01-basics/chapter-01-overview' },
        { text: 'Kafka', link: '/kafka/01-basics/chapter-01-overview' },
        { text: 'Elasticsearch', link: '/elasticsearch/01-basics/chapter-01-overview' },
        { text: '设计模式', link: '/design-pattern/00-intro/chapter-01-why-patterns' },
        { text: '软件工程', link: '/engineering/01-principles/chapter-01-overview' },
        { text: 'AI 工程', link: '/ai/01-LLM接口与提示词工程' },
      ]
      },
    ],

    sidebar: {
      '/ai/': [
        {
          text: 'AI 工程',
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
          items: [
            { text: '为什么需要设计模式', link: '/design-pattern/00-intro/chapter-01-why-patterns' },
          ],
        },
        {
          text: '创建型',
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
          items: [
            { text: 'Spring 中的模式', link: '/design-pattern/04-practice/chapter-01-spring-patterns' },
            { text: 'JDK 中的模式', link: '/design-pattern/04-practice/chapter-02-jdk-patterns' },
            { text: '重构到模式', link: '/design-pattern/04-practice/chapter-03-refactoring-to-patterns' },
            { text: '反模式', link: '/design-pattern/04-practice/chapter-04-anti-patterns' },
          ],
        },
      ],
      '/elasticsearch/': [
        {
          text: '基础入门',
          items: [
            { text: 'ES 概览', link: '/elasticsearch/01-basics/chapter-01-overview' },
            { text: '安装部署', link: '/elasticsearch/01-basics/chapter-02-install-config' },
            { text: '核心概念', link: '/elasticsearch/01-basics/chapter-03-core-concepts' },
            { text: 'REST API', link: '/elasticsearch/01-basics/chapter-04-rest-api' },
          ],
        },
        {
          text: '索引与映射',
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
          items: [
            { text: '指标聚合', link: '/elasticsearch/04-aggregation/chapter-01-metrics-agg' },
            { text: '桶聚合', link: '/elasticsearch/04-aggregation/chapter-02-bucket-agg' },
            { text: '管道聚合', link: '/elasticsearch/04-aggregation/chapter-03-pipeline-agg' },
            { text: '聚合优化', link: '/elasticsearch/04-aggregation/chapter-04-agg-optimization' },
          ],
        },
        {
          text: '分布式原理',
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
          items: [
            { text: '建模原则', link: '/elasticsearch/06-data-modeling/chapter-01-modeling-principles' },
            { text: 'Nested vs Join', link: '/elasticsearch/06-data-modeling/chapter-02-nested-vs-join' },
            { text: '反规范化', link: '/elasticsearch/06-data-modeling/chapter-03-denormalization' },
            { text: '时序数据', link: '/elasticsearch/06-data-modeling/chapter-04-time-series' },
          ],
        },
        {
          text: '运维管理',
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
          items: [
            { text: '索引优化', link: '/elasticsearch/08-performance/chapter-01-index-optimization' },
            { text: '查询优化', link: '/elasticsearch/08-performance/chapter-02-query-optimization' },
            { text: 'JVM 调优', link: '/elasticsearch/08-performance/chapter-03-jvm-tuning' },
            { text: '硬件选型', link: '/elasticsearch/08-performance/chapter-04-hardware' },
          ],
        },
        {
          text: '生态工具',
          items: [
            { text: 'ELK Stack', link: '/elasticsearch/09-ecosystem/chapter-01-elk' },
            { text: 'Beats', link: '/elasticsearch/09-ecosystem/chapter-02-beats' },
            { text: 'APM', link: '/elasticsearch/09-ecosystem/chapter-03-apm' },
            { text: '向量搜索', link: '/elasticsearch/09-ecosystem/chapter-04-vector-search' },
          ],
        },
        {
          text: '实战场景',
          items: [
            { text: 'Spring 集成', link: '/elasticsearch/10-practice/chapter-01-spring-integration' },
            { text: '日志分析', link: '/elasticsearch/10-practice/chapter-02-log-analysis' },
            { text: '搜索引擎', link: '/elasticsearch/10-practice/chapter-03-search-engine' },
            { text: '数据同步', link: '/elasticsearch/10-practice/chapter-04-data-sync' },
          ],
        },
      ],
      '/engineering/': [
        {
          text: '设计原则',
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
          items: [
            { text: '创建型', link: '/engineering/02-design-patterns/chapter-01-creational' },
            { text: '结构型', link: '/engineering/02-design-patterns/chapter-02-structural' },
            { text: '行为型', link: '/engineering/02-design-patterns/chapter-03-behavioral' },
            { text: '模式实践', link: '/engineering/02-design-patterns/chapter-04-pattern-practice' },
          ],
        },
        {
          text: '架构设计',
          items: [
            { text: '架构风格', link: '/engineering/03-architecture/chapter-01-architecture-styles' },
            { text: '整洁架构', link: '/engineering/03-architecture/chapter-02-clean-architecture' },
            { text: '微服务', link: '/engineering/03-architecture/chapter-03-microservices' },
            { text: '单体架构', link: '/engineering/03-architecture/chapter-04-monolith' },
            { text: '事件驱动', link: '/engineering/03-architecture/chapter-05-event-driven' },
            { text: '架构决策', link: '/engineering/03-architecture/chapter-06-architecture-decision' },
          ],
        },
        {
          text: 'DDD',
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
          items: [
            { text: '敏捷', link: '/engineering/08-project-management/chapter-01-agile' },
            { text: '需求分析', link: '/engineering/08-project-management/chapter-02-requirements' },
            { text: '估算', link: '/engineering/08-project-management/chapter-03-estimation' },
            { text: '技术债务', link: '/engineering/08-project-management/chapter-04-technical-debt' },
          ],
        },
        {
          text: '实战场景',
          items: [
            { text: 'API 设计', link: '/engineering/09-practice/chapter-01-api-design' },
            { text: '数据建模', link: '/engineering/09-practice/chapter-02-data-modeling' },
            { text: '性能调优', link: '/engineering/09-practice/chapter-03-performance-tuning' },
            { text: '案例分析', link: '/engineering/09-practice/chapter-04-case-studies' },
          ],
        },
      ],
      '/java/': [
        {
          text: 'Java 语言',
          items: [
            { text: '类型系统', link: '/java/01-java-language/chapter-01-type-system' },
            { text: '面向对象', link: '/java/01-java-language/chapter-02-oop' },
            { text: '泛型', link: '/java/01-java-language/chapter-03-generics' },
            { text: '注解与 Lambda', link: '/java/01-java-language/chapter-04-annotation-lambda' },
          ],
        },
        {
          text: 'JVM Runtime',
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
            { text: '案例集：死锁、线程池与虚拟线程', link: '/java/03-java-concurrency/chapter-13-diagnostics-cases' },
          ],
        },
        {
          text: '网络与通信',
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
          items: [
            { text: '持久化思想', link: '/java/05-java-data-access/chapter-01-persistence-thought' },
            { text: 'JDBC', link: '/java/05-java-data-access/chapter-02-jdbc' },
            { text: 'MyBatis', link: '/java/05-java-data-access/chapter-03-mybatis' },
            { text: 'ORM 深入', link: '/java/05-java-data-access/chapter-04-orm-deep' },
            { text: '数据库核心原理', link: '/java/05-java-data-access/chapter-05-db-principles' },
            { text: 'Spring 事务', link: '/java/05-java-data-access/chapter-06-spring-transaction' },
            { text: '性能优化', link: '/java/05-java-data-access/chapter-07-performance' },
          ],
        },
        {
          text: '企业架构',
          items: [
            { text: '企业系统部署', link: '/java/06-java-enterprise/chapter-08-security-deploy' },
            { text: '可观测性', link: '/java/06-java-enterprise/chapter-09-observability' },
          ],
        },
        {
          text: '性能与架构',
          items: [
            { text: '性能工程', link: '/java/07-performance-architecture/chapter-08-performance' },
            { text: '架构案例', link: '/java/07-performance-architecture/chapter-09-case-studies' },
          ],
        },
      ],
      '/kafka/': [
        {
          text: '基础入门',
          items: [
            { text: 'Kafka 概览', link: '/kafka/01-basics/chapter-01-overview' },
            { text: '核心术语', link: '/kafka/01-basics/chapter-02-terminology' },
            { text: '整体架构', link: '/kafka/01-basics/chapter-03-architecture' },
            { text: '消息队列选型', link: '/kafka/01-basics/chapter-04-mq-comparison' },
          ],
        },
        {
          text: '生产者',
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
          items: [
            { text: '消费者 API', link: '/kafka/03-consumer/chapter-01-consumer-basics' },
            { text: '消费者组', link: '/kafka/03-consumer/chapter-02-consumer-group' },
            { text: 'Offset 管理', link: '/kafka/03-consumer/chapter-03-offset-management' },
            { text: 'Rebalance 策略', link: '/kafka/03-consumer/chapter-04-rebalance-strategy' },
            { text: '消费者优化', link: '/kafka/03-consumer/chapter-05-consumer-optimization' },
          ],
        },
        {
          text: '存储原理',
          items: [
            { text: '日志分段', link: '/kafka/04-storage-internals/chapter-01-log-segment' },
            { text: 'Page Cache', link: '/kafka/04-storage-internals/chapter-02-page-cache' },
            { text: '副本机制', link: '/kafka/04-storage-internals/chapter-03-replication' },
            { text: 'Controller', link: '/kafka/04-storage-internals/chapter-04-controller' },
            { text: 'KRaft', link: '/kafka/04-storage-internals/chapter-05-kraft' },
          ],
        },
        {
          text: '可靠性',
          items: [
            { text: 'ACK 机制', link: '/kafka/05-reliability/chapter-01-acks-机制' },
            { text: 'Exactly Once', link: '/kafka/05-reliability/chapter-02-exactly-once' },
            { text: '消息顺序', link: '/kafka/05-reliability/chapter-03-message-ordering' },
            { text: '数据保留', link: '/kafka/05-reliability/chapter-04-data-retention' },
          ],
        },
        {
          text: '流处理',
          items: [
            { text: 'Streams 概览', link: '/kafka/06-streams/chapter-01-streams-basics' },
            { text: '流操作', link: '/kafka/06-streams/chapter-02-stream-operations' },
            { text: '窗口操作', link: '/kafka/06-streams/chapter-03-windowing' },
            { text: '状态存储', link: '/kafka/06-streams/chapter-04-state-store' },
            { text: 'Streams Exactly Once', link: '/kafka/06-streams/chapter-05-exactly-once-streams' },
          ],
        },
        {
          text: 'Connect',
          items: [
            { text: 'Connect 概览', link: '/kafka/07-connect/chapter-01-connect-basics' },
            { text: '连接器配置', link: '/kafka/07-connect/chapter-02-connect-config' },
            { text: '常用插件', link: '/kafka/07-connect/chapter-03-connect-plugins' },
            { text: 'Connect 监控', link: '/kafka/07-connect/chapter-04-connect-monitoring' },
          ],
        },
        {
          text: '运维管理',
          items: [
            { text: '集群管理', link: '/kafka/08-operations/chapter-01-cluster-management' },
            { text: '监控', link: '/kafka/08-operations/chapter-02-monitoring' },
            { text: '安全', link: '/kafka/08-operations/chapter-03-security' },
            { text: '跨集群镜像', link: '/kafka/08-operations/chapter-04-mirror' },
            { text: '常见问题', link: '/kafka/08-operations/chapter-05-troubleshooting' },
          ],
        },
        {
          text: '实战场景',
          items: [
            { text: 'Spring 集成', link: '/kafka/09-practice/chapter-01-spring-integration' },
            { text: '常见场景', link: '/kafka/09-practice/chapter-02-common-patterns' },
            { text: '性能调优', link: '/kafka/09-practice/chapter-03-performance-tuning' },
          ],
        },
      ],
      '/mysql/': [
        {
          text: '基础入门',
          items: [
            { text: 'MySQL 概览', link: '/mysql/01-basics/chapter-01-overview' },
            { text: '安装部署', link: '/mysql/01-basics/chapter-02-install-config' },
            { text: 'SQL 基础', link: '/mysql/01-basics/chapter-03-sql-basics' },
            { text: '整体架构', link: '/mysql/01-basics/chapter-04-architecture' },
            { text: '字符集与排序规则', link: '/mysql/01-basics/chapter-05-charset-collation' },
            { text: 'SQL 规范与最佳实践', link: '/mysql/01-basics/chapter-06-sql-best-practices' },
          ],
        },
        {
          text: 'InnoDB 内核',
          items: [
            { text: 'Buffer Pool', link: '/mysql/02-innodb-internals/chapter-01-buffer-pool' },
            { text: '数据页与行格式', link: '/mysql/02-innodb-internals/chapter-02-data-page' },
            { text: '表空间', link: '/mysql/02-innodb-internals/chapter-03-tablespace' },
            { text: 'Redo Log', link: '/mysql/02-innodb-internals/chapter-04-redo-log' },
            { text: 'Undo Log', link: '/mysql/02-innodb-internals/chapter-05-undo-log' },
          ],
        },
        {
          text: '索引',
          items: [
            { text: 'B+ 树索引', link: '/mysql/03-index/chapter-01-btree-index' },
            { text: '索引设计', link: '/mysql/03-index/chapter-02-index-design' },
            { text: '索引使用', link: '/mysql/03-index/chapter-03-index-usage' },
            { text: '索引优化', link: '/mysql/03-index/chapter-04-index-optimization' },
          ],
        },
        {
          text: '事务与锁',
          items: [
            { text: '事务与 MVCC', link: '/mysql/04-transaction-lock/chapter-01-transaction' },
            { text: '锁机制', link: '/mysql/04-transaction-lock/chapter-02-lock' },
            { text: '死锁', link: '/mysql/04-transaction-lock/chapter-03-deadlock' },
            { text: '乐观锁', link: '/mysql/04-transaction-lock/chapter-04-optimistic-lock' },
            { text: '锁选型：悲观锁 vs 乐观锁', link: '/mysql/04-transaction-lock/chapter-05-lock-selection' },
          ],
        },
        {
          text: '查询优化',
          items: [
            { text: '查询执行流程', link: '/mysql/05-query-optimization/chapter-01-execution-plan' },
            { text: 'EXPLAIN', link: '/mysql/05-query-optimization/chapter-02-explain' },
            { text: 'SQL 优化', link: '/mysql/05-query-optimization/chapter-03-sql-optimization' },
            { text: '连接优化', link: '/mysql/05-query-optimization/chapter-04-join-optimization' },
            { text: '子查询优化', link: '/mysql/05-query-optimization/chapter-05-subquery-optimization' },
          ],
        },
        {
          text: '高级特性',
          items: [
            { text: '窗口函数', link: '/mysql/06-advanced-features/chapter-01-window-function' },
            { text: 'CTE', link: '/mysql/06-advanced-features/chapter-02-cte' },
            { text: '生成列', link: '/mysql/06-advanced-features/chapter-03-generated-column' },
            { text: 'JSON', link: '/mysql/06-advanced-features/chapter-04-json' },
            { text: '分区表', link: '/mysql/06-advanced-features/chapter-05-partition' },
            { text: '全文索引', link: '/mysql/06-advanced-features/chapter-06-fulltext-index' },
            { text: '存储过程与触发器', link: '/mysql/06-advanced-features/chapter-07-stored-procedure' },
          ],
        },
        {
          text: '复制与高可用',
          items: [
            { text: 'Binlog', link: '/mysql/07-replication-ha/chapter-00-binlog' },
            { text: '异步复制', link: '/mysql/07-replication-ha/chapter-01-binlog-replication' },
            { text: 'GTID', link: '/mysql/07-replication-ha/chapter-02-gtid' },
            { text: '组复制', link: '/mysql/07-replication-ha/chapter-03-group-replication' },
            { text: '读写分离', link: '/mysql/07-replication-ha/chapter-04-read-write-split' },
            { text: '高可用方案', link: '/mysql/07-replication-ha/chapter-05-ha-solution' },
          ],
        },
        {
          text: '运维管理',
          items: [
            { text: '备份恢复', link: '/mysql/08-operations/chapter-01-backup-restore' },
            { text: '监控', link: '/mysql/08-operations/chapter-02-monitoring' },
            { text: '安全', link: '/mysql/08-operations/chapter-03-security' },
            { text: '用户管理', link: '/mysql/08-operations/chapter-04-user-management' },
            { text: '日常维护', link: '/mysql/08-operations/chapter-05-maintenance' },
            { text: '连接管理', link: '/mysql/08-operations/chapter-06-connection-mgmt' },
          ],
        },
        {
          text: '扩展架构',
          items: [
            { text: '分库分表', link: '/mysql/09-scaling/chapter-01-sharding' },
            { text: '在线 DDL', link: '/mysql/09-scaling/chapter-02-online-ddl' },
            { text: '数据迁移', link: '/mysql/09-scaling/chapter-03-data-migration' },
            { text: 'NewSQL', link: '/mysql/09-scaling/chapter-04-newsql' },
          ],
        },
        {
          text: '实战场景',
          items: [
            { text: 'Spring 集成', link: '/mysql/10-practice/chapter-01-spring-integration' },
            { text: '常见问题', link: '/mysql/10-practice/chapter-02-common-issues' },
            { text: '性能调优', link: '/mysql/10-practice/chapter-03-performance-tuning' },
          ],
        },
      ],
      '/postgresql/': [
        {
          text: '快速上手',
          items: [
            { text: '安装部署与环境配置', link: '/postgresql/00-quick-start/chapter-01-install' },
            { text: '第一个数据库', link: '/postgresql/00-quick-start/chapter-02-first-db' },
          ],
        },
        {
          text: 'PG 到底特殊在哪',
          items: [
            { text: '为什么选 PG', link: '/postgresql/01-pg-unique/chapter-01-why-pg' },
            { text: 'MVCC 机制', link: '/postgresql/01-pg-unique/chapter-02-mvcc' },
            { text: 'VACUUM 机制', link: '/postgresql/01-pg-unique/chapter-03-vacuum' },
            { text: '类型系统', link: '/postgresql/01-pg-unique/chapter-04-type-system' },
          ],
        },
        {
          text: '内部架构',
          items: [
            { text: '进程与内存架构', link: '/postgresql/02-architecture/chapter-01-process-memory' },
            { text: '数据页与存储结构', link: '/postgresql/02-architecture/chapter-02-data-page' },
            { text: 'WAL 日志与崩溃恢复', link: '/postgresql/02-architecture/chapter-03-wal' },
            { text: 'Checkpoint 与脏页刷新', link: '/postgresql/02-architecture/chapter-04-checkpoint' },
          ],
        },
        {
          text: 'SQL 能力',
          items: [
            { text: '窗口函数', link: '/postgresql/02-sql-power/chapter-01-window-function' },
            { text: 'CTE 与递归', link: '/postgresql/02-sql-power/chapter-02-cte-recursive' },
            { text: 'JSONB', link: '/postgresql/02-sql-power/chapter-03-jsonb' },
            { text: '全文搜索', link: '/postgresql/02-sql-power/chapter-04-full-text-search' },
            { text: 'PG 独有的 DML', link: '/postgresql/02-sql-power/chapter-05-returning-dml' },
          ],
        },
        {
          text: '索引深入',
          items: [
            { text: '索引类型', link: '/postgresql/03-indexing/chapter-01-index-types' },
            { text: '索引设计', link: '/postgresql/03-indexing/chapter-02-index-design' },
            { text: 'EXPLAIN 深入', link: '/postgresql/03-indexing/chapter-03-explain' },
            { text: '表分区', link: '/postgresql/03-indexing/chapter-04-partitioning' },
          ],
        },
        {
          text: '事务与并发',
          items: [
            { text: '隔离级别', link: '/postgresql/04-transactions/chapter-01-isolation-levels' },
            { text: '锁机制', link: '/postgresql/04-transactions/chapter-02-locking' },
            { text: '咨询锁', link: '/postgresql/04-transactions/chapter-03-advisory-lock' },
            { text: '并发实战', link: '/postgresql/04-transactions/chapter-04-concurrency-patterns' },
          ],
        },
        {
          text: '存储过程与触发器',
          items: [
            { text: 'PL/pgSQL 基础', link: '/postgresql/05-plpgsql/chapter-01-plpgsql-basics' },
            { text: '触发器', link: '/postgresql/05-plpgsql/chapter-02-triggers' },
            { text: '什么时候用存储过程', link: '/postgresql/05-plpgsql/chapter-03-when-to-use' },
          ],
        },
        {
          text: '性能优化',
          items: [
            { text: '配置调优', link: '/postgresql/06-performance/chapter-01-config-tuning' },
            { text: '查询优化', link: '/postgresql/06-performance/chapter-02-query-optimization' },
            { text: '扩展策略', link: '/postgresql/06-performance/chapter-04-scaling' },
          ],
        },
        {
          text: '监控体系',
          items: [
            { text: '系统视图监控', link: '/postgresql/11-monitoring/chapter-01-pg-stat-views' },
            { text: 'pg_stat_statements', link: '/postgresql/11-monitoring/chapter-02-pg-stat-statements' },
            { text: 'Prometheus + Grafana', link: '/postgresql/11-monitoring/chapter-03-prometheus-grafana' },
            { text: '日志分析与审计', link: '/postgresql/11-monitoring/chapter-04-log-analysis' },
          ],
        },
        {
          text: '高可用与复制',
          items: [
            { text: '流复制', link: '/postgresql/07-ha/chapter-01-streaming-replication' },
            { text: '逻辑复制', link: '/postgresql/07-ha/chapter-02-logical-replication' },
            { text: '高可用方案', link: '/postgresql/07-ha/chapter-03-ha-solutions' },
            { text: '备份恢复', link: '/postgresql/07-ha/chapter-04-backup-restore' },
          ],
        },
        {
          text: '扩展与生态',
          items: [
            { text: '扩展机制', link: '/postgresql/08-ecosystem/chapter-01-extension-system' },
            { text: 'FDW 外部数据', link: '/postgresql/08-ecosystem/chapter-02-fdw' },
            { text: '专业扩展（PostGIS/TimescaleDB/pgvector）', link: '/postgresql/08-ecosystem/chapter-03-specialized' },
          ],
        },
        {
          text: '安全与运维',
          items: [
            { text: '用户与安全', link: '/postgresql/09-ops/chapter-01-user-security' },
            { text: '日常维护', link: '/postgresql/09-ops/chapter-02-maintenance' },
            { text: '数据迁移', link: '/postgresql/09-ops/chapter-03-migration' },
          ],
        },
        {
          text: '生产避坑指南',
          items: [
            { text: '事务 ID 回卷', link: '/postgresql/12-production-pitfalls/chapter-01-xid-wraparound' },
            { text: '表膨胀检测与治理', link: '/postgresql/12-production-pitfalls/chapter-02-table-bloat' },
            { text: '执行计划翻转', link: '/postgresql/12-production-pitfalls/chapter-03-plan-flip' },
            { text: '锁等待排查', link: '/postgresql/12-production-pitfalls/chapter-04-lock-troubleshooting' },
          ],
        },
        {
          text: '实战项目',
          items: [
            { text: '电商订单系统设计', link: '/postgresql/13-projects/chapter-01-ecommerce' },
            { text: '读写分离架构搭建', link: '/postgresql/13-projects/chapter-02-read-write-split' },
            { text: '多租户架构设计', link: '/postgresql/13-projects/chapter-03-multi-tenant' },
          ],
        },
        {
          text: '参考手册',
          items: [
            { text: '参数速查', link: '/postgresql/reference/parameters' },
            { text: '类型速查', link: '/postgresql/reference/types' },
            { text: '函数速查', link: '/postgresql/reference/functions' },
            { text: '错误码速查', link: '/postgresql/reference/errors' },
          ],
        },
        {
          text: '教程',
          items: [
            { text: 'MySQL 转 PG', link: '/postgresql/tutorials/mysql-to-pg' },
            { text: '首次生产部署', link: '/postgresql/tutorials/first-production' },
          ],
        },
      ],
      '/redis/': [
        {
          text: '数据模型',
          items: [
            { text: '概览', link: '/redis/01-data-model/chapter-01-overview' },
            { text: '基础类型', link: '/redis/01-data-model/chapter-02-basic-types' },
            { text: '高级类型', link: '/redis/01-data-model/chapter-03-advanced-types' },
            { text: '数据结构', link: '/redis/01-data-model/chapter-04-data-structures' },
            { text: '对象编码', link: '/redis/01-data-model/chapter-05-object-encoding' },
          ],
        },
        {
          text: '单机核心',
          items: [
            { text: '线程模型', link: '/redis/02-standalone-core/chapter-01-thread-model' },
            { text: '命令与 RESP', link: '/redis/02-standalone-core/chapter-02-command-resp' },
            { text: 'RDB', link: '/redis/02-standalone-core/chapter-03-rdb' },
            { text: 'AOF', link: '/redis/02-standalone-core/chapter-04-aof' },
            { text: '过期策略', link: '/redis/02-standalone-core/chapter-05-expiration' },
            { text: '淘汰策略', link: '/redis/02-standalone-core/chapter-06-eviction' },
          ],
        },
        {
          text: '缓存工程',
          items: [
            { text: '穿透', link: '/redis/03-cache-engineering/chapter-01-penetration' },
            { text: '击穿', link: '/redis/03-cache-engineering/chapter-02-breakdown' },
            { text: '雪崩', link: '/redis/03-cache-engineering/chapter-03-avalanche' },
            { text: '一致性', link: '/redis/03-cache-engineering/chapter-04-consistency' },
            { text: '大 Key 与热 Key', link: '/redis/03-cache-engineering/chapter-05-big-hot-key' },
          ],
        },
        {
          text: '高可用',
          items: [
            { text: '主从复制', link: '/redis/04-high-availability/chapter-01-replication' },
            { text: '哨兵', link: '/redis/04-high-availability/chapter-02-sentinel' },
            { text: '集群', link: '/redis/04-high-availability/chapter-03-cluster' },
            { text: '分布式锁', link: '/redis/04-high-availability/chapter-04-distributed-lock' },
            { text: '事务与 Lua', link: '/redis/04-high-availability/chapter-05-transaction-lua' },
            { text: 'Pipeline 与 Pub/Sub', link: '/redis/04-high-availability/chapter-06-pipeline-pubsub' },
          ],
        },
        {
          text: '运维管理',
          items: [
            { text: '性能', link: '/redis/05-operations/chapter-01-performance' },
            { text: '排障', link: '/redis/05-operations/chapter-02-troubleshooting' },
            { text: '监控', link: '/redis/05-operations/chapter-03-monitoring' },
            { text: '踩坑', link: '/redis/05-operations/chapter-04-pitfalls' },
            { text: '实战项目', link: '/redis/05-operations/chapter-05-hands-on-project' },
          ],
        },
      ],
      '/spring/': [
        {
          text: '核心原理',
          items: [
            { text: 'Spring 概览', link: '/spring/01-core/chapter-01-spring-overview' },
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
          text: '开发',
          items: [
            { text: 'Spring MVC', link: '/spring/02-web/chapter-01-spring-mvc' },
            { text: '参数校验与数据绑定', link: '/spring/02-web/chapter-03-validation-binding' },
            { text: '拦截器与过滤器', link: '/spring/02-web/chapter-04-interceptor-filter' },
            { text: 'WebFlux 响应式编程', link: '/spring/02-web/chapter-05-webflux' },
            { text: 'WebSocket 实时通信', link: '/spring/02-web/chapter-06-websocket' },
            { text: 'Server-Sent Events', link: '/spring/02-web/chapter-07-sse' },
            { text: '文件上传与下载', link: '/spring/02-web/chapter-08-file-upload-download' },
          ],
        },
        {
          text: '数据访问',
          items: [
            { text: 'JdbcTemplate', link: '/spring/03-data-access/chapter-01-jdbc-template' },
            { text: 'MyBatis 集成', link: '/spring/03-data-access/chapter-02-mybatis-integration' },
            { text: 'Spring Data JPA', link: '/spring/03-data-access/chapter-03-jpa' },
            { text: '事务管理', link: '/spring/03-data-access/chapter-04-transaction' },
            { text: '多数据源', link: '/spring/03-data-access/chapter-05-multi-datasource' },
            { text: '数据库迁移', link: '/spring/03-data-access/chapter-06-flyway-liquibase' },
            { text: '响应式数据访问', link: '/spring/03-data-access/chapter-07-r2dbc' },
          ],
        },
        {
          text: 'Spring Boot',
          items: [
            { text: '自动配置原理', link: '/spring/04-spring-boot/chapter-01-autoconfiguration' },
            { text: 'Starter 机制', link: '/spring/04-spring-boot/chapter-02-starter' },
            { text: '外部化配置', link: '/spring/04-spring-boot/chapter-03-configuration' },
            { text: 'Actuator 监控', link: '/spring/04-spring-boot/chapter-04-actuator' },
            { text: 'DevTools 热部署', link: '/spring/04-spring-boot/chapter-05-devtools' },
            { text: 'API 文档', link: '/spring/04-spring-boot/chapter-06-api-doc' },
            { text: '启动流程与启动参数', link: '/spring/04-spring-boot/chapter-07-startup' },
            { text: '生产化配置', link: '/spring/04-spring-boot/chapter-08-production-tuning' },
            { text: '构建与部署', link: '/spring/04-spring-boot/chapter-09-build-deploy' },
          ],
        },
        {
          text: '安全',
          items: [
            { text: '安全架构', link: '/spring/05-security/chapter-01-security-architecture' },
            { text: '认证机制', link: '/spring/05-security/chapter-02-authentication' },
            { text: '授权模型', link: '/spring/05-security/chapter-03-authorization' },
            { text: '安全最佳实践', link: '/spring/05-security/chapter-04-security-practice' },
          ],
        },
        {
          text: '高级特性',
          items: [
            { text: '事件机制', link: '/spring/06-advanced/chapter-01-event' },
            { text: '异步处理', link: '/spring/06-advanced/chapter-02-async' },
            { text: '定时任务', link: '/spring/06-advanced/chapter-03-scheduling' },
            { text: '缓存抽象', link: '/spring/06-advanced/chapter-04-caching' },
            { text: '消息集成', link: '/spring/06-advanced/chapter-05-messaging' },
            { text: '国际化', link: '/spring/06-advanced/chapter-06-internationalization' },
            { text: '分布式锁', link: '/spring/06-advanced/chapter-07-distributed-lock' },
            { text: '动态定时任务', link: '/spring/06-advanced/chapter-08-quartz' },
            { text: '邮件发送', link: '/spring/06-advanced/chapter-09-mail' },
            { text: 'Spring Batch 批处理', link: '/spring/06-advanced/chapter-10-spring-batch' },
          ],
        },
        {
          text: '微服务',
          items: [
            { text: '微服务架构模式', link: '/spring/07-microservices/chapter-01-microservice-pattern' },
            { text: '服务注册与发现', link: '/spring/07-microservices/chapter-02-service-discovery' },
            { text: 'API 网关', link: '/spring/07-microservices/chapter-03-api-gateway' },
            { text: '负载均衡', link: '/spring/07-microservices/chapter-04-load-balancing' },
            { text: '熔断降级', link: '/spring/07-microservices/chapter-05-circuit-breaker' },
            { text: '配置中心', link: '/spring/07-microservices/chapter-06-config-center' },
            { text: '分布式事务', link: '/spring/07-microservices/chapter-07-distributed-transaction' },
          ],
        },
        {
          text: '测试',
          items: [
            { text: '单元测试', link: '/spring/08-testing/chapter-01-unit-test' },
            { text: '集成测试', link: '/spring/08-testing/chapter-02-integration-test' },
            { text: 'Testcontainers', link: '/spring/08-testing/chapter-03-testcontainers' },
          ],
        },
      ],
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
