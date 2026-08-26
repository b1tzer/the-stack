# 数据访问与持久化

> 回答"Java 对象如何可靠持久化"。核心链路：JDBC → ORM → SQL → 事务 → 数据库。只覆盖持久化，缓存和 MQ 不在本卷范围。

## 章节

- [持久化思想](/java/05-java-data-access/chapter-01-persistence-thought) — 对象-关系阻抗失配、三种层次
- [JDBC](/java/05-java-data-access/chapter-02-jdbc) — 核心接口、PreparedStatement、性能瓶颈
- [MyBatis](/java/05-java-data-access/chapter-03-mybatis) — Mapper 动态代理、缓存机制、插件机制
- [ORM 深入](/java/05-java-data-access/chapter-04-orm-deep) — MyBatis vs Hibernate、Entity 生命周期、N+1 问题
- [数据库核心原理](/java/05-java-data-access/chapter-05-db-principles) — B+Tree 索引、EXPLAIN、锁、事务隔离级别
- [Spring 事务](/java/05-java-data-access/chapter-06-spring-transaction) — @Transactional、传播机制、失效场景
- [性能优化](/java/05-java-data-access/chapter-07-performance) — HikariCP、批处理、链路分析
