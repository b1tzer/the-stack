import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const configPath = resolve(__dirname, '..', '.vitepress', 'config.mts');
const generatedPath = resolve(__dirname, '..', '.vitepress', 'sidebar.generated.ts');

const config = readFileSync(configPath, 'utf-8');
const generated = readFileSync(generatedPath, 'utf-8');

// 找到 sidebar: { 开始和对应的 }, 结束位置
const sidebarStart = config.indexOf('    sidebar: {');
if (sidebarStart === -1) {
  console.error('Cannot find sidebar: { in config.mts');
  process.exit(1);
}

// 找到 sidebar 对象的结束位置（匹配 socialLinks 之前）
const socialLinksPos = config.indexOf('\n    socialLinks:', sidebarStart);
if (socialLinksPos === -1) {
  console.error('Cannot find socialLinks after sidebar');
  process.exit(1);
}

// 从 generated 文件中提取 sidebar 对象内容
const generatedContent = generated
  .replace(/\/\/ 此文件由.*\n\n/, '')
  .replace('export const sidebar = ', '')
  .trim();
// 去掉最后的分号
const sidebarObj = generatedContent.endsWith(';') 
  ? generatedContent.slice(0, -1) 
  : generatedContent;

// 构建新的 sidebar 部分
const newSidebar = `    sidebar: {
      ...${sidebarObj},
      // 以下 section 结构特殊，保持手写
      '/java/': [
        {
          text: '第一卷 Java 语言',
          items: [
            { text: '类型系统', link: '/java/01-java-language/chapter-01-type-system' },
            { text: '面向对象', link: '/java/01-java-language/chapter-02-oop' },
            { text: '泛型', link: '/java/01-java-language/chapter-03-generics' },
            { text: '注解与 Lambda', link: '/java/01-java-language/chapter-04-annotation-lambda' },
          ]
        },
        {
          text: '第二卷 JVM Runtime',
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
          ]
        },
        {
          text: '第三卷 Java 并发',
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
          ]
        },
        {
          text: '第四卷 网络与通信',
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
          ]
        },
        {
          text: '第五卷 数据访问与持久化',
          items: [
            { text: '持久化思想', link: '/java/05-java-data-access/chapter-01-persistence-thought' },
            { text: 'JDBC', link: '/java/05-java-data-access/chapter-02-jdbc' },
            { text: 'MyBatis', link: '/java/05-java-data-access/chapter-03-mybatis' },
            { text: 'ORM 深入', link: '/java/05-java-data-access/chapter-04-orm-deep' },
            { text: '数据库核心原理', link: '/java/05-java-data-access/chapter-05-db-principles' },
            { text: 'Spring 事务', link: '/java/05-java-data-access/chapter-06-spring-transaction' },
            { text: '性能优化', link: '/java/05-java-data-access/chapter-07-performance' },
          ]
        },
        {
          text: '第六卷 企业架构',
          items: [
            { text: '企业系统部署', link: '/java/06-java-enterprise/chapter-08-security-deploy' },
            { text: '可观测性', link: '/java/06-java-enterprise/chapter-09-observability' },
          ]
        },
        {
          text: '第七卷 性能与架构',
          items: [
            { text: '性能工程', link: '/java/07-performance-architecture/chapter-08-performance' },
            { text: '架构案例', link: '/java/07-performance-architecture/chapter-09-case-studies' },
          ]
        }
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
          ]
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
          ]
        },
        {
          text: '缓存工程',
          items: [
            { text: '穿透', link: '/redis/03-cache-engineering/chapter-01-penetration' },
            { text: '击穿', link: '/redis/03-cache-engineering/chapter-02-breakdown' },
            { text: '雪崩', link: '/redis/03-cache-engineering/chapter-03-avalanche' },
            { text: '一致性', link: '/redis/03-cache-engineering/chapter-04-consistency' },
            { text: '大 Key 与热 Key', link: '/redis/03-cache-engineering/chapter-05-big-hot-key' },
          ]
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
          ]
        },
        {
          text: '运维',
          items: [
            { text: '性能', link: '/redis/05-operations/chapter-01-performance' },
            { text: '排障', link: '/redis/05-operations/chapter-02-troubleshooting' },
            { text: '监控', link: '/redis/05-operations/chapter-03-monitoring' },
            { text: '踩坑', link: '/redis/05-operations/chapter-04-pitfalls' },
            { text: '实战项目', link: '/redis/05-operations/chapter-05-hands-on-project' },
          ]
        }
      ],
      '/ai/': [
        {
          text: 'AI 工程',
          items: [
            { text: '概览', link: '/ai/' },
            { text: 'LLM 接口与提示词', link: '/ai/01-LLM接口与提示词工程' },
            { text: 'RAG', link: '/ai/02-RAG架构与工程落地' },
            { text: 'Function Calling 与 Agent', link: '/ai/03-FunctionCalling与Agent范式' },
            { text: 'Spring AI 与 MCP', link: '/ai/04-SpringAI入门与MCP集成' },
            { text: 'MCP 协议实战', link: '/ai/05-MCP协议与OpenClawSkill实战' },
          ]
        }
      ],
    },`;

// 替换
const before = config.substring(0, sidebarStart);
const after = config.substring(socialLinksPos);
const newConfig = before + newSidebar + '\n' + after;

writeFileSync(configPath, newConfig, 'utf-8');
console.log('config.mts updated with generated sidebar');
