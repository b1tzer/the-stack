# 测试

> 测试不是"写完代码后补的东西"，是开发过程中的一部分。

## 1. 测试金字塔

```text
        ╱╲
       ╱  ╲         E2E 测试（少量）
      ╱────╲        - 验证完整流程
     ╱      ╲       - 慢、脆弱
    ╱────────╲      集成测试（适量）
   ╱          ╲     - 验证组件协作
  ╱────────────╲    - 数据库、API
 ╱              ╲   单元测试（大量）
╱────────────────╲  - 验证单个方法
                    - 快、稳定
```

## 2. 单元测试

```java
@Test
void shouldCalculateDiscount() {
    BigDecimal price = new BigDecimal("100");
    BigDecimal discount = OrderService.calculateDiscount(price, "VIP");
    assertThat(discount).isEqual(new BigDecimal("80"));
}
```

### 原则

- 测试一个方法的一个行为
- 不依赖外部（数据库、网络）
- 用 Mock 替代外部依赖
- 命名清晰：`should_预期行为_when_条件`

## 3. 集成测试

```java
@SpringBootTest
@Testcontainers
class OrderRepositoryTest {
    @Container
    static MySQLContainer<?> mysql = new MySQLContainer<>("mysql:8.0");

    @Autowired OrderRepository repository;

    @Test
    void shouldSaveAndRetrieveOrder() {
        Order order = new Order("ORD-001", new BigDecimal("99.9"));
        repository.save(order);
        
        Order found = repository.findById("ORD-001").orElseThrow();
        assertThat(found.getAmount()).isEqual(new BigDecimal("99.9"));
    }
}
```

## 4. 测试覆盖率

| 覆盖率 | 评价 | 建议 |
|--------|------|------|
| < 50% | 差 | 核心逻辑都没有测试 |
| 50-70% | 一般 | 基本够用 |
| 70-80% | 好 | 推荐目标 |
| > 80% | 很好 | 核心业务应该达到 |

**不要追求 100% 覆盖率**：有些代码（getter/setter、配置类）不需要测试。

## 5. 测试最佳实践

1. **先写测试再写代码**（TDD）或**写完代码立即补测试**
2. **测试应该是确定性的**：不依赖时间、随机数、外部状态
3. **测试应该快速**：单元测试 < 1ms，集成测试 < 1s
4. **测试应该独立**：每个测试可以单独运行
5. **测试失败时信息清晰**：能看出哪里出了问题
